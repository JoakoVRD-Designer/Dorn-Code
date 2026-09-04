"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const { atomicJson } = require("../dorn-suite/common");
const { digestFile, findExecutable, redact } = require("./execution-core");

const LINUX_RUNTIME_SCHEMA = "dorn.linux-runtime/1";
const LINUX_RUNTIME_STATE_SCHEMA = "dorn.linux-runtime-state/1";
const DEFAULT_DORN_DISTRO = "Ubuntu";
const TOOLCHAIN_PROBES = Object.freeze({
  node: Object.freeze(["--version"]),
  npm: Object.freeze(["--version"]),
  python3: Object.freeze(["--version"]),
  pip3: Object.freeze(["--version"]),
  git: Object.freeze(["--version"]),
  gcc: Object.freeze(["--version"]),
  make: Object.freeze(["--version"]),
  cmake: Object.freeze(["--version"]),
  cargo: Object.freeze(["--version"]),
  rustc: Object.freeze(["--version"]),
  go: Object.freeze(["version"]),
  java: Object.freeze(["-version"])
});
const TARGETS = Object.freeze({
  LOCAL_WINDOWS: Object.freeze({ targetId: "LOCAL_WINDOWS", maturity: "AVAILABLE_EXISTING_CORE" }),
  LOCAL_WSL: Object.freeze({ targetId: "LOCAL_WSL", maturity: "P0_NEEDS_WINDOWS_RETEST" }),
  UBUNTU_QEMU: Object.freeze({ targetId: "UBUNTU_QEMU", maturity: "PLANNED" }),
  SSH_REMOTE: Object.freeze({ targetId: "SSH_REMOTE", maturity: "PLANNED" }),
  REMOTE_DORN_NODE: Object.freeze({ targetId: "REMOTE_DORN_NODE", maturity: "PLANNED" }),
  CONTAINER: Object.freeze({ targetId: "CONTAINER", maturity: "PLANNED" }),
  CLOUD_WORKER: Object.freeze({ targetId: "CLOUD_WORKER", maturity: "PLANNED" })
});
const UNIT_STATES = new Set(["PREPARED", "RUNNING", "EXECUTED", "FAILED", "CANCELLED", "INTERRUPTED", "BLOCKED"]);

function linuxError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function decodeWindowsOutput(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(/^\uFEFF/, "").replaceAll("\0", "");
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!buffer.length) return "";
  const sample = buffer.subarray(0, Math.min(buffer.length, 256));
  const zeroes = [...sample].filter((byte) => byte === 0).length;
  const utf16 = (buffer[0] === 0xff && buffer[1] === 0xfe) || zeroes > sample.length / 5;
  return buffer.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "").replaceAll("\0", "");
}

function safeDistroName(value) {
  const name = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(name) || name.includes("..")) {
    throw linuxError("LINUX_DISTRO_INVALID", "La distribución WSL no tiene una identidad segura.");
  }
  return name;
}

function parseWslList(raw) {
  const lines = decodeWindowsOutput(raw).replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  const distributions = [];
  for (const line of lines) {
    const match = line.match(/^\s*(\*)?\s*(.+?)\s{2,}(\S.*?)\s+([12])\s*$/);
    if (!match) continue;
    try {
      const name = safeDistroName(match[2]);
      distributions.push({ name, default: Boolean(match[1]), state: String(match[3]).trim().slice(0, 80), wslVersion: Number(match[4]) });
    } catch {}
  }
  return distributions.sort((left, right) => Number(right.default) - Number(left.default) || left.name.localeCompare(right.name));
}

function runtimeUnitId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw linuxError("LINUX_RUNTIME_UNIT_ID_INVALID", "La unidad Linux necesita una identidad estable.");
  return id;
}

function assertStateFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) {
    throw linuxError("LINUX_RUNTIME_STATE_UNSAFE", "El estado Linux no es un archivo regular seguro.");
  }
}

