"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomicJson } = require("../dorn-suite/common");

const IGNORED = new Set([".git", ".dorn", "node_modules", "dist", "build", "out", "coverage", ".cache", ".next", ".turbo"]);

function timestamp() { return new Date().toISOString(); }

function safeRelative(root, value) {
  const input = String(value || "");
  if (path.isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input) || input.includes("\0")) throw new Error("Change Scope recibió una ruta absoluta o inválida.");
  const relative = input.replaceAll("\\", "/");
  if (!relative || relative.split("/").some((part) => part === ".." || part === "." || part === "")) throw new Error("Change Scope recibió una ruta insegura.");
  const absolute = path.resolve(root, ...relative.split("/"));
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error("La ruta sale del proyecto.");
  return { relative, absolute };
}

function fileHash(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(512 * 1024);
  try {
    let bytes = 0;
    do { bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (bytes) hash.update(buffer.subarray(0, bytes)); } while (bytes);
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

function fingerprint(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return { exists: false, kind: stat.isSymbolicLink() ? "SYMLINK" : "NON_FILE" };
    return { exists: true, kind: "FILE", sizeBytes: stat.size, modifiedMs: Math.trunc(stat.mtimeMs), sha256: fileHash(filePath) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, kind: "MISSING" };
    return { exists: false, kind: "ERROR", error: String(error?.code || error?.message || error) };
  }
}

function changed(before, after) {
  return before?.exists !== after?.exists || before?.sha256 !== after?.sha256 || before?.kind !== after?.kind;
}

function scanTree(root, options = {}) {
  const maxFiles = Math.max(100, Math.min(50000, Number(options.maxFiles) || 20000));
  const timeBudgetMs = Math.max(100, Math.min(15000, Number(options.timeBudgetMs) || 5000));
  const started = Date.now();
  const queue = [root];
  const files = {};
  let fileCount = 0;
  let ignored = 0;
  while (queue.length && fileCount < maxFiles && Date.now() - started < timeBudgetMs) {
    const directory = queue.shift();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { return { files, complete: false, reason: "DIRECTORY_UNREADABLE", ignored, durationMs: Date.now() - started }; }
    for (const entry of entries) {
      if (fileCount >= maxFiles || Date.now() - started >= timeBudgetMs) break;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) { files[relative] = { exists: false, kind: "SYMLINK" }; fileCount += 1; continue; }
      if (entry.isDirectory()) {
        if (IGNORED.has(entry.name)) ignored += 1;
        else queue.push(absolute);
      } else if (entry.isFile()) {
        files[relative] = fingerprint(absolute);
        fileCount += 1;
      } else {
        files[relative] = { exists: false, kind: "NON_FILE" };
        fileCount += 1;
      }
    }
  }
  const complete = queue.length === 0;
  return { files, complete, reason: complete ? null : fileCount >= maxFiles ? "FILE_LIMIT" : "TIME_LIMIT", ignored, durationMs: Date.now() - started };
}

class ProjectWatcher {
  constructor(options = {}) { this.projectCore = options.projectCore || null; this.eventBus = options.eventBus || null; }
  projectCore;
  eventBus;
  scopes = new Map();
  watchers = new Map();
  pathClaims = new Map();

