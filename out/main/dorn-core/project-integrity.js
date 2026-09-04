"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const IGNORED_DIRECTORIES = new Set([
  ".dorn", ".git", "node_modules", "dist", "build", "out", "coverage", "target", ".gradle",
  ".idea", ".vscode", ".cache", ".next", ".turbo", ".pio"
]);
const MANIFEST_NAMES = new Set([
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.toml", "Cargo.lock",
  "pyproject.toml", "requirements.txt", "poetry.lock", "go.mod", "go.sum", "pom.xml",
  "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "CMakeLists.txt",
  "platformio.ini", "sdkconfig", "project.godot", "UnityProjectVersion.txt"
]);
const SOURCE_EXTENSIONS = new Set([
  ".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".json", ".py", ".rs", ".go", ".java",
  ".kt", ".cs", ".cpp", ".cc", ".c", ".h", ".hpp", ".swift", ".dart", ".html", ".css",
  ".scss", ".sql", ".ino", ".gd", ".shader", ".md", ".toml", ".yaml", ".yml"
]);
const IMPORT_EXTENSIONS = ["", ".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".json"];
const MAX_INLINE_HASH_BYTES = 32 * 1024 * 1024;
const MAX_DEPENDENCY_SOURCE_BYTES = 1024 * 1024;

function timestamp() { return new Date().toISOString(); }

function projectIdentity(project) {
  const projectId = String(project?.id || project?.projectId || "");
  if (!projectId || projectId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(projectId) || !project?.rootPath) throw new Error("Project Integrity requiere un proyecto real e identificado.");
  const root = fs.realpathSync(project.rootPath);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Project Integrity requiere una carpeta de proyecto.");
  return { projectId, root };
}

function safeRelative(root, rawPath, options = {}) {
  const input = String(rawPath ?? "");
  if (path.isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input) || input.includes("\0")) {
    throw Object.assign(new Error("Project Integrity recibió una ruta absoluta o inválida."), { code: "INTEGRITY_PATH_UNSAFE" });
  }
  const normalized = input.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized && options.allowRoot === true) return { relativePath: "", absolute: root };
  if (!normalized || normalized.split("/").some((segment) => !segment || segment === ".." || segment === ".")) {
    throw Object.assign(new Error("Project Integrity recibió una ruta insegura."), { code: "INTEGRITY_PATH_UNSAFE" });
  }
  const absolute = path.resolve(root, ...normalized.split("/"));
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error("Project Integrity recibió una ruta fuera del proyecto."), { code: "INTEGRITY_SCOPE_VIOLATION" });
  }
  return { relativePath: normalized, absolute };
}

function digestFile(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const chunk = Buffer.allocUnsafe(512 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead) hash.update(chunk.subarray(0, bytesRead));
    } while (bytesRead);
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

function resolveLocalDependency(root, sourcePath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
  if (!base || base === ".." || base.startsWith("../")) return null;
  const candidates = [
    ...IMPORT_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...IMPORT_EXTENSIONS.filter(Boolean).map((extension) => `${base}/index${extension}`)
  ];
  for (const candidate of candidates) {
    try {
      const checked = safeRelative(root, candidate);
      const stat = fs.lstatSync(checked.absolute);
      if (stat.isFile() && !stat.isSymbolicLink()) return checked.relativePath;
    } catch {}
  }
  return base;
}

function parseLocalDependencies(root, relativePath, absolute, sizeBytes) {
  const extension = path.extname(relativePath).toLowerCase();
  if (![".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx"].includes(extension) || sizeBytes > MAX_DEPENDENCY_SOURCE_BYTES) return [];
  let source;
  try { source = fs.readFileSync(absolute, "utf8"); } catch { return []; }
  const specs = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null && specs.size < 500) specs.add(match[1]);
  }
  return [...specs].map((specifier) => resolveLocalDependency(root, relativePath, specifier)).filter(Boolean).sort();
}

