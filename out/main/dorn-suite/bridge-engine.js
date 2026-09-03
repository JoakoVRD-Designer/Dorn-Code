"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  DornSuiteError,
  ensureDirectory,
  atomicJson,
  readJson,
  sha256File,
  safeRelativeRoot,
  now
} = require("./common");

const BRIDGE_SCHEMA = "dorn-bridge/1";
const ALLOWED_CAPABILITIES = new Set([
  "import-3d",
  "export-3d",
  "inspect-3d",
  "render-image",
  "render-animation",
  "convert-format",
  "run-script"
]);
const ARGUMENT_TOKENS = new Set(["{request}", "{response}", "{workspace}"]);

function bridgeError(code, message, options = {}) {
  return new DornSuiteError(code, "bridge", message, options);
}

function validateId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/i.test(id)) {
    throw bridgeError("DORN-BRIDGE-001", "El conector no tiene un identificador válido.");
  }
  return id;
}

function validateManifest(input) {
  if (!input || typeof input !== "object") {
    throw bridgeError("DORN-BRIDGE-002", "Falta el manifiesto del conector.");
  }
  const executable = path.resolve(String(input.executable || ""));
  let stat;
  try {
    stat = fs.statSync(executable);
  } catch {
    throw bridgeError("DORN-BRIDGE-003", "No se encontró el ejecutable autorizado del conector.");
  }
  if (!stat.isFile()) throw bridgeError("DORN-BRIDGE-004", "El ejecutable del conector no es un archivo.");
  const capabilities = Array.isArray(input.capabilities)
    ? Array.from(new Set(input.capabilities.map(String)))
    : [];
  if (!capabilities.length || capabilities.some((capability) => !ALLOWED_CAPABILITIES.has(capability))) {
    throw bridgeError("DORN-BRIDGE-005", "El conector solicita una capacidad desconocida.");
  }
  const argumentsTemplate = Array.isArray(input.arguments)
    ? input.arguments.map((argument) => String(argument))
    : ["{request}", "{response}"];
  if (argumentsTemplate.some((argument) => argument.includes("{") && !ARGUMENT_TOKENS.has(argument))) {
    throw bridgeError("DORN-BRIDGE-006", "Los argumentos contienen una variable no permitida.");
  }
  if (!argumentsTemplate.includes("{request}") || !argumentsTemplate.includes("{response}")) {
    throw bridgeError("DORN-BRIDGE-007", "El conector debe recibir las rutas de solicitud y respuesta.");
  }
  return {
    schema: BRIDGE_SCHEMA,
    id: validateId(input.id),
    name: String(input.name || input.id).trim().slice(0, 160),
    application: String(input.application || input.name || input.id).trim().slice(0, 160),
    version: String(input.version || "1.0.0").trim().slice(0, 80),
    executable,
    executableSha256: sha256File(executable),
    arguments: argumentsTemplate,
    capabilities,
    inputFormats: Array.isArray(input.inputFormats) ? input.inputFormats.map((value) => String(value).toLowerCase()) : [],
    outputFormats: Array.isArray(input.outputFormats) ? input.outputFormats.map((value) => String(value).toLowerCase()) : [],
    source: String(input.source || "user-provided").slice(0, 120),
    license: String(input.license || "unspecified").slice(0, 160),
    isolation: "isolated-files-minimal-environment",
    enabled: false,
    registeredAt: now()
  };
}

function spawnConnector(executable, argumentsList, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argumentsList, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH || "",
        SystemRoot: process.env.SystemRoot || "",
        WINDIR: process.env.WINDIR || "",
        TEMP: options.cwd,
        TMP: options.cwd,
        DORN_BRIDGE_PROTOCOL: BRIDGE_SCHEMA
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next) > 1024 * 1024) {
        child.kill();
        finish(bridgeError("DORN-BRIDGE-008", "El conector produjo demasiada salida."));
        return current;
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => finish(null, { code, signal, stdout, stderr }));
    const timer = setTimeout(() => {
      child.kill();
      finish(bridgeError("DORN-BRIDGE-009", "El conector superó el tiempo máximo.", {
        retryable: true
      }));
    }, options.timeoutMs);
  });
}

