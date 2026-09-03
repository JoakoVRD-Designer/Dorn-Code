"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { containsSecret } = require("./policy-engine");
const { projectIdentity } = require("./job-runtime");

const SAFE_ENVIRONMENT_KEYS = new Set(["CI", "FORCE_COLOR", "LANG", "LC_ALL", "NODE_ENV", "NO_COLOR", "TZ"]);
const SECRET_REDACTIONS = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi
];

function executionError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }

function redact(value) {
  let text = String(value || "");
  for (const pattern of SECRET_REDACTIONS) text = text.replace(pattern, "[OCULTO]");
  return text;
}

function digestFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw executionError("EXECUTABLE_UNSAFE", "La herramienta no es un archivo ejecutable regular.");
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(512 * 1024);
  try { let read; do { read = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (read) hash.update(buffer.subarray(0, read)); } while (read); }
  finally { fs.closeSync(descriptor); }
  return { sha256: hash.digest("hex"), size: stat.size, modifiedMs: Math.trunc(stat.mtimeMs) };
}

function findExecutable(command, environmentPath = process.env.PATH || "") {
  const requested = String(command || "");
  if (!requested || requested.includes("\0")) return null;
  if (path.isAbsolute(requested)) {
    try {
      const stat = fs.lstatSync(requested);
      return stat.isFile() && !stat.isSymbolicLink() ? fs.realpathSync(requested) : null;
    } catch { return null; }
  }
  if (requested.includes("/") || requested.includes("\\")) return null;
  const extensions = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of environmentPath.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" ? `${requested}${extension}` : requested);
      try {
        const stat = fs.lstatSync(candidate);
        if (stat.isFile() && !stat.isSymbolicLink()) return fs.realpathSync(candidate);
      } catch {}
    }
  }
  return null;
}

function safeEnvironment(extra = {}, internal = {}) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw executionError("EXECUTION_ENV_INVALID", "El entorno adicional debe ser un objeto.");
  const inherited = ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"];
  const environment = Object.fromEntries(inherited.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  for (const [key, rawValue] of Object.entries(extra)) {
    if (!SAFE_ENVIRONMENT_KEYS.has(key)) throw executionError("EXECUTION_ENV_KEY_DENIED", `La variable ${key} no está permitida.`);
    const value = String(rawValue);
    if (value.length > 4096 || value.includes("\0") || containsSecret(`${key}=${value}`)) throw executionError("EXECUTION_ENV_SECRET_OR_INVALID", `La variable ${key} contiene un valor inseguro.`);
    environment[key] = value;
  }
  for (const [key, value] of Object.entries(internal)) environment[key] = String(value);
  return environment;
}

function safeArguments(args) {
  if (!Array.isArray(args) || args.length > 200) throw executionError("EXECUTION_ARGS_INVALID", "Los argumentos deben ser una lista acotada.");
  return args.map((raw) => {
    const value = String(raw);
    if (value.length > 8192 || value.includes("\0") || containsSecret(value)) throw executionError("EXECUTION_ARG_SECRET_OR_INVALID", "Un argumento contiene un secreto o valor inválido.");
    if (/^(?:https?|ssh|git):\/\//i.test(value)) throw executionError("EXECUTION_URL_ARG_DENIED", "Las URLs requieren un target de red aislado y explícito.");
    return value;
  });
}

function validateNodeArguments(args, executionRoot, workingDirectory = executionRoot) {
  const blocked = new Set(["-e", "--eval", "-p", "--print", "-r", "--require", "--import", "--loader", "--experimental-loader", "--inspect", "--inspect-brk"]);
  for (const argument of args) {
    const flag = argument.split("=")[0];
    if (blocked.has(flag) || argument.startsWith("@")) throw executionError("EXECUTION_NODE_FLAG_DENIED", `Node flag bloqueado: ${flag}`);
    if (/\.(?:cjs|mjs|js)$/i.test(argument) && !argument.startsWith("-")) {
      const candidate = path.resolve(workingDirectory, argument);
      if (candidate !== executionRoot && !candidate.startsWith(`${executionRoot}${path.sep}`)) throw executionError("EXECUTION_SCRIPT_OUTSIDE_SCOPE", "El script queda fuera del aislamiento.");
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) throw executionError("EXECUTION_SCRIPT_UNSAFE", "El script no es un archivo regular seguro.");
    }
  }
}

