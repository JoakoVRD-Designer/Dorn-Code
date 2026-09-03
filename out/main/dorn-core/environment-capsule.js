"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const semver = require("semver");
const { atomicJson } = require("../dorn-suite/common");
const { projectIdentity } = require("./job-runtime");
const { containsSecret } = require("./policy-engine");
const { digestFile, findExecutable, safeEnvironment, redact } = require("./execution-core");

const REQUIREMENT_KINDS = new Set(["OS", "TOOLCHAIN", "SDK", "RUNTIME", "PACKAGE_MANAGER", "SERVICE", "CONTAINER", "ENVIRONMENT"]);
const TARGET_OS = new Set(["windows", "linux", "macos", "android", "ios", "web", "embedded", "any"]);
const SECRET_NAME = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASS|AUTHORIZATION|CREDENTIAL|PRIVATE_?KEY)(?:$|_)/i;
const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_ID = /^[a-z][a-z0-9_.-]{1,99}$/;
const TOOL_PROBES = Object.freeze({
  node: { executable: "node", args: ["--version"], kind: "RUNTIME" },
  npm: { executable: "npm", args: ["--version"], kind: "PACKAGE_MANAGER" },
  pnpm: { executable: "pnpm", args: ["--version"], kind: "PACKAGE_MANAGER" },
  yarn: { executable: "yarn", args: ["--version"], kind: "PACKAGE_MANAGER" },
  bun: { executable: "bun", args: ["--version"], kind: "RUNTIME" },
  deno: { executable: "deno", args: ["--version"], kind: "RUNTIME" },
  python: { executable: process.platform === "win32" ? "python" : "python3", args: ["--version"], kind: "RUNTIME" },
  pip: { executable: process.platform === "win32" ? "pip" : "pip3", args: ["--version"], kind: "PACKAGE_MANAGER" },
  uv: { executable: "uv", args: ["--version"], kind: "PACKAGE_MANAGER" },
  poetry: { executable: "poetry", args: ["--version"], kind: "PACKAGE_MANAGER" },
  git: { executable: "git", args: ["--version"], kind: "TOOLCHAIN" },
  java: { executable: "java", args: ["-version"], kind: "RUNTIME" },
  gradle: { executable: "gradle", args: ["--version"], kind: "TOOLCHAIN" },
  dotnet: { executable: "dotnet", args: ["--version"], kind: "SDK" },
  go: { executable: "go", args: ["version"], kind: "TOOLCHAIN" },
  rustc: { executable: "rustc", args: ["--version"], kind: "TOOLCHAIN" },
  cargo: { executable: "cargo", args: ["--version"], kind: "PACKAGE_MANAGER" },
  cmake: { executable: "cmake", args: ["--version"], kind: "TOOLCHAIN" },
  ninja: { executable: "ninja", args: ["--version"], kind: "TOOLCHAIN" },
  godot: { executable: "godot", args: ["--version"], kind: "RUNTIME" },
  adb: { executable: "adb", args: ["version"], kind: "SDK" },
  platformio: { executable: "platformio", args: ["--version"], kind: "TOOLCHAIN" },
  docker: { executable: "docker", args: ["--version"], kind: "CONTAINER" },
  podman: { executable: "podman", args: ["--version"], kind: "CONTAINER" }
});