  begin(project, request = {}) {
    const opened = this.projectCore?.open(project.rootPath, { projectId: project.id || project.projectId, name: project.name }) || project;
    const root = fs.realpathSync(opened.rootPath || project.rootPath);
    const expectedPaths = [...new Set((request.expectedPaths || []).map((item) => safeRelative(root, item).relative))].sort();
    if (!expectedPaths.length) throw new Error("Change Scope necesita declarar al menos una ruta antes de empezar.");
    this.watch({ id: project.id || project.projectId, rootPath: root });
    const watchRecord = this.watchers.get(String(project.id || project.projectId));
    const scopeId = crypto.randomUUID();
    const recoveryRoot = path.join(root, ".dorn", "snapshots", `change-scope-${scopeId}`);
    fs.mkdirSync(recoveryRoot, { recursive: true });
    const baseline = {};
    const recoveryEntries = [];
    try {
      for (const relative of expectedPaths) {
        const target = safeRelative(root, relative).absolute;
        const before = fingerprint(target);
        baseline[relative] = before;
        if (!["FILE", "MISSING"].includes(before.kind)) throw new Error(`Change Scope no puede recuperar ${relative}: no es un archivo regular o no pudo leerse.`);
        if (before.exists && before.sizeBytes > 256 * 1024 * 1024) throw new Error(`Change Scope no puede copiar ${relative}: supera 256 MB.`);
        const recoveryFile = path.join(recoveryRoot, ...relative.split("/"));
        if (before.exists) {
          fs.mkdirSync(path.dirname(recoveryFile), { recursive: true });
          fs.copyFileSync(target, recoveryFile);
          if (fileHash(recoveryFile) !== before.sha256) throw new Error(`El snapshot cambió durante la copia: ${relative}.`);
        }
        recoveryEntries.push({ relativePath: relative, existed: before.exists, sha256: before.sha256 || null, sizeBytes: before.sizeBytes || 0 });
      }
      atomicJson(path.join(recoveryRoot, "manifest.json"), { schema: "dorn.change-scope-recovery/1", scopeId, projectId: project.id || project.projectId, entries: recoveryEntries, createdAt: timestamp() });
    } catch (error) {
      fs.rmSync(recoveryRoot, { recursive: true, force: true });
      throw error;
    }
    const fallbackBaseline = watchRecord?.status?.recursive && request.coverage?.forceFallback !== true
      ? null
      : scanTree(root, request.coverage || {});
    const scope = {
      schema: "dorn.change-scope/1", scopeId, workUnitId: request.workUnitId || null,
      projectId: project.id || project.projectId, root, expectedPaths,
      baseline, recoveryRoot, recoveryEntries,
      fallbackBaseline,
      journalSequence: watchRecord?.sequence || 0,
      state: "OPEN", createdAt: timestamp(), integrationBaseline: null
    };
    this.scopes.set(scope.scopeId, scope);
    return this.public(scope);
  }

  prepare(scopeId, declaredPaths = []) {
    const scope = this.require(scopeId);
    if (scope.state !== "OPEN") throw new Error("Change Scope no está abierto.");
    const declared = [...new Set(declaredPaths.map((item) => safeRelative(scope.root, item).relative))].sort();
    const conflicts = [];
    const expected = new Set(scope.expectedPaths);
    for (const relative of declared) {
      if (!expected.has(relative)) {
        conflicts.push({ relativePath: relative, reason: "PATH_NOT_DECLARED_AT_START", before: null, actual: fingerprint(safeRelative(scope.root, relative).absolute) });
        continue;
      }
      const before = scope.baseline[relative] || { exists: false, kind: "MISSING" };
      const actual = fingerprint(safeRelative(scope.root, relative).absolute);
      if (changed(before, actual)) conflicts.push({ relativePath: relative, reason: "CHANGED_AFTER_WORK_UNIT_STARTED", before, actual });
      const claimKey = `${scope.projectId}:${relative}`;
      const claimedBy = this.pathClaims.get(claimKey);
      if (claimedBy && claimedBy !== scope.scopeId) {
        const owner = this.scopes.get(claimedBy);
        conflicts.push({ relativePath: relative, reason: "PARALLEL_WORK_UNIT_OVERLAP", workUnitId: owner?.workUnitId || null, scopeId: claimedBy });
      }
    }
    scope.declaredPaths = declared;
    scope.integrationBaseline = Object.fromEntries(declared.map((relative) => [relative, fingerprint(safeRelative(scope.root, relative).absolute)]));
    scope.integrationSequence = this.watchers.get(String(scope.projectId))?.sequence || scope.journalSequence;
    scope.state = conflicts.length ? "REVIEW_REQUIRED" : "READY_TO_INTEGRATE";
    scope.conflicts = conflicts;
    if (!conflicts.length) for (const relative of declared) this.pathClaims.set(`${scope.projectId}:${relative}`, scope.scopeId);
    scope.preparedAt = timestamp();
    return { ...this.public(scope), conflicts };
  }

