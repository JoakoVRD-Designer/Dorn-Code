"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { containsSecret } = require("./policy-engine");

const AGENT_RUNTIME_CONTRACT_VERSION = "1";
const ADAPTER_METHODS = Object.freeze([
  "healthCheck", "discoverCapabilities", "discoverModelsOrRoutes", "startSession", "resumeSession",
  "runTask", "streamEvents", "collectArtifacts", "collectUsage", "cancel", "checkpoint", "benchmark"
]);
const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  "PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL", "ComSpec"
]);

function runtimeError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }

function redact(value) {
  return String(value || "")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, "[OCULTO]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [OCULTO]")
    .replace(/\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[OCULTO]");
}

function containsSensitiveField(value, depth = 0) {
  if (depth > 16 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveField(item, depth + 1));
  return Object.entries(value).some(([key, item]) => {
    const normalized = String(key).replace(/[-_]/g, "").toLowerCase();
    if (/^(?:api|access|refresh|auth)?token$/.test(normalized) || /^(?:apikey|secret|password|authorization|cookie|credential|credentials)$/.test(normalized)) return true;
    return containsSensitiveField(item, depth + 1);
  });
}

function safeJson(value, maximum, label) {
  let json;
  try { json = JSON.stringify(value); }
  catch { throw runtimeError("AGENT_RUNTIME_MANIFEST_INVALID", `${label} no es JSON serializable.`); }
  if (Buffer.byteLength(json, "utf8") > maximum) throw runtimeError("AGENT_RUNTIME_MANIFEST_TOO_LARGE", `${label} excede el límite seguro.`);
  if (containsSensitiveField(value) || containsSecret(json)) throw runtimeError("AGENT_RUNTIME_SECRET_INLINE", `${label} contiene una credencial y fue rechazado.`);
  return JSON.parse(json);
}

function runtimeId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z][a-z0-9_.-]{1,79}$/.test(id)) throw runtimeError("AGENT_RUNTIME_ID_INVALID", "El runtime necesita una identidad estable.");
  return id;
}

function executableFingerprint(filePath) {
  const resolved = fs.realpathSync(filePath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw runtimeError("AGENT_RUNTIME_EXECUTABLE_UNSAFE", "El ejecutable del runtime no es un archivo regular.");
  if (stat.size <= 0 || stat.size > 1024 * 1024 * 1024) throw runtimeError("AGENT_RUNTIME_EXECUTABLE_UNSAFE", "El ejecutable del runtime tiene un tamaño inválido.");
  if (process.platform !== "win32" && (stat.mode & 0o111) === 0) throw runtimeError("AGENT_RUNTIME_EXECUTABLE_NOT_EXECUTABLE", "El archivo del runtime no tiene permiso de ejecución.");
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const chunk = Buffer.allocUnsafe(512 * 1024);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      throw runtimeError("AGENT_RUNTIME_EXECUTABLE_RACE", "El ejecutable cambió mientras se inspeccionaba.");
    }
    let read = 0;
    do { read = fs.readSync(descriptor, chunk, 0, chunk.length, null); if (read) hash.update(chunk.subarray(0, read)); } while (read);
  } finally { fs.closeSync(descriptor); }
  return {
    path: resolved, sha256: hash.digest("hex"), bytes: stat.size, mode: stat.mode & 0o777,
    modifiedMs: Math.trunc(stat.mtimeMs)
  };
}

function executableExtensions(platform = process.platform, rawPathext = process.env.PATHEXT || ".EXE;.CMD;.BAT") {
  if (platform !== "win32") return [""];
  const available = rawPathext.split(";").map((item) => item.trim().toUpperCase()).filter(Boolean);
  return [".EXE", ...available.filter((item) => item !== ".EXE")];
}