function collectArtifacts(workspace, descriptors) {
  const result = [];
  let totalBytes = 0;
  for (const descriptor of descriptors) {
    const relativePath = String(descriptor.relativePath || descriptor.path || "");
    const { target } = safeRelativeRoot(workspace, relativePath);
    const real = fs.realpathSync(target);
    if (real !== target) {
      throw bridgeError("DORN-BRIDGE-010", "El conector devolvió un enlace simbólico no permitido.");
    }
    const stat = fs.statSync(real);
    if (!stat.isFile()) throw bridgeError("DORN-BRIDGE-011", "El artefacto del conector no es un archivo.");
    totalBytes += stat.size;
    if (totalBytes > 20 * 1024 * 1024 * 1024) {
      throw bridgeError("DORN-BRIDGE-012", "Los artefactos superan el límite de 20 GB por trabajo.");
    }
    result.push({
      name: path.basename(real),
      relativePath,
      absolutePath: real,
      sizeBytes: stat.size,
      sha256: sha256File(real),
      mediaType: String(descriptor.mediaType || "application/octet-stream")
    });
  }
  return result;
}

class DornBridgeEngine {
  constructor(stateRoot, options = {}) {
    this.root = ensureDirectory(path.join(stateRoot, "bridge"));
    this.connectorsRoot = ensureDirectory(path.join(this.root, "connectors"));
    this.jobsRoot = ensureDirectory(path.join(this.root, "jobs"));
    this.audit = options.audit || (() => {});
  }

  connectorPath(id) {
    return path.join(this.connectorsRoot, `${validateId(id)}.json`);
  }

