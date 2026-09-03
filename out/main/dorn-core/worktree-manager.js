"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { atomicJson } = require("../dorn-suite/common");
const { projectIdentity } = require("./job-runtime");
const { isContractPath } = require("./contract-intelligence");

const COPY_IGNORED = new Set([".dorn", ".git", "node_modules", "coverage", ".cache", ".next", ".turbo", "dist", "build", "out"]);
const DISPOSABLE_STATES = new Set(["INTEGRATED", "REWORK_REQUIRED", "BLOCKED", "ROLLED_BACK"]);

function worktreeError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function timestamp() { return new Date().toISOString(); }

function safeRelative(root, rawPath) {
  const input = String(rawPath ?? "");
  if (!input || input.includes("\0") || path.isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input)) {
    throw worktreeError("WORKTREE_PATH_UNSAFE", "Worktree recibió una ruta absoluta o vacía.");
  }
  const normalized = input.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..") || COPY_IGNORED.has(parts[0])) {
    throw worktreeError("WORKTREE_PATH_UNSAFE", "Worktree recibió una ruta insegura o reservada.");
  }
  const absolute = path.resolve(root, ...parts);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw worktreeError("WORKTREE_SCOPE_ESCAPE", "La ruta queda fuera del Worktree.");
  return { relativePath: normalized, absolute };
}