function findExecutable(command, options = {}) {
  const requested = String(command || "").trim();
  if (!requested || requested.includes("\0")) return null;
  const platform = options.platform || process.platform;
  const environmentPath = options.environmentPath ?? process.env.PATH ?? "";
  const candidates = [];
  if (path.isAbsolute(requested)) candidates.push(requested);
  else {
    if (requested.includes("/") || requested.includes("\\")) return null;
    for (const directory of environmentPath.split(path.delimiter).filter(Boolean)) {
      for (const extension of executableExtensions(platform, options.pathext)) {
        candidates.push(path.join(directory, platform === "win32" ? `${requested}${extension}` : requested));
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const original = fs.lstatSync(candidate);
      if (!original.isFile() && !original.isSymbolicLink()) continue;
      const fingerprint = executableFingerprint(candidate);
      const extension = path.extname(candidate).toLowerCase();
      const wrapperRequiresShell = platform === "win32" && [".cmd", ".bat"].includes(extension);
      return { command: requested, candidate: path.resolve(candidate), fromSymlink: original.isSymbolicLink(), wrapperRequiresShell, ...fingerprint };
    } catch {}
  }
  return null;
}

function sameFingerprint(left, right) {
  return Boolean(left && right && left.path === right.path && left.sha256 === right.sha256 && left.bytes === right.bytes && left.modifiedMs === right.modifiedMs);
}

function safeEnvironment(environmentPath) {
  const environment = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) if (process.env[key]) environment[key] = process.env[key];
  environment.PATH = String(environmentPath ?? environment.PATH ?? "");
  environment.CI = "1";
  environment.NO_COLOR = "1";
  return environment;
}

class CodexAgentRuntimeAdapter {
  constructor(options = {}) {
    this.environmentPath = options.environmentPath ?? process.env.PATH ?? "";
    this.spawnSync = options.spawnSync || childProcess.spawnSync;
  }

  runtimeId = "openai-codex";
  contractVersion = AGENT_RUNTIME_CONTRACT_VERSION;
  environmentPath;
  spawnSync;
  manifest = Object.freeze({
    schema: "dorn.agent-runtime-adapter/1", runtimeId: "openai-codex", label: "OpenAI Codex CLI",
    vendor: "OpenAI", source: "SYSTEM_PATH", license: null, commands: ["codex"],
    transport: "CLI_DISCOVERY", maturity: "FOUNDATION_NEEDS_LIVE_RETEST",
    operations: {
      healthCheck: "AVAILABLE", discoverCapabilities: "AVAILABLE", discoverModelsOrRoutes: "AVAILABLE",
      startSession: "NOT_IMPLEMENTED", resumeSession: "NOT_IMPLEMENTED", runTask: "NOT_IMPLEMENTED",
      streamEvents: "NOT_IMPLEMENTED", collectArtifacts: "NOT_IMPLEMENTED", collectUsage: "NOT_IMPLEMENTED",
      cancel: "NOT_IMPLEMENTED", checkpoint: "DORN_BROKER_OWNED", benchmark: "NOT_IMPLEMENTED"
    }
  });

  discover() {
    const executable = this.manifest.commands.map((command) => findExecutable(command, { environmentPath: this.environmentPath })).find(Boolean) || null;
    const state = !executable ? "NOT_INSTALLED" : executable.wrapperRequiresShell ? "WINDOWS_SHELL_ADAPTER_REQUIRED" : "DISCOVERED_UNVERIFIED";
    return {
      schema: "dorn.agent-runtime-observation/1", runtimeId: this.runtimeId, contractVersion: this.contractVersion,
      installed: Boolean(executable), state, executable, observedAt: new Date().toISOString()
    };
  }

  probe(observation, args, timeoutMs = 5_000) {
    if (!observation?.executable) throw runtimeError("AGENT_RUNTIME_NOT_INSTALLED", `${this.manifest.label} no está instalado o no es detectable.`);
    if (observation.executable.wrapperRequiresShell) throw runtimeError("AGENT_RUNTIME_WINDOWS_SHELL_REQUIRED", "El runtime sólo apareció como .cmd/.bat y requiere el Windows Shell Adapter antes de ejecutarse.");
    const before = executableFingerprint(observation.executable.path);
    if (!sameFingerprint(before, observation.executable)) throw runtimeError("AGENT_RUNTIME_EXECUTABLE_CHANGED", "El ejecutable cambió después de ser descubierto.");
    const result = this.spawnSync(before.path, args, {
      encoding: "utf8", timeout: timeoutMs, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
      env: safeEnvironment(this.environmentPath), maxBuffer: 512 * 1024
    });
    const after = executableFingerprint(before.path);
    if (!sameFingerprint(before, after)) throw runtimeError("AGENT_RUNTIME_EXECUTABLE_CHANGED_DURING_PROBE", "El ejecutable cambió durante el probe y debe revisarse de nuevo.");
    return {
      exitCode: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal || null,
      errorCode: result.error?.code || null,
      stdout: redact(result.stdout).slice(0, 512 * 1024), stderr: redact(result.stderr).slice(0, 512 * 1024),
      executable: after
    };
  }