function validateGitArguments(args) {
  if (args.some((argument) => argument === "-c" || argument.startsWith("--config") || /^(?:--upload-pack|--exec-path)/.test(argument))) {
    throw executionError("EXECUTION_GIT_FLAG_DENIED", "Git recibió una opción que puede ejecutar o reconfigurar herramientas.");
  }
  const first = args.find((argument) => !argument.startsWith("-")) || "";
  const allowed = new Set(["check-ignore", "diff", "log", "ls-files", "rev-parse", "show", "status"]);
  if (!allowed.has(first)) throw executionError("EXECUTION_GIT_ACTION_DENIED", "Execution Core sólo permite inspección Git; Worktree Manager es dueño de mutaciones Git.");
}

function validateWslScopedNodeArguments(args, root, cwd = root) {
  if (args.length < 5 || args[0] !== "--distribution" || args[2] !== "--exec" || args[3] !== "node") {
    throw executionError("EXECUTION_WSL_CONTRACT_INVALID", "WSL sólo acepta una distribución explícita y Node sin shell.");
  }
  const distro = String(args[1] || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(distro) || distro.includes("..")) {
    throw executionError("EXECUTION_WSL_DISTRO_INVALID", "La distribución WSL solicitada es insegura.");
  }
  validateNodeArguments(args.slice(4), root, cwd);
}

class ExecutionCore {
  constructor(options = {}) {
    if (!options.projectCore || !options.policyEngine || !options.worktreeManager) throw new Error("Execution Core necesita Project Core, Policy y Worktree Manager.");
    this.projectCore = options.projectCore;
    this.policyEngine = options.policyEngine;
    this.worktreeManager = options.worktreeManager;
    this.evidenceCore = options.evidenceCore || null;
    this.spawn = options.spawn || childProcess.spawn;
    this.spawnSync = options.spawnSync || childProcess.spawnSync;
    this.maxOutputBytes = Math.max(64 * 1024, Math.min(16 * 1024 * 1024, Number(options.maxOutputBytes) || 4 * 1024 * 1024));
  }

  projectCore;
  policyEngine;
  worktreeManager;
  evidenceCore;
  spawn;
  spawnSync;
  maxOutputBytes;
  tools = new Map();
  active = new Map();

  register(input = {}) {
    const toolId = String(input.toolId || "").trim();
    if (!/^[a-z][a-z0-9_.-]{1,79}$/.test(toolId)) throw executionError("TOOL_ID_INVALID", "La herramienta necesita una identidad estable.");
    const executable = findExecutable(input.executable || toolId, input.environmentPath || process.env.PATH || "");
    const observed = executable ? digestFile(executable) : null;
    const manifest = {
      schema: "dorn.tool/1", toolId, label: String(input.label || toolId).slice(0, 200),
      executableName: String(input.executable || toolId), executable, installed: Boolean(executable),
      executableSha256: observed?.sha256 || null, executableSize: observed?.size || 0,
      capabilities: [...new Set((input.capabilities || []).map(String))].sort(),
      actions: [...new Set((input.actions || [input.action || "process.execute"]).map(String))].sort(),
      argumentPolicy: String(input.argumentPolicy || "NONE"),
      networkBehavior: String(input.networkBehavior || "DENIED_UNENFORCED"),
      internalEnvironment: input.internalEnvironment && typeof input.internalEnvironment === "object" ? { ...input.internalEnvironment } : {},
      provenance: {
        source: String(input.provenance?.source || "SYSTEM_PATH"), official: input.provenance?.official === true,
        license: input.provenance?.license ? String(input.provenance.license) : null
      },
      registeredAt: new Date().toISOString()
    };
    if (containsSecret(JSON.stringify(manifest))) throw executionError("TOOL_MANIFEST_SECRET", "El manifest de herramienta contiene una credencial.");
    this.tools.set(toolId, manifest);
    return structuredClone(manifest);
  }