class LinuxRuntimeManager {
  constructor(options = {}) {
    if (!options.projectCore || !options.worktreeManager || !options.executionCore) {
      throw new Error("Linux Runtime necesita Project Core, Worktree Manager y Execution Core.");
    }
    this.projectCore = options.projectCore;
    this.worktreeManager = options.worktreeManager;
    this.executionCore = options.executionCore;
    this.platform = options.platform || process.platform;
    this.environmentPath = options.environmentPath ?? process.env.PATH ?? "";
    this.wslExecutableOverride = options.wslExecutable || null;
    this.spawnSync = options.spawnSync || childProcess.spawnSync;
  }

  projectCore;
  worktreeManager;
  executionCore;
  platform;
  environmentPath;
  wslExecutableOverride;
  spawnSync;
  observation = null;

  findWsl() {
    if (this.platform !== "win32" && !this.wslExecutableOverride) return null;
    if (this.wslExecutableOverride) return findExecutable(this.wslExecutableOverride, this.environmentPath);
    const systemWsl = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "wsl.exe") : null;
    return (systemWsl && findExecutable(systemWsl, this.environmentPath)) || findExecutable("wsl", this.environmentPath);
  }

  discover() {
    const executable = this.findWsl();
    const base = {
      schema: LINUX_RUNTIME_SCHEMA,
      targetId: "LOCAL_WSL",
      platform: this.platform,
      executable: executable ? { path: executable, ...digestFile(executable) } : null,
      distributions: [],
      defaultDistro: null,
      storageMode: "WINDOWS_MOUNT_COMPATIBILITY",
      optimizedStorageMode: "WSL_EXT4_MANAGED_P1",
      observedAt: new Date().toISOString()
    };
    if (!executable) {
      this.observation = { ...base, state: this.platform === "win32" ? "NOT_INSTALLED" : "NOT_WINDOWS_HOST", blocker: "WSL_EXECUTABLE_NOT_FOUND" };
      return structuredClone(this.observation);
    }
    const before = digestFile(executable);
    const result = this.spawnSync(executable, ["--list", "--verbose"], {
      encoding: null, timeout: 8_000, windowsHide: true, shell: false,
      env: { PATH: this.environmentPath, SystemRoot: process.env.SystemRoot || "", WINDIR: process.env.WINDIR || "", CI: "1", NO_COLOR: "1" },
      maxBuffer: 512 * 1024, stdio: ["ignore", "pipe", "pipe"]
    });
    const after = digestFile(executable);
    if (before.sha256 !== after.sha256 || before.size !== after.size) throw linuxError("LINUX_WSL_EXECUTABLE_CHANGED", "wsl.exe cambió durante la inspección.");
    const distributions = result.status === 0 ? parseWslList(result.stdout) : [];
    const compatible = distributions.filter((entry) => entry.wslVersion === 2);
    const state = result.status !== 0 ? "DEGRADED" : !distributions.length ? "NO_DISTRIBUTIONS" : !compatible.length ? "WSL2_REQUIRED" : "READY";
    this.observation = {
      ...base,
      executable: { path: executable, ...after },
      distributions,
      defaultDistro: (compatible.find((entry) => entry.default) || compatible[0])?.name || null,
      state,
      exitCode: Number.isInteger(result.status) ? result.status : null,
      errorCode: result.error?.code || null,
      stderr: redact(decodeWindowsOutput(result.stderr)).slice(0, 2_000)
    };
    if (state === "READY" && !this.executionCore.list().some((tool) => tool.toolId === "wsl-node")) {
      this.executionCore.register({
        toolId: "wsl-node", label: "DORN WSL 2 Node Runtime", executable,
        capabilities: ["code.check", "code.execute", "test.execute", "linux.execute"],
        actions: ["build.execute", "process.execute", "test.execute"],
        argumentPolicy: "WSL_SCOPED_NODE", networkBehavior: "DENIED_UNENFORCED",
        provenance: { source: "Microsoft Windows WSL", official: true, license: null }
      });
    }
    return structuredClone(this.observation);
  }

  targetCatalog() {
    const observed = this.observation || this.discover();
    return Object.values(TARGETS).map((target) => ({
      ...target,
      state: target.targetId === "LOCAL_WSL" ? observed.state : target.maturity === "PLANNED" ? "NOT_IMPLEMENTED" : "AVAILABLE"
    }));
  }

  setupPlan(input = {}) {
    const observed = this.discover();
    const distro = safeDistroName(input.distro || DEFAULT_DORN_DISTRO);
    const base = {
      schema: "dorn.linux-setup-plan/1",
      targetId: "LOCAL_WSL",
      distro,
      currentState: observed.state,
      userConfirmationRequired: true,
      installerIndependent: true,
      mayRequireElevation: true,
      mayRequireRestart: true,
      destructive: false,
      projectStorage: {
        current: observed.storageMode,
        recommended: "WSL_EXT4_MANAGED",
        reason: "Los proyectos ejecutados principalmente con herramientas Linux rinden mejor dentro del sistema de archivos Linux."
      },
      toolchainProfile: ["node", "npm", "python3", "pip3", "git", "gcc", "make", "cmake", "cargo", "rustc", "go", "java"]
    };
    if (observed.state === "READY") return { ...base, outcome: "READY", commands: [], next: "INSPECT_TOOLCHAIN" };
    if (observed.state === "NOT_WINDOWS_HOST") return { ...base, outcome: "BLOCKED", blocker: "WINDOWS_HOST_REQUIRED", commands: [] };
    if (observed.state === "NOT_INSTALLED" || observed.state === "NO_DISTRIBUTIONS") {
      return {
        ...base,
        outcome: "SETUP_REQUIRED",
        commands: [{ executable: "wsl.exe", args: ["--install", "--distribution", distro, "--no-launch"], elevation: "REQUIRED_OR_WINDOWS_MANAGED" }],
        next: "RESTART_OR_FIRST_LAUNCH"
      };
    }
    if (observed.state === "WSL2_REQUIRED") {
      const selected = safeDistroName(input.distro || observed.distributions[0]?.name || distro);
      return {
        ...base,
        distro: selected,
        outcome: "CONVERSION_REQUIRED",
        commands: [{ executable: "wsl.exe", args: ["--set-version", selected, "2"], elevation: "WINDOWS_MANAGED" }],
        next: "RECHECK"
      };
    }
    return { ...base, outcome: "BLOCKED", blocker: observed.blocker || observed.errorCode || "WSL_DEGRADED", commands: [] };
  }

  inspectToolchain(input = {}) {
    const observed = this.discover();
    if (observed.state !== "READY") throw linuxError("LINUX_RUNTIME_NOT_READY", "WSL 2 todavía no está listo para inspeccionar lenguajes.", { observation: observed });
    const distro = safeDistroName(input.distro || observed.defaultDistro);
    const available = observed.distributions.find((entry) => entry.name === distro && entry.wslVersion === 2);
    if (!available) throw linuxError("LINUX_RUNTIME_DISTRO_NOT_READY", "La distribución seleccionada no está disponible en WSL 2.");
    const executable = observed.executable.path;
    const before = digestFile(executable);
    const tools = {};
    for (const [tool, probeArgs] of Object.entries(TOOLCHAIN_PROBES)) {
      const result = this.spawnSync(executable, ["--distribution", distro, "--exec", tool, ...probeArgs], {
        encoding: null,
        timeout: 5_000,
        windowsHide: true,
        shell: false,
        env: { PATH: this.environmentPath, SystemRoot: process.env.SystemRoot || "", WINDIR: process.env.WINDIR || "", CI: "1", NO_COLOR: "1" },
        maxBuffer: 256 * 1024,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const output = redact(decodeWindowsOutput(result.stdout || result.stderr)).trim().split(/\r?\n/)[0].slice(0, 500);
      tools[tool] = { installed: result.status === 0, version: result.status === 0 ? output : null, exitCode: Number.isInteger(result.status) ? result.status : null, errorCode: result.error?.code || null };
    }
    const after = digestFile(executable);
    if (before.sha256 !== after.sha256 || before.size !== after.size) throw linuxError("LINUX_WSL_EXECUTABLE_CHANGED", "wsl.exe cambió durante la inspección del toolchain.");
    return { schema: "dorn.linux-toolchain/1", targetId: "LOCAL_WSL", distro, wslVersion: 2, tools, inspectedAt: new Date().toISOString() };
  }

  identity(project) { return this.worktreeManager.identity(project); }
  statePath(identity) { return path.join(identity.tasksRoot, "linux-runtime.json"); }

  load(project) {
    const identity = this.identity(project);
    const filePath = this.statePath(identity);
    if (!fs.existsSync(filePath)) return { schema: LINUX_RUNTIME_STATE_SCHEMA, projectId: identity.projectId, units: {} };
    assertStateFile(filePath);
    let state;
    try { state = JSON.parse(fs.readFileSync(filePath, "utf8")); }
    catch { throw linuxError("LINUX_RUNTIME_STATE_INVALID", "El estado Linux está dañado y no fue sobrescrito."); }
    if (!state || state.schema !== LINUX_RUNTIME_STATE_SCHEMA || state.projectId !== identity.projectId || typeof state.units !== "object" || Array.isArray(state.units)) {
      throw linuxError("LINUX_RUNTIME_STATE_IDENTITY_MISMATCH", "El estado Linux no coincide con el proyecto.");
    }
    for (const [id, unit] of Object.entries(state.units)) {
      if (runtimeUnitId(id) !== id || !unit || unit.runtimeUnitId !== id || !UNIT_STATES.has(unit.state)) {
        throw linuxError("LINUX_RUNTIME_STATE_INVALID", "El estado Linux contiene una unidad inválida.");
      }
    }
    return state;
  }

  save(project, state) {
    const identity = this.identity(project);
    if (state.projectId !== identity.projectId || state.schema !== LINUX_RUNTIME_STATE_SCHEMA) throw linuxError("LINUX_RUNTIME_STATE_IDENTITY_MISMATCH", "No se guardó estado de otro proyecto.");
    atomicJson(this.statePath(identity), state);
  }

  prepare(project, input = {}) {
    const observed = this.discover();
    if (observed.state !== "READY") throw linuxError("LINUX_RUNTIME_NOT_READY", "WSL 2 todavía no está listo para preparar una unidad.", { observation: observed });
    const id = runtimeUnitId(input.runtimeUnitId || input.workUnitId);
    const distro = safeDistroName(input.distro || observed.defaultDistro);
    const available = observed.distributions.find((entry) => entry.name === distro);
    if (!available || available.wslVersion !== 2) throw linuxError("LINUX_RUNTIME_DISTRO_NOT_READY", "La distribución seleccionada no está disponible en WSL 2.");
    const state = this.load(project);
    if (state.units[id]) throw linuxError("LINUX_RUNTIME_UNIT_EXISTS", "La unidad Linux ya existe y debe recuperarse o revisarse.");
    const workUnit = this.worktreeManager.create(project, {
      workUnitId: id,
      expectedFiles: input.expectedFiles,
      requiredFiles: input.requiredFiles,
      contractSnapshotId: input.contractSnapshotId
    });
    const now = new Date().toISOString();
    try {
      state.units[id] = {
        schema: "dorn.linux-runtime-unit/1", runtimeUnitId: id, workUnitId: workUnit.workUnitId,
        targetId: "LOCAL_WSL", distro, wslVersion: 2, executableSha256: observed.executable.sha256,
        storageMode: observed.storageMode, state: "PREPARED", lastExecution: null,
        createdAt: now, updatedAt: now
      };
      this.save(project, state);
    } catch (error) {
      try { this.worktreeManager.dispose(project, workUnit.workUnitId, { force: true }); } catch {}
      throw error;
    }
    return { unit: structuredClone(state.units[id]), workUnit };
  }

  get(project, id) {
    const unit = this.load(project).units[runtimeUnitId(id)];
    if (!unit) throw linuxError("LINUX_RUNTIME_UNIT_UNKNOWN", "Unidad Linux desconocida.");
    return structuredClone(unit);
  }

  updateExecution(project, id, patch) {
    const state = this.load(project);
    const unit = state.units[runtimeUnitId(id)];
    if (!unit) throw linuxError("LINUX_RUNTIME_UNIT_UNKNOWN", "Unidad Linux desconocida.");
    Object.assign(unit, patch, { updatedAt: new Date().toISOString() });
    this.save(project, state);
    return structuredClone(unit);
  }

  executeNode(project, id, input = {}, options = {}) {
    const unit = this.get(project, id);
    if (!["PREPARED", "EXECUTED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(unit.state)) {
      throw linuxError("LINUX_RUNTIME_UNIT_BUSY", "La unidad Linux no está disponible para ejecutar.");
    }
    const observed = this.discover();
    const distro = observed.distributions.find((entry) => entry.name === unit.distro && entry.wslVersion === 2);
    if (observed.state !== "READY" || !distro || observed.executable.sha256 !== unit.executableSha256) {
      throw linuxError("LINUX_RUNTIME_TARGET_CHANGED", "El target WSL cambió desde que se preparó la unidad; requiere revisión.");
    }
    const nodeArgs = Array.isArray(input.args) ? input.args.map(String) : [];
    const request = {
      toolId: "wsl-node", workUnitId: unit.workUnitId, relativeCwd: input.relativeCwd || ".",
      args: ["--distribution", unit.distro, "--exec", "node", ...nodeArgs],
      action: input.action || "process.execute", timeoutMs: input.timeoutMs,
      environment: input.environment || {}
    };
    const run = this.executionCore.execute(project, request, options);
    try {
      this.updateExecution(project, id, {
        state: "RUNNING",
        lastExecution: { executionId: run.executionId, state: "RUNNING", startedAt: new Date().toISOString(), action: request.action }
      });
    } catch (error) {
      run.cancel();
      void run.promise.catch(() => {});
      throw error;
    }
    const promise = run.promise.then((result) => {
      this.updateExecution(project, id, {
        state: "EXECUTED",
        lastExecution: { executionId: result.executionId, state: result.truthState, exitCode: result.exitCode, completedAt: result.completedAt, action: request.action }
      });
      return result;
    }).catch((error) => {
      const execution = error.execution || {};
      const state = error.code === "EXECUTION_CANCELLED" ? "CANCELLED" : "FAILED";
      this.updateExecution(project, id, {
        state,
        lastExecution: { executionId: run.executionId, state, exitCode: execution.exitCode ?? null, completedAt: new Date().toISOString(), action: request.action, errorCode: error.code || "EXECUTION_FAILED" }
      });
      throw error;
    });
    return { executionId: run.executionId, promise, cancel: run.cancel };
  }

  recover(project) {
    const state = this.load(project);
    const interrupted = [];
    for (const unit of Object.values(state.units)) {
      if (unit.state !== "RUNNING") continue;
      unit.state = "INTERRUPTED";
      unit.lastExecution = { ...(unit.lastExecution || {}), state: "INTERRUPTED", interruptedAt: new Date().toISOString() };
      unit.updatedAt = new Date().toISOString();
      interrupted.push(unit.runtimeUnitId);
    }
    if (interrupted.length) this.save(project, state);
    return { schema: "dorn.linux-runtime-recovery/1", projectId: state.projectId, interrupted, units: Object.keys(state.units).length };
  }
}

module.exports = {
  DEFAULT_DORN_DISTRO, LinuxRuntimeManager, LINUX_RUNTIME_SCHEMA, LINUX_RUNTIME_STATE_SCHEMA, TARGETS, TOOLCHAIN_PROBES,
  decodeWindowsOutput, parseWslList, safeDistroName
};