  healthCheck() {
    const observation = this.discover();
    if (!observation.installed) return { ...observation, health: "NOT_INSTALLED", version: null, exitCode: null };
    if (observation.executable.wrapperRequiresShell) return { ...observation, health: "BLOCKED", blocker: "WINDOWS_SHELL_ADAPTER_REQUIRED", version: null, exitCode: null };
    const started = Date.now();
    let probe;
    try { probe = this.probe(observation, ["--version"]); }
    catch (error) {
      return { ...observation, health: "DEGRADED", error: { code: error.code || "AGENT_RUNTIME_PROBE_FAILED", message: redact(error.message).slice(0, 2000) }, version: null, exitCode: null, latencyMs: Date.now() - started };
    }
    const version = String(probe.stdout || probe.stderr || "").trim().split(/\r?\n/)[0].slice(0, 500) || null;
    return {
      ...observation, executable: probe.executable,
      health: probe.exitCode === 0 && version ? "HEALTHY" : "DEGRADED", version, exitCode: probe.exitCode,
      errorCode: probe.errorCode, latencyMs: Date.now() - started
    };
  }

  discoverCapabilities() {
    const health = this.healthCheck();
    if (health.health !== "HEALTHY") return { runtimeId: this.runtimeId, state: "NOT_EXECUTED", health, capabilities: [], source: "NO_LIVE_HELP" };
    let probe;
    try { probe = this.probe(health, ["--help"]); }
    catch (error) { return { runtimeId: this.runtimeId, state: "FAILED", health, capabilities: [], error: { code: error.code || "AGENT_RUNTIME_HELP_FAILED", message: redact(error.message).slice(0, 2000) }, source: "LIVE_CLI_HELP" }; }
    if (probe.exitCode !== 0) return { runtimeId: this.runtimeId, state: "FAILED", health, capabilities: [], exitCode: probe.exitCode, source: "LIVE_CLI_HELP" };
    const help = `${probe.stdout}\n${probe.stderr}`;
    const detectors = [
      ["task.run", /\bexec\b|non-interactive/i], ["session.resume", /\bresume\b/i],
      ["structured-output", /--json\b|jsonl|json lines/i], ["sandbox", /--sandbox\b|sandboxed/i],
      ["model.select", /--model\b|\bmodel\b/i], ["mcp", /\bmcp\b/i], ["skills", /\bskills?\b/i]
    ];
    const capabilities = detectors.filter(([, pattern]) => pattern.test(help)).map(([capability]) => capability).sort();
    return {
      runtimeId: this.runtimeId, state: "OBSERVED", health, capabilities, source: "LIVE_CLI_HELP",
      helpHash: crypto.createHash("sha256").update(help).digest("hex"), observedAt: new Date().toISOString()
    };
  }

  discoverModelsOrRoutes() {
    const health = this.healthCheck();
    return {
      runtimeId: this.runtimeId, state: health.health === "HEALTHY" ? "OBSERVED_LOCAL_ROUTE" : "NOT_EXECUTED",
      routes: health.health === "HEALTHY" ? [{ routeId: "openai-codex:local-cli", transport: "LOCAL_CLI", executableSha256: health.executable.sha256 }] : [],
      models: [], modelDiscovery: "NOT_IMPLEMENTED", health
    };
  }

  unavailable(operation) { throw runtimeError("AGENT_RUNTIME_OPERATION_UNAVAILABLE", `${operation} todavía no tiene una ruta Codex estructurada verificada.`, { runtimeId: this.runtimeId, operation }); }
  startSession() { return this.unavailable("startSession"); }
  resumeSession() { return this.unavailable("resumeSession"); }
  runTask() { return this.unavailable("runTask"); }
  streamEvents() { return this.unavailable("streamEvents"); }
  collectArtifacts() { return this.unavailable("collectArtifacts"); }
  collectUsage() { return this.unavailable("collectUsage"); }
  cancel() { return this.unavailable("cancel"); }
  checkpoint() { return this.unavailable("checkpoint"); }
  benchmark() { return this.unavailable("benchmark"); }
}