  async finish(scopeId) {
    const scope = this.require(scopeId);
    if (!scope.integrationBaseline) throw new Error("Change Scope necesita prepare antes de finish.");
    if (scope.state === "REVIEW_REQUIRED") return { ...this.public(scope), conflicts: scope.conflicts || [] };
    await new Promise((resolve) => setTimeout(resolve, 25));
    const record = this.watchers.get(String(scope.projectId));
    const journal = (record?.journal || []).filter((item) => item.sequence > Number(scope.integrationSequence || 0));
    const all = new Set([...Object.keys(scope.integrationBaseline), ...journal.map((item) => item.relativePath)]);
    let coverageIncomplete = false;
    if (scope.fallbackBaseline) {
      const currentTree = scanTree(scope.root, { maxFiles: 20000, timeBudgetMs: 5000 });
      coverageIncomplete = !scope.fallbackBaseline.complete || !currentTree.complete;
      for (const relative of new Set([...Object.keys(scope.fallbackBaseline.files), ...Object.keys(currentTree.files)])) {
        const before = scope.fallbackBaseline.files[relative] || { exists: false, kind: "MISSING" };
        const after = currentTree.files[relative] || { exists: false, kind: "MISSING" };
        if (changed(before, after)) all.add(relative);
      }
    }
    const observed = [];
    for (const relative of all) {
      const declaredAtStart = Boolean(scope.integrationBaseline[relative]);
      const before = scope.integrationBaseline[relative] || { exists: false, kind: "MISSING" };
      const actual = fingerprint(safeRelative(scope.root, relative).absolute);
      if (declaredAtStart ? changed(before, actual) : !["MISSING", "NON_FILE"].includes(actual.kind)) observed.push({ relativePath: relative, before, actual });
    }
    const declared = new Set(scope.declaredPaths || []);
    const undeclared = observed.filter((item) => !declared.has(item.relativePath));
    const missing = [...declared].filter((relative) => !observed.some((item) => item.relativePath === relative));
    scope.state = undeclared.length || missing.length || coverageIncomplete ? "REVIEW_REQUIRED" : "INTEGRATED";
    scope.finishedAt = timestamp();
    scope.observed = observed;
    scope.undeclared = undeclared;
    scope.missing = missing;
    scope.coverageIncomplete = coverageIncomplete;
    this.releaseClaims(scope);
    return { ...this.public(scope), observed, undeclared, missing, coverageIncomplete };
  }

  rollback(scopeId) {
    const scope = this.require(scopeId);
    const result = this.applyRecovery(scope.root, scope.recoveryRoot, scopeId);
    scope.state = "ROLLED_BACK";
    scope.rolledBackAt = timestamp();
    this.releaseClaims(scope);
    return { ...this.public(scope), restored: result.restored };
  }

  abandon(scopeId, reason = "ABANDONED_WITHOUT_MAIN_WRITE") {
    const scope = this.require(scopeId);
    scope.state = "ABANDONED";
    scope.abandonedAt = timestamp();
    scope.abandonReason = String(reason || "ABANDONED").slice(0, 1000);
    this.releaseClaims(scope);
    return { ...this.public(scope), abandonReason: scope.abandonReason };
  }

  rollbackSnapshot(project, scopeId) {
    const id = String(scopeId || "");
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Snapshot de Change Scope inválido.");
    const root = fs.realpathSync(project.rootPath);
    const recoveryRoot = path.join(root, ".dorn", "snapshots", `change-scope-${id}`);
    return { schema: "dorn.change-scope-rollback/1", scopeId: id, ...this.applyRecovery(root, recoveryRoot, id), rolledBackAt: timestamp() };
  }