  list() {
    return fs.readdirSync(this.connectorsRoot)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson(path.join(this.connectorsRoot, name), null))
      .filter(Boolean)
      .map((connector) => ({
        ...connector,
        executableAvailable: fs.existsSync(connector.executable),
        executableUnchanged: fs.existsSync(connector.executable)
          ? sha256File(connector.executable) === connector.executableSha256
          : false
      }));
  }

  inspect(manifest) {
    const connector = validateManifest(manifest);
    return {
      connector,
      warnings: [
        connector.license === "unspecified" ? "No se indicó la licencia del código adaptador." : null,
        "El adaptador es un programa externo y conserva los permisos de la cuenta de Windows. DORN limita entradas, entorno y resultados, pero no sustituye el sandbox del proveedor.",
        "El conector se instalará desactivado hasta que lo habilites."
      ].filter(Boolean)
    };
  }

  register(manifest, approvedCapabilities) {
    const connector = validateManifest(manifest);
    const approved = new Set(Array.isArray(approvedCapabilities) ? approvedCapabilities.map(String) : []);
    const missing = connector.capabilities.filter((capability) => !approved.has(capability));
    if (missing.length) {
      throw bridgeError("DORN-BRIDGE-013", `Falta autorizar: ${missing.join(", ")}.`);
    }
    atomicJson(this.connectorPath(connector.id), connector);
    this.audit(null, "bridge.registered", {
      id: connector.id,
      application: connector.application,
      capabilities: connector.capabilities,
      executableSha256: connector.executableSha256
    });
    return connector;
  }

  setEnabled(id, enabled) {
    const connector = readJson(this.connectorPath(id), null);
    if (!connector) throw bridgeError("DORN-BRIDGE-014", "El conector no está registrado.");
    if (enabled) {
      if (!fs.existsSync(connector.executable) || sha256File(connector.executable) !== connector.executableSha256) {
        throw bridgeError("DORN-BRIDGE-015", "El ejecutable cambió; vuelve a revisar el conector.");
      }
    }
    connector.enabled = Boolean(enabled);
    connector.updatedAt = now();
    atomicJson(this.connectorPath(id), connector);
    return connector;
  }

  remove(id) {
    const target = this.connectorPath(id);
    if (!fs.existsSync(target)) return false;
    fs.rmSync(target, { force: true });
    this.audit(null, "bridge.removed", { id });
    return true;
  }

  async run(id, operation, projectRoot, input = {}, options = {}) {
    const connector = readJson(this.connectorPath(id), null);
    if (!connector || !connector.enabled) {
      throw bridgeError("DORN-BRIDGE-016", "El conector no está instalado o está desactivado.");
    }
    if (!connector.capabilities.includes(operation)) {
      throw bridgeError("DORN-BRIDGE-017", `El conector no tiene permiso para ${operation}.`);
    }
    if (!fs.existsSync(connector.executable) || sha256File(connector.executable) !== connector.executableSha256) {
      throw bridgeError("DORN-BRIDGE-018", "El ejecutable del conector cambió desde su autorización.");
    }
    const jobId = crypto.randomUUID();
    const workspace = ensureDirectory(path.join(this.jobsRoot, jobId));
    const inputRoot = ensureDirectory(path.join(workspace, "input"));
    ensureDirectory(path.join(workspace, "output"));
    const requestInput = { ...input };
    if (input.relativePath) {
      const source = safeRelativeRoot(projectRoot, input.relativePath).target;
      const stat = fs.statSync(source);
      if (!stat.isFile()) throw bridgeError("DORN-BRIDGE-019", "La entrada seleccionada no es un archivo.");
      const copied = path.join(inputRoot, path.basename(source));
      fs.copyFileSync(source, copied);
      requestInput.file = {
        name: path.basename(source),
        path: copied,
        sizeBytes: stat.size,
        sha256: sha256File(copied)
      };
      delete requestInput.relativePath;
    }
    const requestPath = path.join(workspace, "request.json");
    const responsePath = path.join(workspace, "response.json");
    atomicJson(requestPath, {
      schema: BRIDGE_SCHEMA,
      jobId,
      operation,
      input: requestInput,
      outputDirectory: path.join(workspace, "output")
    });
    const argumentsList = connector.arguments.map((argument) => ({
      "{request}": requestPath,
      "{response}": responsePath,
      "{workspace}": workspace
    })[argument] || argument);
    const startedAt = Date.now();
    const processResult = await spawnConnector(connector.executable, argumentsList, {
      cwd: workspace,
      timeoutMs: Math.min(Math.max(Number(options.timeoutMs || 180000), 1000), 30 * 60 * 1000)
    });
    if (processResult.code !== 0) {
      throw bridgeError("DORN-BRIDGE-020", `El conector terminó con código ${processResult.code}.`, {
        detail: processResult.stderr.slice(-2000),
        retryable: true
      });
    }
    if (!fs.existsSync(responsePath) || fs.statSync(responsePath).size > 2 * 1024 * 1024) {
      throw bridgeError("DORN-BRIDGE-021", "El conector no produjo una respuesta válida.");
    }
    const response = readJson(responsePath, null);
    if (!response || response.schema !== BRIDGE_SCHEMA || response.jobId !== jobId) {
      throw bridgeError("DORN-BRIDGE-022", "La respuesta no corresponde al trabajo solicitado.");
    }
    if (response.status !== "completed") {
      throw bridgeError("DORN-BRIDGE-023", String(response.message || "El conector no completó el trabajo."));
    }
    const artifacts = collectArtifacts(workspace, Array.isArray(response.artifacts) ? response.artifacts : []);
    const result = {
      jobId,
      connectorId: connector.id,
      application: connector.application,
      operation,
      status: "completed",
      message: String(response.message || "Trabajo completado."),
      metrics: response.metrics && typeof response.metrics === "object" ? response.metrics : {},
      artifacts,
      durationMs: Date.now() - startedAt,
      log: {
        stdout: processResult.stdout.slice(-4000),
        stderr: processResult.stderr.slice(-4000)
      }
    };
    atomicJson(path.join(workspace, "result.json"), result);
    this.audit(null, "bridge.completed", {
      jobId,
      connectorId: connector.id,
      operation,
      artifacts: artifacts.map((artifact) => ({
        name: artifact.name,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256
      })),
      durationMs: result.durationMs
    });
    return result;
  }

  cleanupJobs(maxAgeHours = 72) {
    const threshold = Date.now() - Math.max(1, maxAgeHours) * 60 * 60 * 1000;
    const removed = [];
    for (const entry of fs.readdirSync(this.jobsRoot, { withFileTypes: true })) {
      const target = path.join(this.jobsRoot, entry.name);
      if (fs.statSync(target).mtimeMs < threshold) {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(entry.name);
      }
    }
    return { removed, checkedAt: now() };
  }
}

module.exports = {
  BRIDGE_SCHEMA,
  ALLOWED_CAPABILITIES,
  DornBridgeEngine,
  validateManifest
};