  discoverDefaults() {
    const entries = [
      {
        toolId: "node", label: "Node.js Runtime", executable: process.execPath,
        capabilities: ["code.check", "code.execute", "test.execute", "web.server"],
        actions: ["build.execute", "process.execute", "test.execute"], argumentPolicy: "NODE_SCOPED", networkBehavior: "DENIED_UNENFORCED",
        internalEnvironment: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
        provenance: { source: "nodejs.org/electron-runtime", official: true, license: "MIT" }
      },
      {
        toolId: "git-inspect", label: "Git Read-only", executable: "git",
        capabilities: ["git.inspect"], actions: ["git.inspect"], argumentPolicy: "GIT_READ_ONLY", networkBehavior: "NO_NETWORK_BY_POLICY",
        provenance: { source: "git-scm.com", official: true, license: "GPL-2.0" }
      }
    ];
    return entries.map((entry) => this.register(entry));
  }

  list() { return [...this.tools.values()].map((tool) => structuredClone(tool)); }

  health(toolId) {
    const tool = this.tools.get(String(toolId));
    if (!tool) throw executionError("TOOL_UNKNOWN", "Herramienta desconocida.");
    if (!tool.installed) return { ...structuredClone(tool), health: "NOT_INSTALLED" };
    const current = digestFile(tool.executable);
    if (current.sha256 !== tool.executableSha256 || current.size !== tool.executableSize) return { ...structuredClone(tool), health: "EXECUTABLE_CHANGED", currentSha256: current.sha256 };
    const result = this.spawnSync(tool.executable, ["--version"], {
      encoding: "utf8", timeout: 5_000, windowsHide: true, shell: false,
      env: safeEnvironment({}, tool.internalEnvironment), maxBuffer: 256 * 1024, stdio: ["ignore", "pipe", "pipe"]
    });
    return {
      ...structuredClone(tool), health: result.status === 0 ? "HEALTHY" : "DEGRADED",
      version: redact(String(result.stdout || result.stderr || "").trim().split(/\r?\n/)[0]).slice(0, 500), exitCode: result.status
    };
  }

  executionRoot(project, request) {
    const identity = projectIdentity(project, this.projectCore);
    if (request.workUnitId) {
      const unit = this.worktreeManager.get(project, String(request.workUnitId));
      if (!unit.executionRootAvailable || !fs.existsSync(unit.executionRoot)) throw executionError("EXECUTION_WORKTREE_MISSING", "La Work Unit no tiene aislamiento disponible.");
      const root = fs.realpathSync(unit.executionRoot);
      if (root !== path.resolve(unit.executionRoot)) throw executionError("EXECUTION_WORKTREE_UNSAFE", "La raíz de Worktree no es canónica.");
      return { identity, root, unit, isolation: unit.isolationMode };
    }
    if (request.allowMainProject !== true) throw executionError("EXECUTION_WORKTREE_REQUIRED", "La ejecución necesita una Work Unit aislada.");
    return { identity, root: identity.root, unit: null, isolation: "MAIN_PROJECT_EXPLICIT" };
  }

