"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const { z } = require("zod");

const CORE_VERSION = "4.0.0-alpha.7";
const MAX_READ_BYTES = 3 * 1024 * 1024;
const MAX_WRITE_BYTES = 6 * 1024 * 1024;
const MAX_BINARY_WRITE_BYTES = 25 * 1024 * 1024;
const MAX_LIST_ENTRIES = 2e3;
const MAX_COMMAND_OUTPUT = 1024 * 1024;
const APPROVAL_TTL_MS = 10 * 60 * 1e3;

const PERMISSION_KEYS = [
  "filesystemRead",
  "filesystemCreate",
  "filesystemWrite",
  "filesystemRename",
  "filesystemDelete",
  "terminal",
  "powershell",
  "cmd",
  "processExecute",
  "network",
  "install",
  "scripts",
  "administrator"
];

const permissionPatchSchema = z.object(
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, z.boolean().optional()]))
).strict();

const idSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const relativePathSchema = z.string().max(1024).refine(
  (value) => !value.includes("\0") && !path.isAbsolute(value),
  "La ruta debe ser relativa al proyecto."
);
const fileActionSchema = z.discriminatedUnion("action", [
  z.object({
    projectId: idSchema,
    action: z.literal("write"),
    relativePath: relativePathSchema,
    content: z.string().max(Math.ceil(MAX_BINARY_WRITE_BYTES * 4 / 3) + 16),
    encoding: z.enum(["utf8", "base64"]).default("utf8")
  }),
  z.object({
    projectId: idSchema,
    action: z.literal("mkdir"),
    relativePath: relativePathSchema
  }),
  z.object({
    projectId: idSchema,
    action: z.literal("rename"),
    relativePath: relativePathSchema,
    targetRelativePath: relativePathSchema
  }),
  z.object({
    projectId: idSchema,
    action: z.literal("delete"),
    relativePath: relativePathSchema
  })
]);
const terminalRequestSchema = z.object({
  projectId: idSchema,
  shell: z.enum(["terminal", "powershell", "cmd"]),
  command: z.string().trim().min(1).max(12e3),
  relativeCwd: relativePathSchema.default(""),
  timeoutMs: z.number().int().min(1e3).max(10 * 60 * 1e3).default(120e3)
});

function defaultPermissions(mode) {
  const base = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false]));
  base.filesystemRead = true;
  if (mode === "operator") {
    base.filesystemCreate = true;
    base.filesystemWrite = true;
    base.filesystemRename = true;
  }
  if (mode === "full-control") {
    base.filesystemCreate = true;
    base.filesystemWrite = true;
    base.filesystemRename = true;
    base.filesystemDelete = true;
    base.terminal = true;
    base.powershell = true;
    base.cmd = true;
    base.processExecute = true;
    base.scripts = true;
  }
  return base;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function actionBuffer(request) {
  if (request.encoding === "base64") {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(request.content) || request.content.length % 4 !== 0) {
      throw new Error("El contenido binario no utiliza Base64 válido.");
    }
    const buffer = Buffer.from(request.content, "base64");
    if (buffer.length > MAX_BINARY_WRITE_BYTES) throw new Error("El archivo binario supera 25 MB.");
    return buffer;
  }
  const buffer = Buffer.from(request.content, "utf8");
  if (buffer.length > MAX_WRITE_BYTES) throw new Error("El contenido supera 6 MB.");
  return buffer;
}

function redactSensitive(value) {
  return String(value)
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s]+/gi, "$1=[OCULTO]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [OCULTO]");
}

function safeEnvironment() {
  const allowed = new Set([
    "ALLUSERSPROFILE",
    "APPDATA",
    "COMSPEC",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROMPT",
    "PSMODULEPATH",
    "PUBLIC",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
    "HOME",
    "LANG"
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => allowed.has(key.toUpperCase()) && !/(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key)
    )
  );
}