function fileEntry(root, relativePath) {
  const checked = safeRelative(root, relativePath);
  if (!fs.existsSync(checked.absolute)) return { path: checked.relativePath, exists: false, sha256: null, size: 0, mode: null };
  const stat = fs.lstatSync(checked.absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw worktreeError("WORKTREE_ENTRY_UNSAFE", `Worktree sólo acepta archivos regulares: ${checked.relativePath}.`);
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(checked.absolute, "r");
  const chunk = Buffer.allocUnsafe(512 * 1024);
  try {
    let read;
    do { read = fs.readSync(descriptor, chunk, 0, chunk.length, null); if (read) hash.update(chunk.subarray(0, read)); } while (read);
  } finally { fs.closeSync(descriptor); }
  return { path: checked.relativePath, exists: true, sha256: hash.digest("hex"), size: stat.size, mode: stat.mode & 0o777 };
}

function fingerprint(root, files) {
  const entries = [...new Set((files || []).map(String))].sort().map((relativePath) => fileEntry(root, relativePath));
  return { entries, treeHash: digest(JSON.stringify(entries)) };
}

function sameEntry(left, right) {
  return Boolean(left && right) && left.exists === right.exists && left.sha256 === right.sha256 && left.size === right.size && left.mode === right.mode;
}

function splitNul(value) { return String(value || "").split("\0").filter(Boolean).map((item) => item.replaceAll("\\", "/")); }

function copyRegular(source, target, budget) {
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw worktreeError("WORKTREE_ENTRY_UNSAFE", `El aislamiento rechazó una ruta no regular: ${source}`);
  budget.files += 1;
  budget.bytes += stat.size;
  if (budget.files > budget.maxFiles || budget.bytes > budget.maxBytes) throw worktreeError("WORKTREE_COPY_BUDGET_EXCEEDED", "El aislamiento excede el presupuesto de copia segura.");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  try { fs.chmodSync(target, stat.mode & 0o777); } catch {}
}

class WorktreeManager {
  constructor(options = {}) {
    if (!options.projectCore) throw new Error("Worktree Manager necesita Project Core.");
    if (!options.isolationRoot) throw new Error("Worktree Manager necesita una raíz externa de aislamiento.");
    this.projectCore = options.projectCore;
    this.isolationRoot = path.resolve(options.isolationRoot);
    if (this.isolationRoot === path.parse(this.isolationRoot).root) throw new Error("La raíz de aislamiento no puede ser la raíz del sistema.");
    this.spawnSync = options.spawnSync || childProcess.spawnSync;
    this.maxFiles = Math.max(100, Math.min(300000, Number(options.maxFiles) || 100000));
    this.maxBytes = Math.max(16 * 1024 * 1024, Math.min(16 * 1024 ** 3, Number(options.maxBytes) || 4 * 1024 ** 3));
    this.contractIntelligence = options.contractIntelligence || null;
  }

  projectCore;
  isolationRoot;
  spawnSync;
  maxFiles;
  maxBytes;
  contractIntelligence;

  identity(project) {
    const identity = projectIdentity(project, this.projectCore);
    if (this.isolationRoot === identity.root || this.isolationRoot.startsWith(`${identity.root}${path.sep}`)) {
      throw worktreeError("WORKTREE_ISOLATION_INSIDE_PROJECT", "La raíz aislada debe quedar fuera del proyecto para no contaminarlo.");
    }
    return identity;
  }

  statePath(identity) { return path.join(identity.tasksRoot, "worktrees.json"); }

  load(identity) {
    const filePath = this.statePath(identity);
    if (!fs.existsSync(filePath)) return { schema: "dorn.worktrees/1", projectId: identity.projectId, units: {} };
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw worktreeError("WORKTREE_STATE_UNSAFE", "El registro de Worktrees no es un archivo regular acotado.");
    let state;
    try { state = JSON.parse(fs.readFileSync(filePath, "utf8")); }
    catch { throw worktreeError("WORKTREE_STATE_CORRUPT", "El registro de Worktrees está dañado y no fue sobrescrito."); }
    if (!state || state.schema !== "dorn.worktrees/1" || state.projectId !== identity.projectId || typeof state.units !== "object" || Array.isArray(state.units)) {
      throw worktreeError("WORKTREE_STATE_IDENTITY_MISMATCH", "El registro de Worktrees pertenece a otra identidad o contrato.");
    }
    return state;
  }

  save(identity, state) {
    if (state.projectId !== identity.projectId) throw worktreeError("WORKTREE_STATE_IDENTITY_MISMATCH", "No se guardará estado de otra identidad.");
    atomicJson(this.statePath(identity), state);
    return state;
  }

  git(cwd, args, options = {}) {
    const result = this.spawnSync("git", ["-C", cwd, ...args], {
      encoding: "utf8", windowsHide: true, shell: false, timeout: options.timeout || 15_000,
      maxBuffer: options.maxBuffer || 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.error || result.status !== 0) {
      if (options.allowFailure) return null;
      throw worktreeError("WORKTREE_GIT_FAILED", `Git no pudo completar ${args[0]}: ${String(result.stderr || result.error?.message || "error desconocido").trim().slice(0, 4000)}`);
    }
    return String(result.stdout || "");
  }

  repository(identity) {
    const top = this.git(identity.root, ["rev-parse", "--show-toplevel"], { allowFailure: true });
    const head = top && this.git(identity.root, ["rev-parse", "HEAD"], { allowFailure: true });
    if (!top || !head) return null;
    let gitRoot;
    try { gitRoot = fs.realpathSync(top.trim()); } catch { return null; }
    if (gitRoot !== identity.root) return null;
    return { root: gitRoot, head: head.trim() };
  }

  gitChangedPaths(root) {
    const tracked = this.git(root, ["diff", "--name-only", "-z", "HEAD", "--"], { allowFailure: true });
    const staged = this.git(root, ["diff", "--cached", "--name-only", "-z", "HEAD", "--"], { allowFailure: true });
    const untracked = this.git(root, ["ls-files", "--others", "--exclude-standard", "-z"], { allowFailure: true });
    if (tracked === null || staged === null || untracked === null) throw worktreeError("WORKTREE_STATUS_FAILED", "Git no pudo inventariar los cambios aislados.");
    return [...new Set([...splitNul(tracked), ...splitNul(staged), ...splitNul(untracked)])]
      .filter((item) => item && !COPY_IGNORED.has(item.split("/")[0])).sort();
  }

  syncDirtySource(identity, executionRoot) {
    const dirtyPaths = this.gitChangedPaths(identity.root);
    const budget = { files: 0, bytes: 0, maxFiles: this.maxFiles, maxBytes: this.maxBytes };
    for (const relativePath of dirtyPaths) {
      const source = safeRelative(identity.root, relativePath).absolute;
      const target = safeRelative(executionRoot, relativePath).absolute;
      if (!fs.existsSync(source)) {
        if (fs.existsSync(target)) {
          const stat = fs.lstatSync(target);
          if (!stat.isFile() || stat.isSymbolicLink()) throw worktreeError("WORKTREE_ENTRY_UNSAFE", `No se puede sincronizar la eliminación de ${relativePath}.`);
          fs.unlinkSync(target);
        }
      } else copyRegular(source, target, budget);
    }
    return { dirtyPaths, copiedFiles: budget.files, copiedBytes: budget.bytes };
  }

  copySandbox(identity, executionRoot) {
    const budget = { files: 0, bytes: 0, maxFiles: this.maxFiles, maxBytes: this.maxBytes };
    const queue = [{ source: identity.root, target: executionRoot }];
    while (queue.length) {
      const current = queue.shift();
      fs.mkdirSync(current.target, { recursive: true, mode: 0o700 });
      for (const entry of fs.readdirSync(current.source, { withFileTypes: true })) {
        if (COPY_IGNORED.has(entry.name)) continue;
        const source = path.join(current.source, entry.name);
        const target = path.join(current.target, entry.name);
        if (entry.isSymbolicLink()) throw worktreeError("WORKTREE_ENTRY_UNSAFE", `El sandbox encontró un enlace simbólico: ${source}`);
        if (entry.isDirectory()) queue.push({ source, target });
        else if (entry.isFile()) copyRegular(source, target, budget);
        else throw worktreeError("WORKTREE_ENTRY_UNSAFE", `El sandbox encontró una entrada especial: ${source}`);
      }
    }
    return { copiedFiles: budget.files, copiedBytes: budget.bytes };
  }

  scanFiles(root) {
    const files = [];
    const queue = [root];
    while (queue.length) {
      const directory = queue.shift();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (COPY_IGNORED.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw worktreeError("WORKTREE_ENTRY_UNSAFE", `El aislamiento contiene un enlace simbólico: ${absolute}`);
        if (entry.isDirectory()) queue.push(absolute);
        else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll("\\", "/"));
        else throw worktreeError("WORKTREE_ENTRY_UNSAFE", `El aislamiento contiene una entrada especial: ${absolute}`);
        if (files.length > this.maxFiles) throw worktreeError("WORKTREE_SCAN_BUDGET_EXCEEDED", "El inventario del aislamiento excede el límite seguro.");
      }
    }
    return files.sort();
  }

  create(project, input = {}) {
    const identity = this.identity(project);
    const workUnitId = String(input.workUnitId || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(workUnitId)) throw worktreeError("WORKTREE_UNIT_ID_INVALID", "Work Unit necesita una identidad estable.");
    if (!Array.isArray(input.expectedFiles) || !input.expectedFiles.length) throw worktreeError("WORKTREE_SCOPE_REQUIRED", "Worktree necesita Change Scope explícito.");
    const expectedFiles = [...new Set(input.expectedFiles.map((item) => safeRelative(identity.root, item).relativePath))].sort();
    const requiredFiles = [...new Set((input.requiredFiles || expectedFiles).map((item) => safeRelative(identity.root, item).relativePath))].sort();
    if (requiredFiles.some((item) => !expectedFiles.includes(item))) throw worktreeError("WORKTREE_REQUIRED_OUTSIDE_SCOPE", "Un archivo obligatorio queda fuera de Change Scope.");
    const contractSnapshotId = input.contractSnapshotId ? String(input.contractSnapshotId).trim() : null;
    if (contractSnapshotId && !/^[a-zA-Z0-9_.:-]{1,200}$/.test(contractSnapshotId)) throw worktreeError("WORKTREE_CONTRACT_SNAPSHOT_INVALID", "El baseline de contratos no tiene una identidad estable.");
    const state = this.load(identity);
    if (state.units[workUnitId]) {
      const existing = state.units[workUnitId];
      if (existing.executionRootAvailable !== false && fs.existsSync(existing.executionRoot)) return structuredClone(existing);
      throw worktreeError("WORKTREE_UNIT_EXISTS", "La Work Unit ya existe y debe revisarse explícitamente.");
    }
    const projectIsolationRoot = path.join(this.isolationRoot, identity.projectId);
    const executionRoot = path.join(projectIsolationRoot, digest(workUnitId).slice(0, 24));
    if (!executionRoot.startsWith(`${projectIsolationRoot}${path.sep}`)) throw worktreeError("WORKTREE_ISOLATION_PATH_UNSAFE", "La raíz de aislamiento no es segura.");
    if (fs.existsSync(executionRoot)) throw worktreeError("WORKTREE_ORPHANED", "Existe una carpeta aislada huérfana; no fue sobrescrita.");
    fs.mkdirSync(projectIsolationRoot, { recursive: true, mode: 0o700 });
    const repository = this.repository(identity);
    let mode = "BOUNDED_COPY_SANDBOX";
    let sourceSync;
    try {
      if (repository) {
        this.git(identity.root, ["worktree", "add", "--detach", executionRoot, repository.head], { timeout: 30_000 });
        sourceSync = this.syncDirtySource(identity, executionRoot);
        mode = "GIT_WORKTREE";
      } else {
        fs.mkdirSync(executionRoot, { recursive: true, mode: 0o700 });
        sourceSync = this.copySandbox(identity, executionRoot);
      }
      const baselinePaths = repository ? this.gitChangedPaths(executionRoot) : this.scanFiles(executionRoot);
      const unit = {
        schema: "dorn.worktree-unit/1", workUnitId, projectId: identity.projectId,
        projectRoot: identity.root, executionRoot, executionRootAvailable: true, isolationMode: mode,
        baseCommit: repository?.head || null, expectedFiles, requiredFiles,
        contractSnapshotId,
        mainBase: fingerprint(identity.root, expectedFiles), isolationBaseline: fingerprint(executionRoot, baselinePaths),
        sourceSync, test: null, integration: null, recovery: null, state: "ISOLATED", createdAt: timestamp(), updatedAt: timestamp()
      };
      state.units[workUnitId] = unit;
      this.save(identity, state);
      return structuredClone(unit);
    } catch (error) {
      if (mode === "GIT_WORKTREE" || repository) this.git(identity.root, ["worktree", "remove", "--force", executionRoot], { allowFailure: true, timeout: 30_000 });
      if (fs.existsSync(executionRoot)) fs.rmSync(executionRoot, { recursive: true, force: true });
      throw error;
    }
  }

  get(project, workUnitId) {
    const identity = this.identity(project);
    const unit = this.load(identity).units[String(workUnitId)];
    if (!unit) throw worktreeError("WORKTREE_UNIT_UNKNOWN", "Work Unit desconocida.");
    if (unit.projectId !== identity.projectId || unit.projectRoot !== identity.root) throw worktreeError("WORKTREE_STATE_IDENTITY_MISMATCH", "La Work Unit pertenece a otro proyecto.");
    return structuredClone(unit);
  }

  changedFilesFor(unit) {
    const currentPaths = unit.isolationMode === "GIT_WORKTREE" ? this.gitChangedPaths(unit.executionRoot) : this.scanFiles(unit.executionRoot);
    const baseline = new Map((unit.isolationBaseline?.entries || []).map((entry) => [entry.path, entry]));
    const candidates = new Set([...currentPaths, ...baseline.keys()]);
    return [...candidates].filter((relativePath) => {
      const original = baseline.get(relativePath) || { path: relativePath, exists: false, sha256: null, size: 0, mode: null };
      return !sameEntry(fileEntry(unit.executionRoot, relativePath), original);
    }).sort();
  }

  changedFiles(project, workUnitId) {
    const unit = this.get(project, workUnitId);
    if (!unit.executionRootAvailable || !fs.existsSync(unit.executionRoot)) throw worktreeError("WORKTREE_EXECUTION_ROOT_MISSING", "La carpeta aislada ya no está disponible.");
    const files = this.changedFilesFor(unit);
    return { workUnitId: unit.workUnitId, executionRoot: unit.executionRoot, files, fingerprint: fingerprint(unit.executionRoot, files) };
  }

  recordTest(project, workUnitId, input = {}) {
    const identity = this.identity(project);
    const state = this.load(identity);
    const unit = state.units[String(workUnitId)];
    if (!unit) throw worktreeError("WORKTREE_UNIT_UNKNOWN", "Work Unit desconocida.");
    if (!unit.executionRootAvailable || !fs.existsSync(unit.executionRoot)) throw worktreeError("WORKTREE_EXECUTION_ROOT_MISSING", "La carpeta aislada ya no está disponible.");
    const changedFiles = this.changedFilesFor(unit);
    const current = fingerprint(unit.executionRoot, changedFiles);
    const undeclared = changedFiles.filter((item) => !unit.expectedFiles.includes(item));
    const missingRequired = unit.requiredFiles.filter((item) => !changedFiles.includes(item));
    const command = Array.isArray(input.command) ? input.command.map(String).slice(0, 100) : [];
    unit.test = {
      testId: String(input.testId || crypto.randomUUID()), passed: input.passed === true && Number(input.exitCode) === 0,
      independent: input.independent === true, command, exitCode: Number.isInteger(input.exitCode) ? input.exitCode : null,
      treeHash: current.treeHash, files: current.entries, changedFiles, undeclared, missingRequired,
      evidenceIds: [...new Set((input.evidenceIds || []).map(String))].slice(0, 500), testedAt: timestamp()
    };
    unit.state = unit.test.passed && unit.test.independent && !undeclared.length && !missingRequired.length ? "TESTED" : "REWORK_REQUIRED";
    unit.updatedAt = timestamp();
    this.save(identity, state);
    return structuredClone(unit);
  }

  prepareIntegration(project, workUnitId) {
    const identity = this.identity(project);
    const state = this.load(identity);
    const unit = state.units[String(workUnitId)];
    if (!unit) throw worktreeError("WORKTREE_UNIT_UNKNOWN", "Work Unit desconocida.");
    if (!unit.executionRootAvailable || !fs.existsSync(unit.executionRoot)) throw worktreeError("WORKTREE_EXECUTION_ROOT_MISSING", "La carpeta aislada ya no está disponible.");
    const changedFiles = this.changedFilesFor(unit);
    const current = fingerprint(unit.executionRoot, changedFiles);
    const mainUnchanged = fingerprint(identity.root, unit.expectedFiles).treeHash === unit.mainBase.treeHash;
    const bytesUnchangedSinceTest = unit.test?.treeHash === current.treeHash;
    const undeclared = changedFiles.filter((item) => !unit.expectedFiles.includes(item));
    const missingRequired = unit.requiredFiles.filter((item) => !changedFiles.includes(item));
    const testedFiles = new Set((unit.test?.files || []).map((entry) => entry.path));
    const contractRelevant = changedFiles.filter(isContractPath);
    let contractGate = { state: "NOT_REQUIRED", relevantFiles: [], contractTests: [], testsCovered: true };
    if (contractRelevant.length) {
      if (!this.contractIntelligence) contractGate = { state: "BLOCKED_UNAVAILABLE", relevantFiles: contractRelevant, contractTests: [], testsCovered: false };
      else if (!unit.contractSnapshotId) contractGate = { state: "BASELINE_REQUIRED", relevantFiles: contractRelevant, contractTests: [], testsCovered: false };
      else {
        try {
          contractGate = this.contractIntelligence.gateIsolated(identity.project, {
            snapshotId: unit.contractSnapshotId, executionRoot: unit.executionRoot, changedFiles
          });
          const command = new Set((unit.test?.command || []).map(String));
          const testsCovered = contractGate.contractTests.length > 0 && contractGate.contractTests.every((relativePath) => command.has(relativePath)) && (unit.test?.evidenceIds || []).length > 0;
          contractGate = { ...contractGate, testsCovered };
        } catch (error) {
          contractGate = { state: "BLOCKED_ANALYSIS_FAILED", relevantFiles: contractRelevant, contractTests: [], testsCovered: false, error: { code: error.code || "CONTRACT_GATE_FAILED", message: String(error.message || error).slice(0, 2000) } };
        }
      }
    }
    const contractCovered = contractGate.state === "NOT_REQUIRED" || contractGate.state === "UNCHANGED" || (contractGate.state === "COMPATIBLE_TESTS_REQUIRED" && contractGate.testsCovered === true);
    const covered = unit.test?.passed === true && unit.test?.independent === true && bytesUnchangedSinceTest && mainUnchanged && contractCovered &&
      !undeclared.length && !missingRequired.length && changedFiles.every((item) => testedFiles.has(item));
    unit.state = covered ? "READY_TO_INTEGRATE" : "REWORK_REQUIRED";
    unit.integration = {
      covered, currentTreeHash: current.treeHash, testedTreeHash: unit.test?.treeHash || null,
      bytesUnchangedSinceTest, mainUnchanged, independentTest: unit.test?.independent === true,
      undeclared, missingRequired, contractGate, checkedAt: timestamp()
    };
    unit.updatedAt = timestamp();
    this.save(identity, state);
    return structuredClone(unit);
  }

  integrate(project, workUnitId) {
    const prepared = this.prepareIntegration(project, workUnitId);
    if (prepared.state !== "READY_TO_INTEGRATE") throw worktreeError("WORKTREE_NOT_READY", "Los bytes aislados no superaron los gates de integración.", { integration: prepared.integration });
    const identity = this.identity(project);
    const state = this.load(identity);
    const unit = state.units[String(workUnitId)];
    const changedFiles = unit.test.changedFiles;
    const recoveryRoot = path.join(identity.tasksRoot, "integration-recovery", digest(workUnitId).slice(0, 24));
    if (fs.existsSync(recoveryRoot)) throw worktreeError("WORKTREE_RECOVERY_EXISTS", "Ya existe una recuperación para esta Work Unit; no fue sobrescrita.");
    fs.mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
    const backup = fingerprint(identity.root, changedFiles);
    const stagedRoot = path.join(recoveryRoot, "staged");
    const backupRoot = path.join(recoveryRoot, "before");
    const budget = { files: 0, bytes: 0, maxFiles: this.maxFiles, maxBytes: this.maxBytes };
    try {
      for (const entry of backup.entries) if (entry.exists) copyRegular(safeRelative(identity.root, entry.path).absolute, safeRelative(backupRoot, entry.path).absolute, budget);
      for (const relativePath of changedFiles) {
        const source = safeRelative(unit.executionRoot, relativePath).absolute;
        if (fs.existsSync(source)) copyRegular(source, safeRelative(stagedRoot, relativePath).absolute, budget);
      }
      const staged = fingerprint(stagedRoot, changedFiles);
      if (staged.treeHash !== unit.test.treeHash) throw worktreeError("WORKTREE_STAGING_MISMATCH", "Los bytes preparados no coinciden con los bytes probados.");
      for (const relativePath of changedFiles) {
        const stagedFile = safeRelative(stagedRoot, relativePath).absolute;
        const target = safeRelative(identity.root, relativePath).absolute;
        if (!fs.existsSync(stagedFile)) {
          if (fs.existsSync(target)) {
            const stat = fs.lstatSync(target);
            if (!stat.isFile() || stat.isSymbolicLink()) throw worktreeError("WORKTREE_INTEGRATION_UNSAFE", `Integración bloqueó ${relativePath}.`);
            fs.unlinkSync(target);
          }
          continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temporary = `${target}.dorn-${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`;
        copyRegular(stagedFile, temporary, budget);
        if (fs.existsSync(target)) fs.unlinkSync(target);
        fs.renameSync(temporary, target);
      }
      const integrated = fingerprint(identity.root, changedFiles);
      if (integrated.treeHash !== unit.test.treeHash) throw worktreeError("WORKTREE_INTEGRATED_BYTES_MISMATCH", "Los bytes integrados no coinciden con los bytes probados.");
      unit.state = "INTEGRATED";
      unit.integration = { ...unit.integration, integratedTreeHash: integrated.treeHash, integratedAt: timestamp() };
      unit.recovery = { root: recoveryRoot, before: backup, available: true, createdAt: timestamp() };
      unit.updatedAt = timestamp();
      this.save(identity, state);
      return structuredClone(unit);
    } catch (error) {
      try { this.restoreBackup(identity.root, backupRoot, backup); }
      catch (rollbackError) { error.rollbackError = String(rollbackError?.message || rollbackError).slice(0, 2000); }
      unit.state = "BLOCKED";
      unit.integration = { ...unit.integration, failure: String(error?.message || error).slice(0, 4000), failedAt: timestamp() };
      unit.recovery = { root: recoveryRoot, before: backup, available: fs.existsSync(recoveryRoot), createdAt: timestamp() };
      unit.updatedAt = timestamp();
      this.save(identity, state);
      throw error;
    }
  }

  restoreBackup(projectRoot, backupRoot, backup) {
    for (const entry of backup.entries) {
      const target = safeRelative(projectRoot, entry.path).absolute;
      if (!entry.exists) {
        if (fs.existsSync(target)) {
          const stat = fs.lstatSync(target);
          if (!stat.isFile() || stat.isSymbolicLink()) throw worktreeError("WORKTREE_ROLLBACK_UNSAFE", `Rollback bloqueó ${entry.path}.`);
          fs.unlinkSync(target);
        }
        continue;
      }
      const source = safeRelative(backupRoot, entry.path).absolute;
      const current = fileEntry(backupRoot, entry.path);
      if (!sameEntry(current, entry)) throw worktreeError("WORKTREE_BACKUP_MISMATCH", `El respaldo de ${entry.path} cambió.`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.dorn-rollback-${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`;
      const budget = { files: 0, bytes: 0, maxFiles: this.maxFiles, maxBytes: this.maxBytes };
      copyRegular(source, temporary, budget);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      fs.renameSync(temporary, target);
    }
  }

  rollback(project, workUnitId) {
    const identity = this.identity(project);
    const state = this.load(identity);
    const unit = state.units[String(workUnitId)];
    if (!unit || unit.state !== "INTEGRATED" || !unit.recovery?.available) throw worktreeError("WORKTREE_ROLLBACK_UNAVAILABLE", "No existe una integración recuperable para esta Work Unit.");
    const changedFiles = unit.test.changedFiles;
    if (fingerprint(identity.root, changedFiles).treeHash !== unit.integration.integratedTreeHash) {
      throw worktreeError("WORKTREE_ROLLBACK_MAIN_CHANGED", "El proyecto cambió después de integrar; rollback automático quedó bloqueado.");
    }
    this.restoreBackup(identity.root, path.join(unit.recovery.root, "before"), unit.recovery.before);
    if (fingerprint(identity.root, unit.expectedFiles).treeHash !== unit.mainBase.treeHash) throw worktreeError("WORKTREE_ROLLBACK_MISMATCH", "Rollback no restauró los bytes originales.");
    unit.state = "ROLLED_BACK";
    unit.recovery.available = false;
    unit.recovery.rolledBackAt = timestamp();
    unit.updatedAt = timestamp();
    this.save(identity, state);
    return structuredClone(unit);
  }

  dispose(project, workUnitId, options = {}) {
    const identity = this.identity(project);
    const state = this.load(identity);
    const unit = state.units[String(workUnitId)];
    if (!unit) throw worktreeError("WORKTREE_UNIT_UNKNOWN", "Work Unit desconocida.");
    if (!options.force && !DISPOSABLE_STATES.has(unit.state)) throw worktreeError("WORKTREE_DISPOSE_BLOCKED", "El aislamiento conserva trabajo no integrado.");
    const projectIsolationRoot = path.join(this.isolationRoot, identity.projectId);
    const executionRoot = path.resolve(unit.executionRoot);
    if (!executionRoot.startsWith(`${projectIsolationRoot}${path.sep}`) || executionRoot === projectIsolationRoot) throw worktreeError("WORKTREE_DISPOSE_PATH_UNSAFE", "La carpeta aislada no se puede descartar con seguridad.");
    if (unit.isolationMode === "GIT_WORKTREE") this.git(identity.root, ["worktree", "remove", "--force", executionRoot], { allowFailure: true, timeout: 30_000 });
    if (fs.existsSync(executionRoot)) fs.rmSync(executionRoot, { recursive: true, force: true });
    unit.executionRootAvailable = false;
    unit.disposedAt = timestamp();
    unit.updatedAt = timestamp();
    this.save(identity, state);
    return structuredClone(unit);
  }
}

module.exports = { WorktreeManager, fingerprint, fileEntry, safeRelative };