function pathKind(relativePath) {
  const name = path.posix.basename(relativePath);
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (MANIFEST_NAMES.has(name)) return "MANIFEST";
  if (/(^|\/)(?:test|tests|spec|specs|__tests__)(\/|$)|\.(?:test|spec)\.[^.]+$/i.test(relativePath)) return "TEST";
  if (/\.(?:png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(extension)) return "VISUAL_ASSET";
  if (SOURCE_EXTENSIONS.has(extension)) return "SOURCE";
  return "ASSET";
}

function riskLevel(score) {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

class ProjectIntegrityEngine {
  constructor(options = {}) {
    this.evidenceCore = options.evidenceCore || null;
    this.eventBus = options.eventBus || null;
    this.projectCore = options.projectCore || null;
  }

  evidenceCore;
  eventBus;
  projectCore;
  databases = new Map();
  databaseOwners = new Map();
  directoryHandles = new Map();

  databasePath(root) { return path.join(root, ".dorn", "manifests", "project-integrity.db"); }

  openDatabase(databasePath) {
    const db = new DatabaseSync(databasePath);
    try { db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=3000;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS integrity_scans (
        scan_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        state TEXT NOT NULL,
        files_scanned INTEGER NOT NULL DEFAULT 0,
        directories_scanned INTEGER NOT NULL DEFAULT 0,
        ignored_entries INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS integrity_scan_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL,
        relative_dir TEXT NOT NULL,
        entry_offset INTEGER NOT NULL DEFAULT 0,
        UNIQUE(scan_id, relative_dir)
      );
      CREATE INDEX IF NOT EXISTS idx_integrity_queue_scan ON integrity_scan_queue(scan_id, id);
      CREATE TABLE IF NOT EXISTS integrity_files (
        relative_path TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        modified_ms INTEGER NOT NULL,
        sha256 TEXT,
        hash_state TEXT NOT NULL,
        kind TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_integrity_files_scan ON integrity_files(scan_id, relative_path);
      CREATE INDEX IF NOT EXISTS idx_integrity_files_kind ON integrity_files(kind, relative_path);
      CREATE TABLE IF NOT EXISTS integrity_dependencies (
        scan_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        target_path TEXT NOT NULL,
        PRIMARY KEY(scan_id, source_path, target_path)
      );
      CREATE INDEX IF NOT EXISTS idx_integrity_dependency_target ON integrity_dependencies(scan_id, target_path, source_path);
      CREATE TABLE IF NOT EXISTS integrity_dirty (
        relative_path TEXT PRIMARY KEY,
        observed_at TEXT NOT NULL,
        fingerprint_json TEXT
      );
    `); }
    catch (error) { try { db.close(); } catch {} throw error; }
    return db;
  }

  ensure(project) {
    const { projectId, root } = projectIdentity(project);
    if (this.databases.has(root)) {
      if (this.databaseOwners.get(root) !== projectId) {
        throw Object.assign(new Error("La base de integridad abierta pertenece a otra identidad de proyecto."), { code: "INTEGRITY_PROJECT_IDENTITY_MISMATCH" });
      }
      return this.databases.get(root);
    }
    const probe = this.projectCore?.probe(root) || null;
    if (probe && (probe.status !== "READY" || probe.manifest?.projectId !== projectId)) {
      throw Object.assign(new Error("Project Integrity bloqueó metadatos de otra identidad."), { code: "INTEGRITY_PROJECT_IDENTITY_MISMATCH" });
    }
    const databasePath = this.databasePath(root);
    const dornRoot = path.join(root, ".dorn");
    const manifestsRoot = path.dirname(databasePath);
    for (const [directory, parent, label] of [[dornRoot, root, ".dorn"], [manifestsRoot, dornRoot, ".dorn/manifests"]]) {
      if (!fs.existsSync(directory)) throw Object.assign(new Error(`Falta ${label}; adopta el proyecto antes de escanear.`), { code: "INTEGRITY_PROJECT_NOT_ADOPTED" });
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(directory)) !== fs.realpathSync(parent)) {
        throw Object.assign(new Error(`${label} no es una carpeta de metadatos segura.`), { code: "INTEGRITY_METADATA_UNSAFE" });
      }
    }
    if (fs.existsSync(databasePath)) {
      const stat = fs.lstatSync(databasePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error("La base de integridad no es un archivo regular seguro."), { code: "INTEGRITY_METADATA_UNSAFE" });
    }
    let db;
    try { db = this.openDatabase(databasePath); }
    catch (error) {
      if (!/malformed|not a database|SQLITE_CORRUPT/i.test(String(error?.message || error)) || !fs.existsSync(databasePath)) throw error;
      try { fs.renameSync(databasePath, `${databasePath}.corrupt-${Date.now()}`); } catch { throw error; }
      for (const suffix of ["-wal", "-shm"]) { try { fs.renameSync(`${databasePath}${suffix}`, `${databasePath}${suffix}.corrupt-${Date.now()}`); } catch {} }
      db = this.openDatabase(databasePath);
    }
    this.databases.set(root, db);
    this.databaseOwners.set(root, projectId);
    return db;
  }

  start(project) {
    const { projectId } = projectIdentity(project);
    const db = this.ensure(project);
    const now = timestamp();
    const scanId = crypto.randomUUID();
    const previousScans = db.prepare("SELECT scan_id FROM integrity_scans WHERE project_id=? AND state='RUNNING'").all(projectId);
    for (const previous of previousScans) this.closeDirectoryHandle(previous.scan_id);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE integrity_scans SET state='ABANDONED',updated_at=? WHERE project_id=? AND state='RUNNING'").run(now, projectId);
      db.prepare("DELETE FROM integrity_scan_queue WHERE scan_id IN (SELECT scan_id FROM integrity_scans WHERE project_id=? AND state='ABANDONED')").run(projectId);
      db.prepare(`INSERT INTO integrity_scans
        (scan_id,project_id,state,files_scanned,directories_scanned,ignored_entries,errors,started_at,updated_at)
        VALUES (?,?,'RUNNING',0,0,0,0,?,?)`).run(scanId, projectId, now, now);
      db.prepare("INSERT INTO integrity_scan_queue (scan_id,relative_dir,entry_offset) VALUES (?,'',0)").run(scanId);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return this.scanStatus(project, scanId);
  }

  scanStatus(project, scanId = null) {
    const { projectId } = projectIdentity(project);
    const db = this.ensure(project);
    const scan = scanId
      ? db.prepare("SELECT * FROM integrity_scans WHERE scan_id=?").get(String(scanId))
      : db.prepare("SELECT * FROM integrity_scans WHERE project_id=? ORDER BY started_at DESC LIMIT 1").get(projectId);
    if (!scan) return { schema: "dorn.project-integrity-status/1", projectId, state: "NOT_SCANNED", files: 0, dirtyFiles: 0, nextCursor: null };
    if (scan.project_id !== projectId) throw Object.assign(new Error("El cursor de integridad pertenece a otro proyecto."), { code: "INTEGRITY_PROJECT_MISMATCH" });
    const files = Number(db.prepare("SELECT COUNT(*) AS count FROM integrity_files WHERE scan_id=?").get(scan.scan_id).count);
    const deferred = Number(db.prepare("SELECT COUNT(*) AS count FROM integrity_files WHERE scan_id=? AND hash_state!='HASHED'").get(scan.scan_id).count);
    const dirtyFiles = Number(db.prepare("SELECT COUNT(*) AS count FROM integrity_dirty").get().count);
    const queuedDirectories = Number(db.prepare("SELECT COUNT(*) AS count FROM integrity_scan_queue WHERE scan_id=?").get(scan.scan_id).count);
    return {
      schema: "dorn.project-integrity-status/1", projectId, scanId: scan.scan_id,
      state: scan.state === "COMPLETED" && dirtyFiles ? "NEEDS_SCAN" : scan.state,
      scanState: scan.state, files, deferredHashes: deferred, dirtyFiles, queuedDirectories,
      filesScanned: Number(scan.files_scanned), directoriesScanned: Number(scan.directories_scanned),
      ignoredEntries: Number(scan.ignored_entries), errors: Number(scan.errors),
      startedAt: scan.started_at, updatedAt: scan.updated_at, completedAt: scan.completed_at,
      nextCursor: scan.state === "RUNNING" ? scan.scan_id : null
    };
  }

  scanPage(project, options = {}) {
    const { projectId, root } = projectIdentity(project);
    const db = this.ensure(project);
    let scanId = options.scanId ? String(options.scanId) : null;
    if (!scanId) scanId = this.start(project).scanId;
    const scan = db.prepare("SELECT * FROM integrity_scans WHERE scan_id=?").get(scanId);
    if (!scan || scan.project_id !== projectId) throw Object.assign(new Error("El cursor de integridad no pertenece al proyecto activo."), { code: "INTEGRITY_PROJECT_MISMATCH" });
    if (scan.state !== "RUNNING") return this.scanStatus(project, scanId);
    const fileBudget = Math.max(1, Math.min(1000, Number(options.fileBudget) || 120));
    const timeBudgetMs = Math.max(10, Math.min(5000, Number(options.timeBudgetMs) || 40));
    const started = Date.now();
    let pageFiles = 0;
    let pageDirectories = 0;
    let pageIgnored = 0;
    let pageErrors = 0;

    while (pageFiles < fileBudget && Date.now() - started < timeBudgetMs) {
      const queued = db.prepare("SELECT id,relative_dir,entry_offset FROM integrity_scan_queue WHERE scan_id=? ORDER BY id LIMIT 1").get(scanId);
      if (!queued) break;
      let directory;
      try {
        const checked = safeRelative(root, queued.relative_dir, { allowRoot: true });
        const stat = fs.lstatSync(checked.absolute);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("La cola contiene una carpeta inválida o un enlace simbólico.");
        const activeHandle = this.directoryHandles.get(scanId);
        if (activeHandle?.queueId === queued.id && activeHandle.relativeDir === queued.relative_dir) {
          directory = activeHandle.directory;
        } else {
          this.closeDirectoryHandle(scanId);
          directory = fs.opendirSync(checked.absolute);
          for (let skipped = 0; skipped < Number(queued.entry_offset); skipped += 1) {
            if (!directory.readSync()) break;
          }
          this.directoryHandles.set(scanId, { queueId: queued.id, relativeDir: queued.relative_dir, directory });
        }
      } catch {
        this.closeDirectoryHandle(scanId);
        db.prepare("DELETE FROM integrity_scan_queue WHERE id=?").run(queued.id);
        pageErrors += 1;
        continue;
      }

      let offset = Number(queued.entry_offset);
      let completeDirectory = false;
      try {
        while (pageFiles < fileBudget && Date.now() - started < timeBudgetMs) {
          const entry = directory.readSync();
          if (!entry) { completeDirectory = true; break; }
          offset += 1;
          if (entry.isSymbolicLink()) { pageIgnored += 1; continue; }
          const relativePath = queued.relative_dir ? `${queued.relative_dir}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (IGNORED_DIRECTORIES.has(entry.name)) pageIgnored += 1;
            else db.prepare("INSERT OR IGNORE INTO integrity_scan_queue (scan_id,relative_dir,entry_offset) VALUES (?,?,0)").run(scanId, relativePath);
            continue;
          }
          if (!entry.isFile()) { pageIgnored += 1; continue; }
          try {
            const checked = safeRelative(root, relativePath);
            const stat = fs.lstatSync(checked.absolute);
            if (!stat.isFile() || stat.isSymbolicLink()) { pageIgnored += 1; continue; }
            const hashState = stat.size <= MAX_INLINE_HASH_BYTES ? "HASHED" : "DEFERRED_LARGE_FILE";
            const sha256 = hashState === "HASHED" ? digestFile(checked.absolute) : null;
            const dependencies = parseLocalDependencies(root, checked.relativePath, checked.absolute, stat.size);
            const now = timestamp();
            db.prepare(`INSERT INTO integrity_files
              (relative_path,size_bytes,modified_ms,sha256,hash_state,kind,scan_id,updated_at)
              VALUES (?,?,?,?,?,?,?,?)
              ON CONFLICT(relative_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_ms=excluded.modified_ms,
              sha256=excluded.sha256,hash_state=excluded.hash_state,kind=excluded.kind,scan_id=excluded.scan_id,updated_at=excluded.updated_at`).run(
              checked.relativePath, stat.size, Math.trunc(stat.mtimeMs), sha256, hashState, pathKind(checked.relativePath), scanId, now
            );
            db.prepare("DELETE FROM integrity_dependencies WHERE source_path=?").run(checked.relativePath);
            const insertDependency = db.prepare("INSERT OR IGNORE INTO integrity_dependencies (scan_id,source_path,target_path) VALUES (?,?,?)");
            for (const dependency of dependencies) insertDependency.run(scanId, checked.relativePath, dependency);
            db.prepare("DELETE FROM integrity_dirty WHERE relative_path=? AND observed_at<=?").run(checked.relativePath, scan.started_at);
            pageFiles += 1;
          } catch { pageErrors += 1; }
        }
      } catch {
        this.closeDirectoryHandle(scanId);
        db.prepare("DELETE FROM integrity_scan_queue WHERE id=?").run(queued.id);
        pageErrors += 1;
        continue;
      }
      if (completeDirectory) {
        this.closeDirectoryHandle(scanId);
        db.prepare("DELETE FROM integrity_scan_queue WHERE id=?").run(queued.id);
        pageDirectories += 1;
      } else {
        db.prepare("UPDATE integrity_scan_queue SET entry_offset=? WHERE id=?").run(offset, queued.id);
      }
    }

    const now = timestamp();
    db.prepare(`UPDATE integrity_scans SET files_scanned=files_scanned+?,directories_scanned=directories_scanned+?,
      ignored_entries=ignored_entries+?,errors=errors+?,updated_at=? WHERE scan_id=?`).run(
      pageFiles, pageDirectories, pageIgnored, pageErrors, now, scanId
    );
    const remaining = Number(db.prepare("SELECT COUNT(*) AS count FROM integrity_scan_queue WHERE scan_id=?").get(scanId).count);
    if (!remaining) {
      this.closeDirectoryHandle(scanId);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM integrity_files WHERE scan_id!=?").run(scanId);
        db.prepare("DELETE FROM integrity_dependencies WHERE scan_id!=?").run(scanId);
        db.prepare("DELETE FROM integrity_dirty WHERE observed_at<=?").run(scan.started_at);
        db.prepare("UPDATE integrity_scans SET state='COMPLETED',completed_at=?,updated_at=? WHERE scan_id=?").run(now, now, scanId);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      void this.eventBus?.publish("PROJECT_INTEGRITY_SCANNED", { scanId, filesScanned: pageFiles }, {
        projectId, idempotencyKey: `integrity:${projectId}:${scanId}`
      });
    }
    return { ...this.scanStatus(project, scanId), page: { files: pageFiles, directories: pageDirectories, ignored: pageIgnored, errors: pageErrors, durationMs: Date.now() - started } };
  }

  invalidate(project, relativePath, fingerprint = null) {
    const { root } = projectIdentity(project);
    const checked = safeRelative(root, relativePath);
    const db = this.ensure(project);
    db.prepare(`INSERT INTO integrity_dirty (relative_path,observed_at,fingerprint_json) VALUES (?,?,?)
      ON CONFLICT(relative_path) DO UPDATE SET observed_at=excluded.observed_at,fingerprint_json=excluded.fingerprint_json`).run(
      checked.relativePath, timestamp(), fingerprint ? JSON.stringify(fingerprint) : null
    );
    return this.scanStatus(project);
  }

  latestCompleted(db, projectId) {
    return db.prepare("SELECT * FROM integrity_scans WHERE project_id=? AND state='COMPLETED' ORDER BY completed_at DESC LIMIT 1").get(projectId);
  }

  contextCandidates(project, input = {}) {
    const { projectId, root } = projectIdentity(project);
    const db = this.ensure(project);
    const scan = this.latestCompleted(db, projectId);
    if (!scan) {
      return {
        schema: "dorn.context-candidates/1", projectId, state: "SCAN_REQUIRED",
        sourceScanId: null, indexedFiles: 0, dirtyPaths: [], candidates: []
      };
    }
    const status = this.scanStatus(project, scan.scan_id);
    const dirtyPaths = db.prepare("SELECT relative_path FROM integrity_dirty ORDER BY relative_path LIMIT 1001")
      .all().map((row) => row.relative_path);
    if (dirtyPaths.length) {
      return {
        schema: "dorn.context-candidates/1", projectId, state: "INDEX_STALE",
        sourceScanId: scan.scan_id, indexedFiles: status.files,
        dirtyPaths: dirtyPaths.slice(0, 1000), dirtyPathsTruncated: dirtyPaths.length > 1000,
        candidates: []
      };
    }
    const maxCandidates = Math.max(10, Math.min(2000, Number(input.maxCandidates) || 500));
    const normalizePaths = (values, label) => {
      if (values !== undefined && !Array.isArray(values)) throw Object.assign(new Error(`${label} debe ser una lista.`), { code: "INTEGRITY_CONTEXT_INPUT_INVALID" });
      const paths = [...new Set((values || []).map((item) => safeRelative(root, item).relativePath))].sort();
      if (paths.length > 200) throw Object.assign(new Error(`${label} excede el límite acotado.`), { code: "INTEGRITY_CONTEXT_INPUT_TOO_LARGE" });
      return paths;
    };
    const requestedPaths = normalizePaths(input.requestedPaths, "requestedPaths");
    const changedPaths = normalizePaths(input.changedPaths, "changedPaths");
    const query = String(input.query || "").normalize("NFKC").slice(0, 2000).toLowerCase();
    const queryTokens = [...new Set(query.match(/[\p{L}\p{N}_-]{2,}/gu) || [])].slice(0, 12);
    const rows = new Map();
    const columns = "relative_path,size_bytes,modified_ms,sha256,hash_state,kind,scan_id,updated_at";
    const add = (row, reason, score) => {
      if (!row || row.scan_id !== scan.scan_id) return;
      const current = rows.get(row.relative_path) || { ...row, selectionReasons: [], score: 0 };
      if (!current.selectionReasons.includes(reason)) current.selectionReasons.push(reason);
      current.score = Math.max(current.score, score);
      rows.set(row.relative_path, current);
    };
    const exact = db.prepare(`SELECT ${columns} FROM integrity_files WHERE scan_id=? AND relative_path=?`);
    for (const relativePath of requestedPaths) add(exact.get(scan.scan_id, relativePath), "EXPLICIT_FILE", 1000);
    for (const relativePath of changedPaths) add(exact.get(scan.scan_id, relativePath), "CHANGED_FILE", 950);
    if (changedPaths.length) {
      const analysis = this.impact(project, { changedPaths, maxNodes: Math.min(1000, maxCandidates) });
      for (const relativePath of analysis.affectedPaths.slice(0, maxCandidates)) {
        add(exact.get(scan.scan_id, relativePath), changedPaths.includes(relativePath) ? "CHANGED_FILE" : "DEPENDENT_OF_CHANGE", changedPaths.includes(relativePath) ? 950 : 820);
      }
    }
    const escapeLike = (value) => value.replace(/[\\%_]/g, (character) => `\\${character}`);
    const search = db.prepare(`SELECT ${columns} FROM integrity_files
      WHERE scan_id=? AND lower(relative_path) LIKE ? ESCAPE '\\'
      ORDER BY CASE kind WHEN 'MANIFEST' THEN 0 WHEN 'TEST' THEN 1 WHEN 'SOURCE' THEN 2 ELSE 3 END,relative_path LIMIT ?`);
    for (const token of queryTokens) {
      for (const row of search.all(scan.scan_id, `%${escapeLike(token)}%`, Math.min(250, maxCandidates))) {
        add(row, `QUERY_TOKEN:${token}`, 650 + Math.min(120, token.length * 5));
      }
    }
    const dependencySeeds = [...rows.keys()].slice(0, Math.min(100, maxCandidates));
    const dependencies = db.prepare(`SELECT f.${columns.split(",").join(",f.")} FROM integrity_dependencies d
      JOIN integrity_files f ON f.scan_id=d.scan_id AND f.relative_path=d.target_path
      WHERE d.scan_id=? AND d.source_path=? ORDER BY f.relative_path LIMIT 20`);
    const dependents = db.prepare(`SELECT f.${columns.split(",").join(",f.")} FROM integrity_dependencies d
      JOIN integrity_files f ON f.scan_id=d.scan_id AND f.relative_path=d.source_path
      WHERE d.scan_id=? AND d.target_path=? ORDER BY f.relative_path LIMIT 20`);
    for (const relativePath of dependencySeeds) {
      for (const row of dependencies.all(scan.scan_id, relativePath)) add(row, `DEPENDENCY_OF:${relativePath}`, 560);
      for (const row of dependents.all(scan.scan_id, relativePath)) add(row, `DEPENDENT_OF:${relativePath}`, 540);
      if (rows.size >= maxCandidates * 2) break;
    }
    const baselineLimit = Math.min(maxCandidates, 120);
    const baseline = db.prepare(`SELECT ${columns} FROM integrity_files WHERE scan_id=? AND kind IN ('MANIFEST','TEST','SOURCE')
      ORDER BY CASE kind WHEN 'MANIFEST' THEN 0 WHEN 'TEST' THEN 1 ELSE 2 END,relative_path LIMIT ?`);
    for (const row of baseline.all(scan.scan_id, baselineLimit)) {
      add(row, row.kind === "MANIFEST" ? "PROJECT_MANIFEST" : row.kind === "TEST" ? "PROJECT_TEST" : "PROJECT_SOURCE", row.kind === "MANIFEST" ? 420 : row.kind === "TEST" ? 300 : 180);
    }
    const candidates = [...rows.values()]
      .sort((left, right) => right.score - left.score || left.relative_path.localeCompare(right.relative_path))
      .slice(0, maxCandidates)
      .map((row) => ({
        path: row.relative_path, sizeBytes: Number(row.size_bytes), modifiedMs: Number(row.modified_ms),
        sha256: row.sha256 || null, hashState: row.hash_state, kind: row.kind,
        score: row.score, selectionReasons: row.selectionReasons.sort()
      }));
    const candidatePaths = new Set(candidates.map((candidate) => candidate.path));
    return {
      schema: "dorn.context-candidates/1", projectId, state: "READY", sourceScanId: scan.scan_id,
      indexedFiles: status.files, deferredHashes: status.deferredHashes, queryTokens,
      requestedPaths, missingRequestedPaths: requestedPaths.filter((relativePath) => !candidatePaths.has(relativePath)),
      changedPaths, missingChangedPaths: changedPaths.filter((relativePath) => !candidatePaths.has(relativePath)),
      dirtyPaths: [], candidates
    };
  }

  contractCandidates(project, input = {}) {
    const { projectId } = projectIdentity(project);
    const db = this.ensure(project);
    const scan = this.latestCompleted(db, projectId);
    if (!scan) return { schema: "dorn.contract-candidates/1", projectId, state: "SCAN_REQUIRED", sourceScanId: null, candidates: [], truncated: false };
    const status = this.scanStatus(project, scan.scan_id);
    if (status.dirtyFiles) {
      return { schema: "dorn.contract-candidates/1", projectId, state: "INDEX_STALE", sourceScanId: scan.scan_id, candidates: [], truncated: false, dirtyFiles: status.dirtyFiles };
    }
    const limit = Math.max(1, Math.min(5000, Number(input.limit) || 2000));
    const rows = db.prepare(`SELECT relative_path,size_bytes,modified_ms,sha256,hash_state,kind FROM integrity_files
      WHERE scan_id=? AND (
        lower(relative_path) LIKE '%.proto' OR
        lower(relative_path) LIKE '%.schema.json' OR
        lower(relative_path) LIKE '%.openapi.json' OR
        lower(relative_path) LIKE '%.swagger.json' OR
        lower(relative_path) LIKE '%.asyncapi.json' OR
        lower(relative_path) LIKE '%/openapi.json' OR lower(relative_path)='openapi.json' OR
        lower(relative_path) LIKE '%/swagger.json' OR lower(relative_path)='swagger.json' OR
        lower(relative_path) LIKE '%/asyncapi.json' OR lower(relative_path)='asyncapi.json' OR
        lower(relative_path) LIKE '%/openapi.yaml' OR lower(relative_path)='openapi.yaml' OR
        lower(relative_path) LIKE '%/openapi.yml' OR lower(relative_path)='openapi.yml' OR
        lower(relative_path) LIKE '%/swagger.yaml' OR lower(relative_path)='swagger.yaml' OR
        lower(relative_path) LIKE '%/swagger.yml' OR lower(relative_path)='swagger.yml' OR
        lower(relative_path)='dorn.contracts.json'
      )
      ORDER BY relative_path LIMIT ?`).all(scan.scan_id, limit + 1);
    return {
      schema: "dorn.contract-candidates/1", projectId, state: "READY", sourceScanId: scan.scan_id,
      indexedFiles: status.files, candidates: rows.slice(0, limit).map((row) => ({
        path: row.relative_path, sizeBytes: Number(row.size_bytes), modifiedMs: Number(row.modified_ms),
        sha256: row.sha256 || null, hashState: row.hash_state, kind: row.kind,
        role: row.relative_path.toLowerCase() === "dorn.contracts.json" ? "MAPPING" : "CONTRACT"
      })),
      truncated: rows.length > limit, limit
    };
  }

  impact(project, input = {}) {
    const { projectId, root } = projectIdentity(project);
    const db = this.ensure(project);
    const scan = this.latestCompleted(db, projectId);
    if (!scan) return { schema: "dorn.change-impact/1", projectId, state: "SCAN_REQUIRED", changedPaths: [], affectedPaths: [], tests: [], risk: { score: 100, level: "CRITICAL", reasons: ["No existe un escaneo de integridad completo."] }, verificationPlan: [] };
    const changedPaths = [...new Set((input.changedPaths || []).map((item) => safeRelative(root, item).relativePath))].sort();
    if (!changedPaths.length) throw new Error("Predictive Change Impact necesita al menos un archivo cambiado.");
    const maxNodes = Math.max(10, Math.min(2000, Number(input.maxNodes) || 500));
    const queue = [...changedPaths];
    const affected = new Set(changedPaths);
    let truncated = false;
    while (queue.length) {
      const target = queue.shift();
      const remaining = Math.max(1, maxNodes - affected.size + 1);
      const dependents = db.prepare("SELECT source_path FROM integrity_dependencies WHERE scan_id=? AND target_path=? ORDER BY source_path LIMIT ?").all(scan.scan_id, target, remaining);
      for (const row of dependents) {
        if (affected.has(row.source_path)) continue;
        if (affected.size >= maxNodes) { truncated = true; break; }
        affected.add(row.source_path);
        queue.push(row.source_path);
      }
      if (truncated) break;
    }
    const affectedPaths = [...affected].sort();
    let tests = affectedPaths.filter((item) => pathKind(item) === "TEST");
    if (!tests.length) {
      tests = db.prepare("SELECT relative_path FROM integrity_files WHERE scan_id=? AND kind='TEST' ORDER BY relative_path LIMIT 25").all(scan.scan_id).map((row) => row.relative_path);
    }
    const changedKinds = changedPaths.map((item) => ({ path: item, kind: pathKind(item) }));
    const manifestChange = changedKinds.some((item) => item.kind === "MANIFEST");
    const visualChange = changedPaths.some((item) => /(^|\/)(?:ui|views?|components?|renderer|assets?)(\/|$)|\.(?:css|scss|html|svg|png|jpe?g|webp)$/i.test(item));
    const runtimeChange = changedPaths.some((item) => /(^|\/)(?:runtime|game|engine|server|electron|main|android|firmware)(\/|$)|project\.godot$/i.test(item));
    const status = this.scanStatus(project, scan.scan_id);
    const reasons = [];
    let score = Math.min(25, changedPaths.length * 5) + Math.min(35, Math.max(0, affectedPaths.length - changedPaths.length) * 2);
    if (manifestChange) { score += 20; reasons.push("Cambió un manifiesto, lock o configuración de build."); }
    if (visualChange) { score += 10; reasons.push("El cambio alcanza una superficie visual."); }
    if (runtimeChange) { score += 10; reasons.push("El cambio alcanza ejecución o runtime."); }
    if (truncated) { score += 20; reasons.push("El grafo de impacto superó el límite de análisis."); }
    if (status.dirtyFiles) { score += 15; reasons.push("Existen cambios externos todavía no reindexados."); }
    if (status.deferredHashes) { score += 5; reasons.push("Hay archivos grandes con hash diferido."); }
    score = Math.min(100, score);
    if (!reasons.length) reasons.push("Impacto acotado por el grafo de dependencias local.");
    const gates = [
      { gate: "STATIC_INTEGRITY", required: true, targets: changedPaths },
      { gate: "TARGETED_TESTS", required: true, targets: tests },
      { gate: "BUILD", required: manifestChange || runtimeChange, targets: changedPaths },
      { gate: "RUNTIME", required: runtimeChange, targets: affectedPaths.slice(0, 100) },
      { gate: "VISUAL", required: visualChange, targets: affectedPaths.filter((item) => /\.(?:css|scss|html|svg|png|jpe?g|webp|js|ts|tsx|jsx)$/i.test(item)).slice(0, 100) }
    ];
    const evidence = this.evidenceCore?.status(project, { limit: 1000 }).entries || [];
    const verified = evidence.filter((entry) => ["VERIFIED", "TESTED"].includes(entry.truthState));
    const gateState = (gate) => {
      if (!gate.required) return "NOT_REQUIRED";
      if (gate.gate === "STATIC_INTEGRITY") return status.state === "COMPLETED" && !status.dirtyFiles ? "SATISFIED" : "REQUIRED";
      const expectedType = gate.gate === "TARGETED_TESTS" ? /TEST/ : gate.gate === "BUILD" ? /BUILD|RELEASE/ : gate.gate === "RUNTIME" ? /RUNTIME/ : /VISUAL|SCREENSHOT/;
      return verified.some((entry) => {
        if (!expectedType.test(String(entry.evidenceType || ""))) return false;
        if (!gate.targets.length) return true;
        const covered = new Set([...(entry.sourceFiles || []), ...(entry.details?.files || []), ...(entry.artifactRefs || []).map((item) => item.relativePath)].map(String));
        return gate.targets.some((target) => covered.has(target));
      }) ? "SATISFIED" : "REQUIRED";
    };
    const verificationPlan = gates.map((gate) => ({ ...gate, state: gateState(gate) }));
    return {
      schema: "dorn.change-impact/1", projectId, state: "ANALYZED", sourceScanId: scan.scan_id,
      changedPaths, affectedPaths, tests, truncated,
      risk: { score, level: riskLevel(score), reasons },
      verificationPlan, generatedAt: timestamp()
    };
  }

  closeAll() {
    for (const scanId of [...this.directoryHandles.keys()]) this.closeDirectoryHandle(scanId);
    for (const db of this.databases.values()) { try { db.close(); } catch {} }
    this.databases.clear();
    this.databaseOwners.clear();
  }

  closeDirectoryHandle(scanId) {
    const active = this.directoryHandles.get(String(scanId));
    if (!active) return false;
    try { active.directory.closeSync(); } catch {}
    this.directoryHandles.delete(String(scanId));
    return true;
  }
}

module.exports = {
  ProjectIntegrityEngine, IGNORED_DIRECTORIES, MANIFEST_NAMES, MAX_INLINE_HASH_BYTES,
  safeRelative, digestFile, parseLocalDependencies, pathKind
};