function createDornV3Core({ database, userDataPath, developerSecurity = null }) {
  if (!database || !userDataPath) throw new Error("DORN V3 Core requiere base de datos y carpeta de usuario.");

  const stateRoot = path.join(userDataPath, "dorn-v3-core");
  const permissionsPath = path.join(stateRoot, "permissions.json");
  const historyRoot = path.join(stateRoot, "history");
  const auditPath = path.join(stateRoot, "audit.jsonl");
  const permissionState = readJson(permissionsPath, {});
  const approvals = new Map();
  const activeProcesses = new Map();

  fs.mkdirSync(historyRoot, { recursive: true });

  function audit(projectId, action, detail = {}) {
    const record = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      projectId: projectId || null,
      action,
      detail
    };
    fs.appendFileSync(auditPath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    try {
      database.audit(projectId || null, action, detail);
    } catch {
      // El registro propio de V3 sigue disponible aunque la tabla anterior no acepte el evento.
    }
    return record;
  }

  function project(projectId) {
    const item = database.getProject(idSchema.parse(projectId));
    const root = fs.realpathSync(item.rootPath);
    if (!fs.statSync(root).isDirectory()) throw new Error("La raíz del proyecto no es una carpeta.");
    return { ...item, root };
  }

  function permissions(projectId) {
    const item = project(projectId);
    if (developerSecurity?.status().enabled) {
      return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true]));
    }
    return {
      ...defaultPermissions(item.permissionMode),
      ...(permissionState[item.id] || {})
    };
  }

  function setPermissions(projectId, patch) {
    const item = project(projectId);
    const parsed = permissionPatchSchema.parse(patch);
    permissionState[item.id] = { ...(permissionState[item.id] || {}), ...parsed };
    writeJsonAtomic(permissionsPath, permissionState);
    const result = permissions(item.id);
    audit(item.id, "permissions.updated", { changed: Object.keys(parsed), result });
    return result;
  }

  function requirePermissions(projectId, keys) {
    const current = permissions(projectId);
    const missing = keys.filter((key) => key === "administrator" ? !developerSecurity?.canRequestElevation() : !current[key]);
    if (missing.length) {
      throw new Error(`Permiso requerido: ${missing.join(", ")}.`);
    }
    return current;
  }

  function resolveInside(projectRoot, relativePath, options = {}) {
    const parsed = relativePathSchema.parse(relativePath || "");
    const absolute = path.resolve(projectRoot, parsed || ".");
    const prefix = `${projectRoot}${path.sep}`;
    if (absolute !== projectRoot && !absolute.startsWith(prefix)) {
      throw new Error("La ruta intenta salir de la carpeta autorizada.");
    }

    let existing = absolute;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    const canonicalParent = fs.realpathSync(existing);
    if (canonicalParent !== projectRoot && !canonicalParent.startsWith(prefix)) {
      throw new Error("La ruta atraviesa un enlace fuera del proyecto.");
    }

    if (fs.existsSync(absolute)) {
      const canonicalTarget = fs.realpathSync(absolute);
      if (canonicalTarget !== projectRoot && !canonicalTarget.startsWith(prefix)) {
        throw new Error("El destino real se encuentra fuera del proyecto.");
      }
      if (options.fileOnly && !fs.statSync(canonicalTarget).isFile()) {
        throw new Error("La ruta no corresponde a un archivo.");
      }
      if (options.directoryOnly && !fs.statSync(canonicalTarget).isDirectory()) {
        throw new Error("La ruta no corresponde a una carpeta.");
      }
      return canonicalTarget;
    }
    if (options.mustExist) throw new Error("El archivo o carpeta no existe.");
    return absolute;
  }

  function relativeToProject(projectRoot, absolute) {
    return path.relative(projectRoot, absolute).split(path.sep).join("/");
  }

  function listFiles(projectId, relativePath = "") {
    requirePermissions(projectId, ["filesystemRead"]);
    const item = project(projectId);
    const root = resolveInside(item.root, relativePath, { mustExist: true, directoryOnly: true });
    const entries = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).slice(0, MAX_LIST_ENTRIES)) {
      const absolute = path.join(root, entry.name);
      const stat = fs.lstatSync(absolute);
      entries.push({
        name: entry.name,
        relativePath: relativeToProject(item.root, absolute),
        type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "link" : "file",
        sizeBytes: entry.isFile() ? stat.size : null,
        modifiedAt: stat.mtime.toISOString(),
        writable: !entry.isSymbolicLink()
      });
    }
    audit(item.id, "filesystem.listed", { relativePath, count: entries.length });
    return entries;
  }

  function readFile(projectId, relativePath) {
    requirePermissions(projectId, ["filesystemRead"]);
    const item = project(projectId);
    const target = resolveInside(item.root, relativePath, { mustExist: true, fileOnly: true });
    const stat = fs.statSync(target);
    if (stat.size > MAX_READ_BYTES) throw new Error("El archivo supera 3 MB. Utiliza lectura por fragmentos.");
    const buffer = fs.readFileSync(target);
    if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
      throw new Error("El archivo es binario y no puede abrirse como texto.");
    }
    audit(item.id, "filesystem.read", {
      relativePath: relativeToProject(item.root, target),
      sizeBytes: stat.size
    });
    return {
      relativePath: relativeToProject(item.root, target),
      content: buffer.toString("utf8"),
      sizeBytes: stat.size,
      sha256: sha256Buffer(buffer),
      modifiedAt: stat.mtime.toISOString()
    };
  }

  function issueApproval(kind, payload, summary) {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + APPROVAL_TTL_MS;
    approvals.set(token, { kind, payload, expiresAt });
    return {
      approvalToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      summary
    };
  }

  function consumeApproval(token, expectedKind) {
    const parsed = idSchema.parse(token);
    const approval = approvals.get(parsed);
    approvals.delete(parsed);
    if (!approval || approval.kind !== expectedKind) throw new Error("La autorización no existe o ya fue utilizada.");
    if (approval.expiresAt < Date.now()) throw new Error("La autorización expiró. Revisa nuevamente la operación.");
    return approval.payload;
  }

  function cancelApproval(token) {
    const parsed = idSchema.parse(token);
    return approvals.delete(parsed);
  }

  function previewFileAction(raw) {
    const request = fileActionSchema.parse(raw);
    const item = project(request.projectId);
    const target = resolveInside(item.root, request.relativePath, {
      mustExist: request.action === "rename" || request.action === "delete"
    });
    const exists = fs.existsSync(target);
    const required = [];

    if (request.action === "write") required.push(exists ? "filesystemWrite" : "filesystemCreate");
    if (request.action === "mkdir") required.push("filesystemCreate");
    if (request.action === "rename") required.push("filesystemRename");
    if (request.action === "delete") required.push("filesystemDelete");
    requirePermissions(item.id, required);

    let targetAfter = null;
    if (request.action === "rename") {
      targetAfter = resolveInside(item.root, request.targetRelativePath);
      if (fs.existsSync(targetAfter)) throw new Error("La ruta de destino ya existe.");
    }
    if (request.action === "mkdir" && exists) throw new Error("La carpeta ya existe.");
    const proposedBuffer = request.action === "write" ? actionBuffer(request) : null;

    const before = exists && fs.statSync(target).isFile()
      ? { sizeBytes: fs.statSync(target).size, sha256: sha256File(target) }
      : null;
    const after = request.action === "write"
      ? {
          sizeBytes: proposedBuffer.length,
          sha256: sha256Buffer(proposedBuffer),
          encoding: request.encoding
        }
      : null;
    const summary = {
      projectId: item.id,
      action: request.action,
      relativePath: relativeToProject(item.root, target),
      targetRelativePath: targetAfter ? relativeToProject(item.root, targetAfter) : null,
      exists,
      before,
      after,
      destructive: request.action === "delete" || (request.action === "write" && exists),
      recoveryAvailable: true,
      permissionsRequired: required
    };
    audit(item.id, "filesystem.preview", {
      action: request.action,
      relativePath: summary.relativePath,
      destructive: summary.destructive
    });
    return issueApproval("file", { request, root: item.root, target, targetAfter, before }, summary);
  }

  function historyDirectory(projectId, operationId) {
    return path.join(historyRoot, projectId, operationId);
  }

  function copyEntry(source, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, {
      recursive: fs.statSync(source).isDirectory(),
      force: false,
      errorOnExist: true,
      preserveTimestamps: true
    });
  }

  function removeEntry(target) {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory() && !stat.isSymbolicLink()) fs.rmSync(target, { recursive: true, force: false });
    else fs.unlinkSync(target);
  }

  function applyFileAction(approvalToken) {
    const approved = consumeApproval(approvalToken, "file");
    const { request, root, target, targetAfter, before } = approved;
    const item = project(request.projectId);
    if (item.root !== root) throw new Error("La carpeta del proyecto cambió desde la vista previa.");

    const required = request.action === "write"
      ? [fs.existsSync(target) ? "filesystemWrite" : "filesystemCreate"]
      : request.action === "mkdir"
        ? ["filesystemCreate"]
        : request.action === "rename"
          ? ["filesystemRename"]
          : ["filesystemDelete"];
    requirePermissions(item.id, required);

    if (before) {
      if (!fs.existsSync(target) || sha256File(target) !== before.sha256) {
        throw new Error("El archivo cambió después de la vista previa. Revisa la operación nuevamente.");
      }
    }

    const operationId = crypto.randomUUID();
    const operationRoot = historyDirectory(item.id, operationId);
    const payloadRoot = path.join(operationRoot, "payload");
    const manifest = {
      id: operationId,
      projectId: item.id,
      createdAt: new Date().toISOString(),
      action: request.action,
      relativePath: relativeToProject(root, target),
      targetRelativePath: targetAfter ? relativeToProject(root, targetAfter) : null,
      hadOriginal: fs.existsSync(target),
      restoredAt: null
    };
    fs.mkdirSync(payloadRoot, { recursive: true });

    if (fs.existsSync(target)) copyEntry(target, path.join(payloadRoot, "original"));

    if (request.action === "write") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${operationId}.tmp`;
      fs.writeFileSync(temporary, actionBuffer(request));
      fs.renameSync(temporary, target);
    } else if (request.action === "mkdir") {
      fs.mkdirSync(target, { recursive: false });
    } else if (request.action === "rename") {
      fs.mkdirSync(path.dirname(targetAfter), { recursive: true });
      fs.renameSync(target, targetAfter);
    } else if (request.action === "delete") {
      removeEntry(target);
    }

    writeJsonAtomic(path.join(operationRoot, "manifest.json"), manifest);
    audit(item.id, `filesystem.${request.action}`, {
      operationId,
      relativePath: manifest.relativePath,
      targetRelativePath: manifest.targetRelativePath,
      recoveryAvailable: true
    });
    return {
      ok: true,
      operationId,
      action: request.action,
      relativePath: manifest.relativePath,
      targetRelativePath: manifest.targetRelativePath,
      recoveryAvailable: true
    };
  }

  function history(projectId) {
    const item = project(projectId);
    const root = path.join(historyRoot, item.id);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readJson(path.join(root, entry.name, "manifest.json"), null))
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function previewRestore(projectId, operationId) {
    const item = project(projectId);
    requirePermissions(item.id, ["filesystemWrite"]);
    const id = idSchema.parse(operationId);
    const manifestPath = path.join(historyDirectory(item.id, id), "manifest.json");
    const manifest = readJson(manifestPath, null);
    if (!manifest || manifest.projectId !== item.id) throw new Error("No se encontró la operación solicitada.");
    if (manifest.restoredAt) throw new Error("Esta operación ya fue restaurada.");
    return issueApproval("restore", { projectId: item.id, operationId: id }, {
      projectId: item.id,
      operationId: id,
      action: manifest.action,
      relativePath: manifest.relativePath,
      targetRelativePath: manifest.targetRelativePath,
      destructive: true,
      recoveryAvailable: true
    });
  }

  function applyRestore(approvalToken) {
    const approved = consumeApproval(approvalToken, "restore");
    const item = project(approved.projectId);
    requirePermissions(item.id, ["filesystemWrite"]);
    const operationRoot = historyDirectory(item.id, approved.operationId);
    const manifestPath = path.join(operationRoot, "manifest.json");
    const manifest = readJson(manifestPath, null);
    if (!manifest || manifest.restoredAt) throw new Error("La operación no está disponible para restauración.");

    const originalPath = resolveInside(item.root, manifest.relativePath);
    const renamedPath = manifest.targetRelativePath
      ? resolveInside(item.root, manifest.targetRelativePath)
      : null;
    const backup = path.join(operationRoot, "payload", "original");

    if (manifest.action === "rename") {
      if (!renamedPath || !fs.existsSync(renamedPath)) throw new Error("No existe el destino renombrado.");
      if (fs.existsSync(originalPath)) throw new Error("La ruta original está ocupada.");
      fs.renameSync(renamedPath, originalPath);
    } else if (manifest.hadOriginal) {
      if (!fs.existsSync(backup)) throw new Error("La copia de recuperación no está disponible.");
      if (fs.existsSync(originalPath)) removeEntry(originalPath);
      copyEntry(backup, originalPath);
    } else if (fs.existsSync(originalPath)) {
      removeEntry(originalPath);
    }

    manifest.restoredAt = new Date().toISOString();
    writeJsonAtomic(manifestPath, manifest);
    audit(item.id, "filesystem.restored", {
      operationId: approved.operationId,
      relativePath: manifest.relativePath
    });
    return { ok: true, operationId: approved.operationId, restoredAt: manifest.restoredAt };
  }

  function detectCommandRequirements(request) {
    const command = request.command;
    const required = ["terminal", "processExecute"];
    if (request.shell === "powershell") required.push("powershell");
    if (request.shell === "cmd") required.push("cmd");
    if (/(^|\s)(?:node|npm|npx|python|py|pip|pnpm|yarn|bun|dotnet|java|javac|cargo|go)(?:\s|$)|\.(?:ps1|cmd|bat|sh)(?:\s|$)/i.test(command)) {
      required.push("scripts");
    }
    if (/(?:https?:\/\/|curl\b|wget\b|Invoke-WebRequest\b|Invoke-RestMethod\b|git\s+(?:clone|fetch|pull|push)\b)/i.test(command)) {
      required.push("network");
    }
    if (/(?:npm|pnpm|yarn|pip|choco|winget|scoop)\s+(?:install|add)\b|dotnet\s+tool\s+install\b/i.test(command)) {
      required.push("install");
    }
    if (/(?:Start-Process\b[^\r\n]*-Verb\s+RunAs|runas\b|net\s+(?:user|localgroup)\b|sc\s+(?:create|delete|config)\b)/i.test(command)) {
      required.push("administrator");
    }
    return [...new Set(required)];
  }

  function assertCommandSafe(command) {
    const blocked = [
      /\bformat(?:\.com)?\s+[a-z]:/i,
      /\bdiskpart\b/i,
      /\bshutdown(?:\.exe)?\b/i,
      /\bbcdedit\b/i,
      /\bcipher\s+\/w\b/i,
      /\brm\s+-rf\s+(?:\/|~|\$HOME)\b/i,
      /\b(?:rd|rmdir)\s+\/s\s+\/q\s+[a-z]:\\?\s*$/i,
      /\bdel\s+\/[a-z]*s[a-z]*\s+\/[a-z]*q[a-z]*\s+[a-z]:\\?\s*$/i,
      /Remove-Item\b[^\r\n]*-(?:Recurse|r)\b[^\r\n]*(?:[a-z]:\\|\\Windows\\|\\Users\\)/i,
      /powershell(?:\.exe)?\b[^\r\n]*-(?:EncodedCommand|enc)\b/i
    ];
    if (blocked.some((pattern) => pattern.test(command))) {
      throw new Error("El comando contiene una operación destructiva bloqueada por DORN Security.");
    }
  }

  function previewTerminal(raw) {
    const request = terminalRequestSchema.parse(raw);
    const item = project(request.projectId);
    const cwd = resolveInside(item.root, request.relativeCwd, { mustExist: true, directoryOnly: true });
    assertCommandSafe(request.command);
    const required = detectCommandRequirements(request);
    const elevated = Boolean(developerSecurity?.commandNeedsElevation(request.command) || required.includes("administrator"));
    if (elevated && !required.includes("administrator")) required.push("administrator");
    requirePermissions(item.id, required);
    const summary = {
      projectId: item.id,
      shell: request.shell,
      command: redactSensitive(request.command),
      relativeCwd: relativeToProject(item.root, cwd),
      timeoutMs: request.timeoutMs,
      permissionsRequired: required,
      elevated,
      uacRequired: elevated && process.platform === "win32",
      destructive: false,
      outputLimitBytes: MAX_COMMAND_OUTPUT
    };
    audit(item.id, "terminal.preview", summary);
    return issueApproval("terminal", { request, root: item.root, cwd }, summary);
  }

  function shellInvocation(shell, command) {
    if (process.platform === "win32") {
      if (shell === "powershell") {
        return {
          executable: "powershell.exe",
          args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
        };
      }
      return {
        executable: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", command]
      };
    }
    return { executable: "/bin/sh", args: ["-lc", command] };
  }

  function executeTerminal(approvalToken) {
    const approved = consumeApproval(approvalToken, "terminal");
    const { request, root, cwd } = approved;
    const item = project(request.projectId);
    if (item.root !== root) throw new Error("La carpeta del proyecto cambió desde la vista previa.");
    assertCommandSafe(request.command);
    const required = detectCommandRequirements(request);
    const elevated = Boolean(developerSecurity?.commandNeedsElevation(request.command) || required.includes("administrator"));
    if (elevated && !required.includes("administrator")) required.push("administrator");
    requirePermissions(item.id, required);

    const processId = crypto.randomUUID();
    const invocation = shellInvocation(request.shell, request.command);
    const startedAt = new Date().toISOString();
    audit(item.id, "terminal.started", {
      processId,
      shell: request.shell,
      command: redactSensitive(request.command),
      relativeCwd: relativeToProject(item.root, cwd),
      elevated
    });

    if (elevated) {
      const execution = developerSecurity.executeElevated(request, cwd, { maximumOutput: MAX_COMMAND_OUTPUT });
      activeProcesses.set(processId, execution.child);
      return execution.promise.then((result) => {
        activeProcesses.delete(processId);
        const completed = { processId, ...result };
        audit(item.id, "terminal.finished", { processId, exitCode: result.exitCode, signal: result.signal, truncated: result.truncated, elevated: true, uacDisplayed: true, stdoutBytes: Buffer.byteLength(result.stdout, "utf8"), stderrBytes: Buffer.byteLength(result.stderr, "utf8") });
        return completed;
      }).catch((error) => {
        activeProcesses.delete(processId);
        audit(item.id, "terminal.failed", { processId, elevated: true, error: error.message });
        throw error;
      });
    }

    return new Promise((resolve, reject) => {
      const child = childProcess.spawn(invocation.executable, invocation.args, {
        cwd,
        env: safeEnvironment(),
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      activeProcesses.set(processId, child);
      let stdout = "";
      let stderr = "";
      let truncated = false;
      const append = (target, chunk) => {
        const next = target + chunk.toString("utf8");
        if (Buffer.byteLength(next, "utf8") <= MAX_COMMAND_OUTPUT) return next;
        truncated = true;
        return next.slice(0, MAX_COMMAND_OUTPUT);
      };
      child.stdout.on("data", (chunk) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr = append(stderr, chunk);
      });
      const timeout = setTimeout(() => child.kill(), request.timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timeout);
        activeProcesses.delete(processId);
        audit(item.id, "terminal.failed", { processId, error: error.message });
        reject(error);
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timeout);
        activeProcesses.delete(processId);
        const result = {
          processId,
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode,
          signal,
          stdout,
          stderr,
          truncated
        };
        audit(item.id, "terminal.finished", {
          processId,
          exitCode,
          signal,
          truncated,
          stdoutBytes: Buffer.byteLength(stdout, "utf8"),
          stderrBytes: Buffer.byteLength(stderr, "utf8")
        });
        resolve(result);
      });
    });
  }

  function cancelProcess(processId) {
    const id = idSchema.parse(processId);
    const child = activeProcesses.get(id);
    if (!child) return false;
    child.kill();
    return true;
  }

  function recentAudit(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    if (!fs.existsSync(auditPath)) return [];
    return fs.readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-safeLimit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }

  function status() {
    return {
      version: CORE_VERSION,
      designPreserved: true,
      capabilities: {
        projectFilesystem: true,
        independentPermissions: true,
        previewBeforeChanges: true,
        recoverableHistory: true,
        terminalApproval: true,
        powershell: true,
        cmd: true,
        processCancellation: true,
        auditLog: true
      },
      developerUacGate: developerSecurity?.status() || null,
      developerFullAccess: developerSecurity?.status().enabled === true,
      activeProcesses: activeProcesses.size,
      pendingApprovals: approvals.size
    };
  }

  function registerIpc(handle) {
    handle("dorn:v3_status", () => status());
    handle("dorn:v3_permissions_get", (_event, projectId) => permissions(idSchema.parse(projectId)));
    handle("dorn:v3_permissions_update", (_event, projectId, patch) =>
      setPermissions(idSchema.parse(projectId), patch)
    );
    handle("dorn:v3_files_list", (_event, projectId, relativePath) =>
      listFiles(idSchema.parse(projectId), String(relativePath || ""))
    );
    handle("dorn:v3_file_read", (_event, projectId, relativePath) =>
      readFile(idSchema.parse(projectId), String(relativePath || ""))
    );
    handle("dorn:v3_file_action_preview", (_event, request) => previewFileAction(request));
    handle("dorn:v3_file_action_apply", (_event, approvalToken) =>
      applyFileAction(idSchema.parse(approvalToken))
    );
    handle("dorn:v3_history_list", (_event, projectId) => history(idSchema.parse(projectId)));
    handle("dorn:v3_restore_preview", (_event, projectId, operationId) =>
      previewRestore(idSchema.parse(projectId), idSchema.parse(operationId))
    );
    handle("dorn:v3_restore_apply", (_event, approvalToken) =>
      applyRestore(idSchema.parse(approvalToken))
    );
    handle("dorn:v3_terminal_preview", (_event, request) => previewTerminal(request));
    handle("dorn:v3_terminal_execute", (_event, approvalToken) =>
      executeTerminal(idSchema.parse(approvalToken))
    );
    handle("dorn:v3_terminal_cancel", (_event, processId) => cancelProcess(idSchema.parse(processId)));
    handle("dorn:v3_audit_recent", (_event, limit) => recentAudit(limit));
  }

  function stop() {
    for (const child of activeProcesses.values()) child.kill();
    activeProcesses.clear();
    approvals.clear();
  }

  return {
    status,
    permissions,
    setPermissions,
    listFiles,
    readFile,
    previewFileAction,
    applyFileAction,
    history,
    previewRestore,
    applyRestore,
    previewTerminal,
    executeTerminal,
    cancelProcess,
    recentAudit,
    cancelApproval,
    registerIpc,
    stop
  };
}

module.exports = {
  CORE_VERSION,
  PERMISSION_KEYS,
  createDornV3Core
};