class AgentRuntimeRegistry {
  constructor(options = {}) {
    if (!options.sessionBroker) throw new Error("Agent Runtime Registry necesita Agent Session Broker.");
    this.sessionBroker = options.sessionBroker;
    this.adapters = new Map();
    this.register(options.codexAdapter || new CodexAgentRuntimeAdapter(options));
  }

  sessionBroker;
  adapters;

  register(adapter) {
    if (!adapter || typeof adapter !== "object") throw runtimeError("AGENT_RUNTIME_ADAPTER_INVALID", "El adapter debe ser un objeto explícito.");
    const id = runtimeId(adapter.runtimeId);
    if (String(adapter.contractVersion || "") !== AGENT_RUNTIME_CONTRACT_VERSION) throw runtimeError("AGENT_RUNTIME_CONTRACT_INCOMPATIBLE", "El adapter usa una versión de contrato incompatible.");
    for (const method of ["discover", ...ADAPTER_METHODS]) if (typeof adapter[method] !== "function") throw runtimeError("AGENT_RUNTIME_ADAPTER_INVALID", `El adapter no implementa ${method}().`);
    const manifest = safeJson(adapter.manifest, 256 * 1024, "Agent Runtime manifest");
    if (manifest.runtimeId !== id || manifest.schema !== "dorn.agent-runtime-adapter/1") throw runtimeError("AGENT_RUNTIME_MANIFEST_INVALID", "El manifest no coincide con la identidad del adapter.");
    if (this.adapters.has(id)) throw runtimeError("AGENT_RUNTIME_DUPLICATE", "Ya existe un adapter con esta identidad.");
    this.adapters.set(id, adapter);
    return this.status(id);
  }

  get(id) {
    const adapter = this.adapters.get(runtimeId(id));
    if (!adapter) throw runtimeError("AGENT_RUNTIME_UNKNOWN", "Agent Runtime desconocido.");
    return adapter;
  }

  status(id) {
    const adapter = this.get(id);
    const observation = adapter.discover();
    return {
      ...safeJson(adapter.manifest, 256 * 1024, "Agent Runtime manifest"),
      contractVersion: adapter.contractVersion,
      observation,
      taskReady: observation.state === "VERIFIED_TASK_READY"
    };
  }

  list() { return [...this.adapters.keys()].sort().map((id) => this.status(id)); }
  healthCheck(id) { return this.get(id).healthCheck(); }
  discoverCapabilities(id) { return this.get(id).discoverCapabilities(); }
  discoverModelsOrRoutes(id) { return this.get(id).discoverModelsOrRoutes(); }

  prepareSession(project, input = {}) {
    const adapter = this.get(input.runtimeId);
    const health = adapter.healthCheck();
    if (health.health !== "HEALTHY") throw runtimeError("AGENT_RUNTIME_NOT_AVAILABLE", `${adapter.manifest.label} no está saludable para crear una sesión.`, { health });
    if (adapter.manifest.operations?.startSession !== "AVAILABLE") {
      throw runtimeError("AGENT_RUNTIME_OPERATION_UNAVAILABLE", `${adapter.manifest.label} está detectable, pero startSession todavía no tiene una implementación verificada.`, { health, operation: "startSession" });
    }
    if (!input.contextPackId) throw runtimeError("AGENT_RUNTIME_CONTEXT_REQUIRED", "Un runtime no puede iniciar una tarea sin un ContextPack fresco y acotado.");
    const session = this.sessionBroker.create(project, input);
    this.sessionBroker.recordHealth(project, session.sessionId, { state: "HEALTHY", reason: `${health.version || "Runtime"} verificado por --version.` });
    return { session: this.sessionBroker.get(project, session.sessionId), runtime: health };
  }

  prepareHandoff(project, sessionId, input = {}) {
    const target = this.get(input.toRuntimeId);
    const health = target.healthCheck();
    if (health.health !== "HEALTHY") throw runtimeError("AGENT_HANDOFF_TARGET_UNAVAILABLE", `${target.manifest.label} no está saludable para recibir el handoff.`, { health });
    return this.sessionBroker.createHandoff(project, sessionId, input);
  }
}

module.exports = {
  AgentRuntimeRegistry, CodexAgentRuntimeAdapter, AGENT_RUNTIME_CONTRACT_VERSION, ADAPTER_METHODS,
  findExecutable, executableFingerprint, sameFingerprint, safeEnvironment, redact
};