function capsuleError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function timestamp() { return new Date().toISOString(); }
function text(value, maximum, fallback = "") { return (String(value ?? "").trim() || fallback).slice(0, maximum); }
function digest(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return structuredClone(fallback); } }
function canonicalPlatform() { return process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform; }
function canonicalArch(value = process.arch) {
  const arch = String(value).toLowerCase();
  return ({ x64: "x64", amd64: "x64", arm64: "arm64", aarch64: "arm64", ia32: "x86" })[arch] || arch.slice(0, 40);
}
function canonicalVersion(raw) {
  const source = text(raw, 500);
  const match = source.match(/(?:^|[^0-9])v?(\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?)/);
  if (!match) return { raw: source, version: null };
  const coerced = semver.coerce(match[1], { loose: true });
  return { raw: source, version: coerced?.version || null };
}
function validRange(raw) {
  const range = text(raw, 100, "*");
  if (range === "*" || range.toLowerCase() === "latest") return "*";
  const valid = semver.validRange(range, { loose: true });
  if (!valid) throw capsuleError("ENVIRONMENT_VERSION_RANGE_INVALID", `Rango de versión no verificable: ${range}`);
  return valid;
}
function versionSatisfies(version, range) {
  if (range === "*") return Boolean(version);
  return Boolean(version && semver.satisfies(version, range, { includePrerelease: true, loose: true }));
}
function safeRelative(root, rawPath) {
  const input = String(rawPath || "");
  if (!input || input.includes("\0") || path.isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input)) throw capsuleError("ENVIRONMENT_PATH_UNSAFE", "Environment Capsule recibió una ruta insegura.");
  const normalized = input.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => !part || part === "." || part === "..") || normalized.startsWith(".dorn/")) throw capsuleError("ENVIRONMENT_PATH_UNSAFE", "Environment Capsule recibió una ruta reservada o ambigua.");
  const absolute = path.resolve(root, ...normalized.split("/"));
  if (!absolute.startsWith(`${root}${path.sep}`)) throw capsuleError("ENVIRONMENT_PATH_UNSAFE", "Environment Capsule recibió una ruta externa.");
  return { relativePath: normalized, absolute };
}
function readBounded(root, relativePath, maximum = 1024 * 1024) {
  const checked = safeRelative(root, relativePath);
  if (!fs.existsSync(checked.absolute)) return null;
  const stat = fs.lstatSync(checked.absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw capsuleError("ENVIRONMENT_MANIFEST_UNSAFE", `Manifest inseguro o demasiado grande: ${checked.relativePath}`);
  const real = fs.realpathSync(checked.absolute);
  if (!real.startsWith(`${root}${path.sep}`)) throw capsuleError("ENVIRONMENT_MANIFEST_UNSAFE", `Manifest externo: ${checked.relativePath}`);
  return fs.readFileSync(checked.absolute, "utf8");
}
function safeStored(filePath, identity, schema) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw capsuleError("ENVIRONMENT_STATE_UNSAFE", "El estado Environment Capsule no es un archivo regular acotado.");
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { throw capsuleError("ENVIRONMENT_STATE_CORRUPT", "El estado Environment Capsule está dañado y no fue sobrescrito."); }
  if (parsed?.schema !== schema || parsed?.projectId !== identity.projectId) throw capsuleError("ENVIRONMENT_IDENTITY_MISMATCH", "El estado Environment Capsule pertenece a otra identidad.");
  return parsed;
}
function normalizeSource(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const url = text(raw.url, 2000);
  const sha256 = text(raw.sha256, 64).toLowerCase();
  const signature = text(raw.signature, 2000);
  const license = text(raw.license, 200);
  if (!url && !sha256 && !signature && !license) return null;
  if (url && !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/|$)/.test(url)) throw capsuleError("ENVIRONMENT_SOURCE_URL_UNSAFE", "La fuente debe usar HTTPS y un host explícito.");
  if (sha256 && !SHA256.test(sha256)) throw capsuleError("ENVIRONMENT_SOURCE_HASH_INVALID", "La fuente contiene un SHA-256 inválido.");
  if (containsSecret(JSON.stringify({ url, signature, license }))) throw capsuleError("ENVIRONMENT_SOURCE_SECRET", "La fuente contiene material sensible.");
  return { url: url || null, sha256: sha256 || null, signature: signature || null, license: license || null };
}
function normalizeRequirement(raw, origin = "DECLARED") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw capsuleError("ENVIRONMENT_REQUIREMENT_INVALID", "El requisito de entorno debe ser estructurado.");
  const id = text(raw.id || raw.toolId || raw.name, 100).toLowerCase();
  if (!STABLE_ID.test(id)) throw capsuleError("ENVIRONMENT_REQUIREMENT_ID_INVALID", "El requisito necesita una identidad estable y no ambigua.");
  const kind = text(raw.kind, 40, TOOL_PROBES[id]?.kind || "RUNTIME").toUpperCase();
  if (!REQUIREMENT_KINDS.has(kind)) throw capsuleError("ENVIRONMENT_REQUIREMENT_KIND_INVALID", `Tipo de requisito desconocido: ${kind}`);
  const variable = kind === "ENVIRONMENT" ? text(raw.variable || raw.name || id, 100).toUpperCase() : null;
  if (variable && (!/^[A-Z_][A-Z0-9_]{0,99}$/.test(variable) || SECRET_NAME.test(variable))) {
    throw capsuleError("ENVIRONMENT_SECRET_REFERENCE_REQUIRED", "Las credenciales pertenecen al Secret Vault, no a Environment Capsule.");
  }
  return {
    id, kind, name: text(raw.name, 200, id), toolId: raw.toolId ? text(raw.toolId, 100).toLowerCase() : (TOOL_PROBES[id] ? id : null),
    versionRange: kind === "ENVIRONMENT" || kind === "OS" || kind === "SERVICE" ? "*" : validRange(raw.versionRange || raw.version || "*"),
    required: raw.required !== false, origin, variable,
    service: kind === "SERVICE" ? { protocol: text(raw.service?.protocol, 20, "unknown"), host: text(raw.service?.host, 253), port: Number.isInteger(Number(raw.service?.port)) ? Math.max(1, Math.min(65535, Number(raw.service.port))) : null } : null,
    source: normalizeSource(raw.source), notes: text(raw.notes, 1000) || null
  };
}
function mergeRequirements(detected, declared) {
  const merged = new Map();
  for (const item of detected) merged.set(item.id, item);
  for (const item of declared) merged.set(item.id, { ...(merged.get(item.id) || {}), ...item, origin: "DECLARED" });
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

class EnvironmentCapsule {
  constructor(options = {}) {
    if (!options.projectCore) throw new Error("Environment Capsule necesita Project Core.");
    this.projectCore = options.projectCore;
    this.executionCore = options.executionCore || null;
    this.spawnSync = options.spawnSync || childProcess.spawnSync;
    this.serviceProbe = options.serviceProbe || null;
    this.environment = options.environment || process.env;
    this.environmentPath = options.environmentPath || process.env.PATH || "";
  }

  projectCore;
  executionCore;
  spawnSync;
  serviceProbe;
  environment;
  environmentPath;

  identity(project) { return projectIdentity(project, this.projectCore); }
  requirementsPath(identity) { return path.join(identity.root, ".dorn", "manifests", "environment-requirements-v2.json"); }
  observationPath(identity) { return path.join(identity.root, ".dorn", "manifests", "environment-observation-v2.json"); }

  declared(project) {
    const identity = this.identity(project);
    return safeStored(this.requirementsPath(identity), identity, "dorn.environment-requirements/2") || {
      schema: "dorn.environment-requirements/2", projectId: identity.projectId,
      target: { os: "any", arch: "any" }, requirements: [], declaredAt: null, updatedAt: null
    };
  }

  declare(project, input = {}) {
    const identity = this.identity(project);
    if (!Array.isArray(input.requirements) || input.requirements.length > 200) throw capsuleError("ENVIRONMENT_REQUIREMENTS_LIMIT", "Environment Capsule admite hasta 200 requisitos explícitos.");
    const targetOs = text(input.target?.os, 20, "any").toLowerCase();
    if (!TARGET_OS.has(targetOs)) throw capsuleError("ENVIRONMENT_TARGET_INVALID", "El OS objetivo no es reconocible.");
    const targetArch = text(input.target?.arch, 40, "any").toLowerCase();
    if (!/^(?:any|x64|x86|arm64|arm|wasm32)$/.test(targetArch)) throw capsuleError("ENVIRONMENT_TARGET_INVALID", "La arquitectura objetivo no es reconocible.");
    const requirements = input.requirements.map((entry) => normalizeRequirement(entry));
    if (new Set(requirements.map((entry) => entry.id)).size !== requirements.length) throw capsuleError("ENVIRONMENT_REQUIREMENT_DUPLICATE", "Hay requisitos de entorno duplicados.");
    const previous = this.declared(identity.project);
    const now = timestamp();
    const record = {
      schema: "dorn.environment-requirements/2", projectId: identity.projectId,
      target: { os: targetOs, arch: targetArch }, requirements,
      declaredAt: previous.declaredAt || now, updatedAt: now
    };
    if (containsSecret(JSON.stringify(record))) throw capsuleError("ENVIRONMENT_REQUIREMENTS_SECRET", "Environment Capsule bloqueó un secreto en requisitos.");
    atomicJson(this.requirementsPath(identity), record);
    return structuredClone(record);
  }

  detect(project) {
    const identity = this.identity(project);
    const staticInspection = this.projectCore.inspect(identity.root, { projectId: identity.projectId, maxFiles: 20_000, timeBudgetMs: 5000, persist: false });
    const detected = [];
    const add = (entry) => { if (!detected.some((item) => item.id === entry.id)) detected.push(normalizeRequirement(entry, "DETECTED_STATIC")); };
    const packageJsonText = readBounded(identity.root, "package.json");
    if (packageJsonText) {
      let packageJson;
      try { packageJson = JSON.parse(packageJsonText); } catch { throw capsuleError("ENVIRONMENT_MANIFEST_INVALID", "package.json no es JSON válido."); }
      if (packageJson?.engines?.node) add({ id: "node", kind: "RUNTIME", versionRange: packageJson.engines.node });
      const packageManager = text(packageJson?.packageManager, 200).match(/^([a-z][a-z0-9.-]*)@([^\s+]+)(?:\+.*)?$/i);
      if (packageManager && TOOL_PROBES[packageManager[1].toLowerCase()]) add({ id: packageManager[1], kind: "PACKAGE_MANAGER", versionRange: packageManager[2] });
    }
    const manifests = new Set(staticInspection.manifests);
    if (manifests.has("package-lock.json")) add({ id: "npm", kind: "PACKAGE_MANAGER", versionRange: "*" });
    if (manifests.has("pnpm-lock.yaml")) add({ id: "pnpm", kind: "PACKAGE_MANAGER", versionRange: "*" });
    if (manifests.has("yarn.lock")) add({ id: "yarn", kind: "PACKAGE_MANAGER", versionRange: "*" });
    if (manifests.has("pyproject.toml") || manifests.has("requirements.txt")) add({ id: "python", kind: "RUNTIME", versionRange: "*" });
    if (manifests.has("requirements.txt")) add({ id: "pip", kind: "PACKAGE_MANAGER", versionRange: "*" });
    if (manifests.has("poetry.lock")) add({ id: "poetry", kind: "PACKAGE_MANAGER", versionRange: "*" });
    if (manifests.has("Cargo.toml")) { add({ id: "rustc", kind: "TOOLCHAIN", versionRange: "*" }); add({ id: "cargo", kind: "PACKAGE_MANAGER", versionRange: "*" }); }
    if (manifests.has("CMakeLists.txt")) add({ id: "cmake", kind: "TOOLCHAIN", versionRange: "*" });
    if (manifests.has("platformio.ini")) add({ id: "platformio", kind: "TOOLCHAIN", versionRange: "*" });
    if (manifests.has("project.godot")) add({ id: "godot", kind: "RUNTIME", versionRange: "*" });
    const goMod = readBounded(identity.root, "go.mod");
    if (goMod) {
      const version = goMod.match(/^go\s+(\d+(?:\.\d+){1,2})\s*$/m)?.[1] || "*";
      add({ id: "go", kind: "TOOLCHAIN", versionRange: version === "*" ? "*" : `>=${version}` });
    }
    const globalJson = readBounded(identity.root, "global.json");
    if (globalJson) {
      let parsed;
      try { parsed = JSON.parse(globalJson); } catch { throw capsuleError("ENVIRONMENT_MANIFEST_INVALID", "global.json no es JSON válido."); }
      add({ id: "dotnet", kind: "SDK", versionRange: parsed?.sdk?.version || "*" });
    }
    return {
      schema: "dorn.environment-detection/2", projectId: identity.projectId,
      requirements: detected.sort((a, b) => a.id.localeCompare(b.id)), staticInspection,
      detectionHash: digest(detected.map((item) => ({ id: item.id, kind: item.kind, versionRange: item.versionRange })).sort((a, b) => a.id.localeCompare(b.id))),
      detectedAt: timestamp()
    };
  }

  probeTool(requirement) {
    const manifest = this.executionCore?.list().find((entry) => entry.toolId === requirement.toolId || (requirement.id === "git" && entry.toolId === "git-inspect"));
    if (manifest) {
      const health = this.executionCore.health(manifest.toolId);
      const parsed = canonicalVersion(health.version);
      return {
        id: requirement.id, kind: requirement.kind, state: health.health === "HEALTHY" && versionSatisfies(parsed.version, requirement.versionRange) ? "SATISFIED" : health.health === "NOT_INSTALLED" ? "MISSING" : health.health === "HEALTHY" ? "VERSION_MISMATCH" : "DEGRADED",
        installed: health.installed, version: parsed.version, versionRaw: parsed.raw, executableSha256: health.executableSha256 || null,
        provenance: health.provenance?.official === true ? "REGISTERED_OFFICIAL" : "REGISTERED_UNVERIFIED"
      };
    }
    const probe = TOOL_PROBES[requirement.toolId || requirement.id];
    if (!probe) return { id: requirement.id, kind: requirement.kind, state: "UNKNOWN_PROBE", installed: null, version: null, executableSha256: null, provenance: "NO_PROBE_CONTRACT" };
    const executable = findExecutable(probe.executable, this.environmentPath);
    if (!executable) return { id: requirement.id, kind: requirement.kind, state: "MISSING", installed: false, version: null, executableSha256: null, provenance: "SYSTEM_PATH_OBSERVATION" };
    const before = digestFile(executable);
    const result = this.spawnSync(executable, probe.args, {
      encoding: "utf8", timeout: 5000, windowsHide: true, shell: false,
      env: safeEnvironment(), maxBuffer: 256 * 1024, stdio: ["ignore", "pipe", "pipe"]
    });
    const after = digestFile(executable);
    if (before.sha256 !== after.sha256 || before.size !== after.size) return { id: requirement.id, kind: requirement.kind, state: "EXECUTABLE_CHANGED", installed: true, version: null, executableSha256: after.sha256, provenance: "SYSTEM_PATH_OBSERVATION" };
    const parsed = canonicalVersion(`${result.stdout || ""}\n${result.stderr || ""}`);
    const state = result.status !== 0 ? "DEGRADED" : !parsed.version ? "VERSION_UNKNOWN" : versionSatisfies(parsed.version, requirement.versionRange) ? "SATISFIED" : "VERSION_MISMATCH";
    return { id: requirement.id, kind: requirement.kind, state, installed: true, version: parsed.version, versionRaw: redact(parsed.raw), executableSha256: before.sha256, provenance: "SYSTEM_PATH_OBSERVATION" };
  }

  observe(project, options = {}) {
    const identity = this.identity(project);
    const declaration = this.declared(identity.project);
    const detection = this.detect(identity.project);
    const requirements = mergeRequirements(detection.requirements, declaration.requirements);
    const host = { os: canonicalPlatform(), arch: canonicalArch(), release: text(os.release(), 100), node: process.version };
    const targetSatisfied = (declaration.target.os === "any" || declaration.target.os === host.os) && (declaration.target.arch === "any" || declaration.target.arch === host.arch);
    const results = requirements.map((requirement) => {
      if (requirement.kind === "OS") return { id: requirement.id, kind: requirement.kind, state: targetSatisfied ? "SATISFIED" : "TARGET_MISMATCH", observed: host.os };
      if (requirement.kind === "ENVIRONMENT") return { id: requirement.id, kind: requirement.kind, state: Object.hasOwn(this.environment, requirement.variable) ? "SATISFIED" : "MISSING", present: Object.hasOwn(this.environment, requirement.variable), valueStored: false };
      if (requirement.kind === "SERVICE") {
        if (!this.serviceProbe || options.allowServiceHealth !== true) return { id: requirement.id, kind: requirement.kind, state: "NOT_PROBED", reason: "NETWORK_OR_SERVICE_PROBE_REQUIRES_EXPLICIT_SCOPE" };
        const probed = this.serviceProbe({ project: identity.project, requirement: structuredClone(requirement) });
        return { id: requirement.id, kind: requirement.kind, state: probed?.healthy === true ? "SATISFIED" : "UNAVAILABLE", detail: text(probed?.detail, 500) || null };
      }
      return this.probeTool(requirement);
    });
    const required = results.filter((result) => requirements.find((requirement) => requirement.id === result.id)?.required !== false);
    const blockers = required.filter((result) => result.state !== "SATISFIED");
    const now = timestamp();
    const capsule = {
      schema: "dorn.environment-capsule/2", projectId: identity.projectId,
      target: declaration.target, host, targetSatisfied, requirements,
      results, state: !targetSatisfied ? "TARGET_MISMATCH" : blockers.length ? "NEEDS_PREPARATION" : "READY",
      blockers: blockers.map((entry) => ({ id: entry.id, state: entry.state })), detectionHash: detection.detectionHash,
      observedAt: now
    };
    capsule.capsuleHash = digest({ projectId: capsule.projectId, target: capsule.target, host: capsule.host, requirements: capsule.requirements, results: capsule.results });
    if (containsSecret(JSON.stringify(capsule))) throw capsuleError("ENVIRONMENT_OBSERVATION_SECRET", "Environment Capsule bloqueó datos sensibles de la observación.");
    if (options.persist === true) {
      safeStored(this.observationPath(identity), identity, "dorn.environment-capsule/2");
      atomicJson(this.observationPath(identity), capsule);
    }
    return structuredClone(capsule);
  }

  latest(project) {
    const identity = this.identity(project);
    return safeStored(this.observationPath(identity), identity, "dorn.environment-capsule/2");
  }

  preparationPlan(project, input = {}) {
    const identity = this.identity(project);
    const capsule = input.capsule || this.latest(identity.project) || this.observe(identity.project, { persist: false });
    if (capsule.projectId !== identity.projectId) throw capsuleError("ENVIRONMENT_IDENTITY_MISMATCH", "La cápsula no pertenece a este proyecto.");
    const requested = new Set((input.requirementIds || capsule.blockers.map((entry) => entry.id)).map((entry) => text(entry, 100).toLowerCase()));
    const authorization = input.authorization && input.authorization.projectId === identity.projectId && input.authorization.approved === true;
    const actions = capsule.requirements.filter((requirement) => requested.has(requirement.id)).map((requirement) => {
      const current = capsule.results.find((entry) => entry.id === requirement.id);
      if (current?.state === "SATISFIED") return { requirementId: requirement.id, state: "ALREADY_SATISFIED", executable: false };
      const pinned = Boolean(requirement.source?.url && (requirement.source.sha256 || requirement.source.signature) && requirement.source.license);
      if (!pinned) return { requirementId: requirement.id, state: "BLOCKED_UNVERIFIED_SOURCE", executable: false, reason: "SOURCE_VERSION_INTEGRITY_LICENSE_REQUIRED" };
      if (!authorization) return { requirementId: requirement.id, state: "AWAITING_EXPLICIT_APPROVAL", executable: false };
      return {
        requirementId: requirement.id, state: "AUTHORIZED_FOR_SUPPLY_CHAIN_FETCH", executable: false,
        source: structuredClone(requirement.source), reason: "Environment Capsule plans only; Supply Chain Guard must fetch, verify and install in isolation."
      };
    });
    return {
      schema: "dorn.environment-preparation-plan/2", projectId: identity.projectId, capsuleHash: capsule.capsuleHash,
      state: actions.every((entry) => entry.state === "ALREADY_SATISFIED") ? "NO_ACTION" : actions.some((entry) => entry.state.startsWith("BLOCKED")) ? "BLOCKED" : authorization ? "AUTHORIZED_PLAN" : "AWAITING_APPROVAL",
      actions, mutatesSystem: false, generatedAt: timestamp()
    };
  }

  summary(capsule) {
    return {
      schema: "dorn.environment-summary/2", state: capsule.state, target: capsule.target,
      host: { os: capsule.host.os, arch: capsule.host.arch }, capsuleHash: capsule.capsuleHash,
      counts: {
        requirements: capsule.requirements.length,
        satisfied: capsule.results.filter((entry) => entry.state === "SATISFIED").length,
        blockers: capsule.blockers.length
      },
      blockers: capsule.blockers.slice(0, 100), observedAt: capsule.observedAt
    };
  }
}

module.exports = {
  EnvironmentCapsule, TOOL_PROBES, REQUIREMENT_KINDS, TARGET_OS,
  canonicalVersion, validRange, versionSatisfies, normalizeRequirement, mergeRequirements
};