  applyRecovery(root, recoveryRoot, scopeId) {
    const manifestPath = path.join(recoveryRoot, "manifest.json");
    if (!fs.existsSync(manifestPath)) throw new Error("El snapshot ya no está disponible.");
    const manifestStat = fs.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 16 * 1024 * 1024) throw new Error("Manifest de recuperación inseguro.");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.schema !== "dorn.change-scope-recovery/1" || manifest.scopeId !== scopeId || !Array.isArray(manifest.entries)) throw new Error("Manifest de recuperación inválido.");
    const restored = [];
    for (const entry of manifest.entries) {
      const target = safeRelative(root, entry.relativePath).absolute;
      const recoveryFile = path.join(recoveryRoot, ...entry.relativePath.split("/"));
      if (entry.existed) {
        if (!fs.existsSync(recoveryFile)) throw new Error(`Snapshot dañado: ${entry.relativePath}.`);
        const recoveryStat = fs.lstatSync(recoveryFile);
        if (!recoveryStat.isFile() || recoveryStat.isSymbolicLink() || fileHash(recoveryFile) !== entry.sha256) throw new Error(`Snapshot dañado: ${entry.relativePath}.`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(recoveryFile, target);
      } else if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Rollback bloqueó una ruta no regular: ${entry.relativePath}.`);
        fs.unlinkSync(target);
      }
      restored.push(entry.relativePath);
    }
    return { restored };
  }

  public(scope) {
    return {
      schema: scope.schema, scopeId: scope.scopeId, workUnitId: scope.workUnitId, projectId: scope.projectId,
      expectedPaths: [...scope.expectedPaths], declaredPaths: [...(scope.declaredPaths || [])], state: scope.state,
      recoveryAvailable: Boolean(scope.recoveryRoot), createdAt: scope.createdAt, preparedAt: scope.preparedAt || null,
      finishedAt: scope.finishedAt || null, rolledBackAt: scope.rolledBackAt || null
    };
  }

  require(scopeId) {
    const scope = this.scopes.get(String(scopeId));
    if (!scope) throw new Error("Change Scope no existe o ya expiró.");
    return scope;
  }

  releaseClaims(scope) {
    for (const relative of scope.declaredPaths || []) {
      const key = `${scope.projectId}:${relative}`;
      if (this.pathClaims.get(key) === scope.scopeId) this.pathClaims.delete(key);
    }
  }

  watch(project, onChange = null) {
    const projectId = String(project.id || project.projectId);
    if (this.watchers.has(projectId)) {
      const existing = this.watchers.get(projectId);
      if (typeof onChange === "function") existing.subscribers.set(onChange, existing.sequence);
      return existing.status;
    }
    const root = fs.realpathSync(project.rootPath);
    const pending = new Map();
    const subscribers = new Map(typeof onChange === "function" ? [[onChange, 0]] : []);
    const journal = [];
    const record = { watcher: null, pending, subscribers, journal, sequence: 0, status: null };
    const emit = (rawName) => {
      if (!rawName) return;
      const relativePath = String(rawName).replaceAll("\\", "/");
      if (!relativePath || relativePath.split("/").some((part) => IGNORED.has(part) || part === "..")) return;
      record.sequence += 1;
      const eventSequence = record.sequence;
      journal.push({ sequence: eventSequence, relativePath, observedAt: timestamp() });
      if (journal.length > 10000) journal.splice(0, journal.length - 10000);
      clearTimeout(pending.get(relativePath));
      pending.set(relativePath, setTimeout(async () => {
        pending.delete(relativePath);
        const target = safeRelative(root, relativePath);
        const payload = { projectId, relativePath, fingerprint: fingerprint(target.absolute), observedAt: timestamp(), source: "FILESYSTEM_WATCHER" };
        try { await this.eventBus?.publish("FILE_MODIFIED", payload, { projectId, idempotencyKey: `file:${projectId}:${relativePath}:${payload.fingerprint.sha256 || payload.fingerprint.kind}:${payload.observedAt}` }); } catch {}
        for (const [subscriber, afterSequence] of subscribers) {
          if (eventSequence <= afterSequence) continue;
          try { await subscriber(payload); } catch {}
        }
      }, 120));
    };
    let watcher;
    let recursive = true;
    try { watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => emit(filename)); }
    catch {
      recursive = false;
      try { watcher = fs.watch(root, {}, (_eventType, filename) => emit(filename)); }
      catch (error) {
        const status = { projectId, root, state: "DEGRADED", recursive: false, startedAt: timestamp(), error: String(error?.message || error) };
        record.status = status;
        this.watchers.set(projectId, record);
        return status;
      }
    }
    const status = { projectId, root, state: "WATCHING", recursive, startedAt: timestamp() };
    watcher.on("error", (error) => { status.state = "DEGRADED"; status.error = String(error.message || error); });
    record.watcher = watcher;
    record.status = status;
    this.watchers.set(projectId, record);
    return status;
  }

  unwatch(projectId) {
    const record = this.watchers.get(String(projectId));
    if (!record) return false;
    for (const timer of record.pending.values()) clearTimeout(timer);
    try { record.watcher?.close(); } catch {}
    this.watchers.delete(String(projectId));
    return true;
  }

  closeAll() {
    for (const projectId of [...this.watchers.keys()]) this.unwatch(projectId);
    this.pathClaims.clear();
  }
}

module.exports = { ProjectWatcher, fingerprint, safeRelative, scanTree };