  resolveCwd(executionRoot, rawRelative = ".") {
    const relative = String(rawRelative || ".").replaceAll("\\", "/");
    if (relative.includes("\0") || path.isAbsolute(relative) || /^[a-zA-Z]:[\\/]/.test(relative) || relative.split("/").some((part) => part === "..")) {
      throw executionError("EXECUTION_CWD_UNSAFE", "El cwd solicitado es inseguro.");
    }
    const candidate = path.resolve(executionRoot, relative);
    if (candidate !== executionRoot && !candidate.startsWith(`${executionRoot}${path.sep}`)) throw executionError("EXECUTION_CWD_OUTSIDE_SCOPE", "El cwd queda fuera del aislamiento.");
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !fs.realpathSync(candidate).startsWith(executionRoot)) throw executionError("EXECUTION_CWD_UNSAFE", "El cwd no es una carpeta real dentro del aislamiento.");
    return fs.realpathSync(candidate);
  }

  validateTool(tool, args, root, cwd = root) {
    if (tool.argumentPolicy === "NODE_SCOPED") validateNodeArguments(args, root, cwd);
    else if (tool.argumentPolicy === "GIT_READ_ONLY") validateGitArguments(args);
    else if (tool.argumentPolicy === "WSL_SCOPED_NODE") validateWslScopedNodeArguments(args, root, cwd);
    else throw executionError("TOOL_ARGUMENT_POLICY_MISSING", "La herramienta no tiene una política de argumentos ejecutable.");
  }

  execute(project, request = {}, options = {}) {
    const tool = this.tools.get(String(request.toolId || ""));
    if (!tool?.installed) throw executionError("TOOL_NOT_INSTALLED", `La herramienta ${request.toolId || "solicitada"} no está instalada.`);
    const currentExecutable = digestFile(tool.executable);
    if (currentExecutable.sha256 !== tool.executableSha256 || currentExecutable.size !== tool.executableSize) throw executionError("EXECUTABLE_CHANGED", "La herramienta cambió después de registrarse; requiere nueva revisión.");
    const workspace = this.executionRoot(project, request);
    const cwd = this.resolveCwd(workspace.root, request.relativeCwd || ".");
    const args = safeArguments(request.args || []);
    this.validateTool(tool, args, workspace.root, cwd);
    const requestedAction = String(request.action || tool.actions[0] || "");
    if (!tool.actions.includes(requestedAction)) throw executionError("TOOL_ACTION_DENIED", "La herramienta no declaró la acción solicitada.");
    if (request.host || request.mayUseNetwork === true || tool.networkBehavior === "REQUIRES_NETWORK") {
      throw executionError("EXECUTION_NETWORK_TARGET_REQUIRED", "Este target local no puede demostrar aislamiento de red; la ejecución quedó bloqueada.");
    }
    const policyRequest = {
      action: requestedAction, path: workspace.identity.root, toolId: tool.toolId, args,
      irreversible: request.irreversible === true, secret: request.secret === true
    };
    const policyDecision = this.policyEngine.authorize(project, policyRequest, options.approval || null);
    const environment = safeEnvironment(request.environment || {}, tool.internalEnvironment);
    const executionId = crypto.randomUUID();
    const controller = new AbortController();
    const startedAt = new Date().toISOString();
    const child = this.spawn(tool.executable, args, {
      cwd, env: environment, windowsHide: true, shell: false, detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const active = { executionId, child, controller, projectId: workspace.identity.projectId, timedOut: false, cancelled: false };
    this.active.set(executionId, active);
    const terminate = (reason, timedOut = false) => {
      if (controller.signal.aborted) return;
      active.timedOut = timedOut;
      active.cancelled = !timedOut;
      controller.abort(reason);
      try {
        if (process.platform !== "win32" && Number.isInteger(child.pid)) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch { try { child.kill(); } catch {} }
    };
    if (options.signal) {
      if (options.signal.aborted) terminate(options.signal.reason || executionError("EXECUTION_CANCELLED", "Ejecución cancelada."));
      else options.signal.addEventListener("abort", () => terminate(options.signal.reason || executionError("EXECUTION_CANCELLED", "Ejecución cancelada.")), { once: true });
    }
    const timeoutMs = Math.max(100, Math.min(30 * 60_000, Number(request.timeoutMs) || 15 * 60_000));
    const promise = new Promise((resolve, reject) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let truncated = false;
      const append = (current, chunk) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const available = this.maxOutputBytes - current.length;
        if (available <= 0) { truncated = true; return current; }
        if (bytes.length > available) truncated = true;
        return Buffer.concat([current, bytes.subarray(0, Math.max(0, available))]);
      };
      child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
      child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
      const timeout = setTimeout(() => terminate(executionError("EXECUTION_TIMEOUT", "La ejecución excedió el tiempo permitido."), true), timeoutMs);
      timeout.unref?.();
      child.once("error", (error) => {
        clearTimeout(timeout);
        this.active.delete(executionId);
        reject(executionError(error.code || "EXECUTION_SPAWN_FAILED", redact(error.message || error)));
      });
      child.once("close", (exitCode, signal) => {
        clearTimeout(timeout);
        this.active.delete(executionId);
        const completedAt = new Date().toISOString();
        const result = {
          schema: "dorn.execution-result/1", executionId, projectId: workspace.identity.projectId,
          workUnitId: workspace.unit?.workUnitId || null, toolId: tool.toolId, args: args.map(redact),
          cwdRelative: path.relative(workspace.root, cwd).replaceAll("\\", "/") || ".",
          exitCode: Number.isInteger(exitCode) ? exitCode : null, signal: signal || null,
          stdout: redact(stdout.toString("utf8")), stderr: redact(stderr.toString("utf8")), truncated,
          timedOut: active.timedOut, cancelled: active.cancelled, startedAt, completedAt,
          policy: { decision: policyDecision.decision, reason: policyDecision.reason },
          isolation: {
            filesystem: workspace.isolation,
            processTree: tool.argumentPolicy === "WSL_SCOPED_NODE"
              ? "WSL_TREE_NEEDS_WINDOWS_JOB_OBJECT_RETEST"
              : process.platform === "win32" ? "CHILD_ONLY_NEEDS_WINDOWS_JOB_OBJECT_RETEST" : "POSIX_PROCESS_GROUP",
            network: tool.argumentPolicy === "WSL_SCOPED_NODE" ? "WSL_NETWORK_NOT_ENFORCED_P0" : "NOT_ENFORCED_LOCAL_TARGET"
          },
          truthState: exitCode === 0 && !active.timedOut && !active.cancelled ? "EXECUTED" : active.cancelled ? "CANCELLED" : "FAILED"
        };
        if (!workspace.unit && request.recordEvidence === true && Array.isArray(request.files) && request.files.length) {
          result.evidence = this.evidenceCore?.record(project, {
            evidenceType: "COMMAND", command: `${tool.toolId} ${args.map(redact).join(" ")}`,
            result: result.truthState === "EXECUTED" ? "PASSED" : "FAILED", exitCode: result.exitCode,
            truthState: result.truthState === "EXECUTED" ? "EXECUTED" : "FAILED", files: request.files,
            environment: { independent: false, isolation: result.isolation }, tasks: request.jobId ? [request.jobId] : []
          });
        }
        if (result.truthState === "EXECUTED") resolve(result);
        else reject(executionError(active.timedOut ? "EXECUTION_TIMEOUT" : active.cancelled ? "EXECUTION_CANCELLED" : "EXECUTION_FAILED", result.stderr || `La herramienta terminó con código ${result.exitCode}.`, { execution: result }));
      });
    });
    return { executionId, promise, cancel: () => terminate(executionError("EXECUTION_CANCELLED", "Ejecución cancelada.")) };
  }

  cancel(executionId) {
    const record = this.active.get(String(executionId));
    if (!record) return false;
    try {
      if (process.platform !== "win32" && Number.isInteger(record.child.pid)) process.kill(-record.child.pid, "SIGTERM");
      else record.child.kill("SIGTERM");
    } catch { try { record.child.kill(); } catch {} }
    record.cancelled = true;
    record.controller.abort(executionError("EXECUTION_CANCELLED", "Ejecución cancelada."));
    return true;
  }

  stop() {
    for (const executionId of [...this.active.keys()]) this.cancel(executionId);
  }
}

module.exports = {
  ExecutionCore, SAFE_ENVIRONMENT_KEYS, SECRET_REDACTIONS, redact, digestFile, findExecutable,
  safeEnvironment, safeArguments, validateNodeArguments, validateGitArguments, validateWslScopedNodeArguments
};
