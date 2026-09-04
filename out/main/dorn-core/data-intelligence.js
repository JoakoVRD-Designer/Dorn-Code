"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync, backup: sqliteBackup } = require("node:sqlite");
const { atomicJson } = require("../dorn-suite/common");
const { projectIdentity } = require("./job-runtime");
const { containsSecret } = require("./policy-engine");

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MIGRATION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const FORBIDDEN_SQL = /\b(?:ATTACH|DETACH|VACUUM|load_extension|PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|REINDEX|ANALYZE)\b/i;
const FORBIDDEN_DESTRUCTIVE_SQL = /^\s*(?:DROP|TRUNCATE|REPLACE)\b|\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b|^\s*DELETE\b/i;
const ALLOWED_MIGRATION_SQL = /^\s*(?:CREATE\s+(?:TABLE|UNIQUE\s+INDEX|INDEX)|ALTER\s+TABLE|INSERT\s+INTO|UPDATE)\b/i;
const MAX_TABLES = 500;
const MAX_STATEMENTS = 250;
const MAX_CHECKS = 100;
const MAX_FIXTURES = 100;
const MAX_QUERY_COLUMNS = 100;
const HASH_CHUNK_BYTES = 1024 * 1024;

function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function codedError(message, code, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function assertNoSecret(value, label) {
  const json = JSON.stringify(value);
  if (containsSecret(json)) throw codedError(`${label} contiene una credencial.`, "DATA_SECRET_INLINE");
}
function readRecoverable(filePath, fallback) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) return structuredClone(fallback);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { return structuredClone(fallback); }
}
function atomicWrite(filePath, value) { atomicJson(filePath, value); }
function checkedIdentifier(value) { const text = String(value || ""); if (!IDENTIFIER.test(text)) throw codedError("Identificador SQL no permitido.", "DATA_SQL_IDENTIFIER_INVALID"); return `"${text}"`; }
function normalizedRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.length > 1000 || normalized.split("/").some((part) => part === ".." || part === "." || !part)) throw codedError("Ruta de datos insegura.", "DATA_PATH_INVALID");
  return normalized;
}
function fileHash(filePath) {
  const hash = crypto.createHash("sha256");
  const before = fs.lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink()) throw codedError("El archivo a hashear no es regular.", "DATA_SOURCE_INVALID");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw codedError("El archivo cambió antes del hash.", "DATA_SOURCE_RACE");
    for (;;) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
    const after = fs.fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw codedError("El archivo cambió durante el hash.", "DATA_SOURCE_RACE");
    return hash.digest("hex");
  } finally { fs.closeSync(descriptor); }
}
function liveDatabaseHash(filePath) {
  const mainHash = fileHash(filePath);
  const walPath = `${filePath}-wal`;
  if (!fs.existsSync(walPath) || fs.statSync(walPath).size === 0) return mainHash;
  return digest(`main:${mainHash}|wal:${fileHash(walPath)}`);
}
function swapDatabaseFile(destination, replacement, expectedHash) {
  const previous = `${destination}.previous-${crypto.randomBytes(5).toString("hex")}`;
  const movedSidecars = [];
  try {
    fs.renameSync(destination, previous);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${destination}${suffix}`;
      if (!fs.existsSync(sidecar)) continue;
      const moved = `${previous}${suffix}`;
      fs.renameSync(sidecar, moved);
      movedSidecars.push([sidecar, moved]);
    }
    fs.renameSync(replacement, destination);
  } catch (error) {
    try { if (!fs.existsSync(destination) && fs.existsSync(previous)) fs.renameSync(previous, destination); } catch {}
    for (const [sidecar, moved] of movedSidecars) { try { if (!fs.existsSync(sidecar) && fs.existsSync(moved)) fs.renameSync(moved, sidecar); } catch {} }
    try { fs.unlinkSync(replacement); } catch {}
    throw error;
  }
  const appliedHash = fileHash(destination);
  if (appliedHash !== expectedHash) {
    try { fs.unlinkSync(destination); fs.renameSync(previous, destination); } catch {}
    for (const [sidecar, moved] of movedSidecars) { try { fs.renameSync(moved, sidecar); } catch {} }
    throw codedError("Los bytes instalados no coinciden con la revisión verificada.", "DATA_REPLACEMENT_BYTES_MISMATCH");
  }
  try { fs.unlinkSync(previous); } catch {}
  for (const [, moved] of movedSidecars) { try { fs.unlinkSync(moved); } catch {} }
  return appliedHash;
}
function safeSqliteFile(filePath) {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch { throw codedError("La base SQLite no existe.", "DATA_SOURCE_MISSING"); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw codedError("La base debe ser un archivo regular, no un enlace.", "DATA_SOURCE_INVALID");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const header = Buffer.alloc(16);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw codedError("La base cambió durante su inspección.", "DATA_SOURCE_RACE");
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally { fs.closeSync(descriptor); }
  if (stat.size < 100 || header.toString("utf8") !== "SQLite format 3\u0000") throw codedError("El archivo no es una base SQLite válida.", "DATA_SOURCE_CORRUPT");
  return stat;
}

function stripSqlCommentsAndCount(sql) {
  let output = "", state = "normal", statements = 0, hasContent = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index], next = sql[index + 1];
    if (state === "line") { if (character === "\n") { state = "normal"; output += "\n"; } continue; }
    if (state === "block") { if (character === "*" && next === "/") { state = "normal"; index += 1; output += " "; } continue; }
    if (state === "single") { output += character; if (character === "'" && next === "'") { output += next; index += 1; } else if (character === "'") state = "normal"; continue; }
    if (state === "double") { output += character; if (character === '"' && next === '"') { output += next; index += 1; } else if (character === '"') state = "normal"; continue; }
    if (state === "bracket") { output += character; if (character === "]") state = "normal"; continue; }
    if (character === "-" && next === "-") { state = "line"; index += 1; output += " "; continue; }
    if (character === "/" && next === "*") { state = "block"; index += 1; output += " "; continue; }
    if (character === "'") { state = "single"; output += character; hasContent = true; continue; }
    if (character === '"') { state = "double"; output += character; hasContent = true; continue; }
    if (character === "[") { state = "bracket"; output += character; hasContent = true; continue; }
    if (character === ";") { if (hasContent) { statements += 1; hasContent = false; } output += character; continue; }
    if (!/\s/.test(character)) hasContent = true;
    output += character;
  }
  if (state !== "normal" && state !== "line") throw codedError("La sentencia SQL contiene comillas o comentarios sin cerrar.", "DATA_MIGRATION_SQL_INVALID");
  if (hasContent) statements += 1;
  return { sql: output.trim(), statements };
}

function migrationTables(sql) {
  const output = new Set();
  const patterns = [
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?([A-Za-z_]\w*)/ig,
    /\bALTER\s+TABLE\s+["`\[]?([A-Za-z_]\w*)/ig,
    /\bINSERT\s+INTO\s+["`\[]?([A-Za-z_]\w*)/ig,
    /\bUPDATE\s+["`\[]?([A-Za-z_]\w*)/ig,
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?[A-Za-z_]\w*["`\]]?\s+ON\s+["`\[]?([A-Za-z_]\w*)/ig
  ];
  for (const pattern of patterns) for (const match of sql.matchAll(pattern)) output.add(match[1]);
  return [...output].sort();
}

function selectReferencesTable(sql, tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:FROM|JOIN)\\s+["\\x60\\[]?${escaped}(?:["\\x60\\]]|\\b)`, "i").test(sql);
}
function limitedArray(value, limit, code, label) {
  if (!Array.isArray(value)) return [];
  if (value.length > limit) throw codedError(`${label} supera el límite seguro de ${limit}.`, code);
  return value;
}
function normalizedParams(value) {
  const params = Array.isArray(value) ? value : [];
  if (params.length > 100) throw codedError("Un check excede 100 parámetros.", "DATA_CHECK_PARAMS_LIMIT");
  return params.map((entry) => {
    if (["string", "number", "bigint"].includes(typeof entry) || entry === null || Buffer.isBuffer(entry)) return entry;
    throw codedError("Parámetro SQL no permitido.", "DATA_CHECK_PARAM_INVALID");
  });
}
function normalizedScalar(value) {
  if (typeof value === "bigint") return { type: "bigint", value: String(value) };
  if (Buffer.isBuffer(value)) return { type: "blob", sha256: digest(value), bytes: value.length };
  if (value && typeof value === "object") return { type: "object", sha256: digest(JSON.stringify(value)) };
  return { type: value === null ? "null" : typeof value, value };
}
function durableCheckResult(name, passed, actual, expected) {
  const normalizedActual = normalizedScalar(actual);
  const normalizedExpected = normalizedScalar(expected);
  return {
    name: String(name || "check").slice(0, 200), passed,
    actualType: normalizedActual.type, actualDigest: digest(JSON.stringify(normalizedActual)),
    expectedType: normalizedExpected.type, expectedDigest: digest(JSON.stringify(normalizedExpected))
  };
}

function destructiveDelta(before, after) {
  const previous = new Map((before.tables || []).map((table) => [table.name, table]));
  const current = new Map((after.tables || []).map((table) => [table.name, table]));
  const reasons = [];
  for (const [name, oldTable] of previous) {
    const newTable = current.get(name);
    if (!newTable) { reasons.push({ type: "TABLE_REMOVED", table: name }); continue; }
    if (newTable.rowCount < oldTable.rowCount) reasons.push({ type: "ROW_COUNT_DECREASED", table: name, from: oldTable.rowCount, to: newTable.rowCount });
    const newColumns = new Set((newTable.columns || []).map((column) => column.name));
    for (const column of oldTable.columns || []) if (!newColumns.has(column.name)) reasons.push({ type: "COLUMN_REMOVED", table: name, column: column.name });
    const newIndexes = new Set((newTable.indexes || []).map((index) => index.name));
    for (const index of oldTable.indexes || []) if (index.origin !== "pk" && !newIndexes.has(index.name)) reasons.push({ type: "INDEX_REMOVED", table: name, index: index.name });
  }
  return { destructive: reasons.length > 0, reasons };
}

class DataIntelligence {
  constructor(options = {}) {
    const identity = projectIdentity(options.project, options.projectCore);
    this.projectRoot = identity.root;
    this.projectId = identity.projectId;
    this.project = identity.project;
    this.projectCore = options.projectCore;
    this.evidenceCore = options.evidenceCore || null;
    this.eventBus = options.eventBus || null;
    this.root = path.join(identity.tasksRoot, "data-intelligence");
    this.migrationsRoot = path.join(this.root, "migrations");
    for (const directory of [this.root, this.migrationsRoot]) {
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
      const stat = fs.lstatSync(directory);
      const expectedParent = directory === this.root ? identity.tasksRoot : this.root;
      if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(directory)) !== fs.realpathSync(expectedParent)) throw codedError("Los metadatos de Data Intelligence no son seguros.", "DATA_METADATA_UNSAFE");
    }
  }
  projectRoot; projectId; project; projectCore; evidenceCore; eventBus; root; migrationsRoot;

  cleanupTransientSnapshots(options = {}) {
    const snapshotsRoot = path.join(this.root, "snapshots");
    if (!fs.existsSync(snapshotsRoot)) return { removed: 0 };
    const maxAgeMs = Math.max(60 * 1000, Number(options.maxAgeMs) || 60 * 60 * 1000);
    const keep = Math.max(0, Math.min(20, Number(options.keep) || 4));
    const files = fs.readdirSync(snapshotsRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
      .map((entry) => ({ path: path.join(snapshotsRoot, entry.name), mtimeMs: fs.lstatSync(path.join(snapshotsRoot, entry.name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    let removed = 0;
    for (const entry of files.slice(keep)) {
      if (Date.now() - entry.mtimeMs < maxAgeMs) continue;
      try { fs.unlinkSync(entry.path); removed += 1; } catch {}
    }
    return { removed, reason: "EXPLICIT_TRANSIENT_SNAPSHOT_RETENTION" };
  }

  resolve(relativePath) {
    const normalized = normalizedRelativePath(relativePath);
    const absolute = path.resolve(this.projectRoot, ...normalized.split("/"));
    if (!absolute.startsWith(`${this.projectRoot}${path.sep}`)) throw codedError("Base fuera del proyecto.", "DATA_PATH_OUTSIDE_PROJECT");
    return absolute;
  }

  assertProjectFile(relativePath) {
    const filePath = this.resolve(relativePath);
    const real = fs.realpathSync(filePath);
    if (!real.startsWith(`${this.projectRoot}${path.sep}`)) throw codedError("La base sale del proyecto por un enlace.", "DATA_PATH_OUTSIDE_PROJECT");
    safeSqliteFile(filePath);
    return filePath;
  }

  manifestPath(migrationTestId) {
    const id = String(migrationTestId || "");
    if (!MIGRATION_ID.test(id)) throw codedError("Identificador de migration inválido.", "DATA_MIGRATION_ID_INVALID");
    return path.join(this.migrationsRoot, `${id}.json`);
  }

  writeManifest(manifest) {
    const durable = { ...manifest, updatedAt: new Date().toISOString() };
    assertNoSecret(durable, "Manifest de Data Intelligence");
    atomicWrite(this.manifestPath(durable.migrationTestId), durable);
    return structuredClone(durable);
  }

  getMigrationTest(migrationTestId) {
    const filePath = this.manifestPath(migrationTestId);
    if (!fs.existsSync(filePath)) throw codedError("La prueba de migration no existe.", "DATA_MIGRATION_TEST_NOT_FOUND");
    const value = readRecoverable(filePath, null);
    if (!value) throw codedError("El manifest de migration está dañado; DORN lo rechazó sin sobrescribirlo.", "DATA_MIGRATION_MANIFEST_CORRUPT");
    if (value.projectId !== this.projectId) throw codedError("La migration pertenece a otro proyecto.", "DATA_PROJECT_ISOLATION_VIOLATION");
    if (value.migrationTestId !== String(migrationTestId)) throw codedError("El manifest no coincide con su identidad durable.", "DATA_MIGRATION_MANIFEST_INVALID");
    return value;
  }

  attachEvidence(migrationTestId, evidenceId) {
    const tested = this.getMigrationTest(migrationTestId);
    if (!this.evidenceCore) throw codedError("Evidence Core no está disponible.", "DATA_EVIDENCE_UNAVAILABLE");
    const id = String(evidenceId || "").trim();
    if (!id) throw codedError("La migration necesita Evidence explícita.", "DATA_EVIDENCE_REQUIRED");
    const evidence = this.evidenceCore.evaluate(this.project, id);
    if (evidence.truthState !== "VERIFIED" || evidence.result !== "PASSED" || Number(evidence.exitCode) !== 0) throw codedError("La Evidence de migration no está VERIFIED.", "DATA_EVIDENCE_NOT_VERIFIED");
    if (evidence.details?.migrationTestId !== tested.migrationTestId || evidence.details?.migratedHash !== tested.migratedHash) throw codedError("La Evidence no corresponde a esta copia migrada.", "DATA_EVIDENCE_SCOPE_MISMATCH");
    return this.writeManifest({ ...tested, evidenceId: id, evidenceSnapshot: { truthState: evidence.truthState, sourceHash: evidence.sourceHash, migratedHash: tested.migratedHash } });
  }

  listMigrationTests(options = {}) {
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
    if (!fs.existsSync(this.migrationsRoot)) return [];
    return fs.readdirSync(this.migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && MIGRATION_ID.test(entry.name.replace(/\.json$/, "")) && entry.name.endsWith(".json"))
      .map((entry) => readRecoverable(path.join(this.migrationsRoot, entry.name), null))
      .filter((entry) => entry && entry.projectId === this.projectId)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .slice(0, limit)
      .map((entry) => ({
        migrationTestId: entry.migrationTestId, relativePath: entry.relativePath, state: entry.state,
        readiness: entry.readiness, passed: entry.passed, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
        sourceSnapshotHash: entry.sourceSnapshotHash, migratedHash: entry.migratedHash || null,
        appliedHash: entry.appliedHash || null, evidenceId: entry.evidenceId || null
      }));
  }

  status() {
    const recent = this.listMigrationTests({ limit: 25 });
    return {
      schema: "dorn.data-intelligence-status/2", projectId: this.projectId,
      state: "FOUNDATION", loading: "LAZY_BOUNDED", recent,
      counts: recent.reduce((result, item) => { result[item.state] = (result[item.state] || 0) + 1; return result; }, {})
    };
  }

  schema(relativePath) {
    const filePath = this.assertProjectFile(relativePath);
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
      const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT ?").all(MAX_TABLES + 1);
      const truncated = tables.length > MAX_TABLES;
      const bounded = tables.slice(0, MAX_TABLES);
      return {
        schema: "dorn.data-schema/2", projectId: this.projectId, relativePath: normalizedRelativePath(relativePath),
        sha256: fileHash(filePath), tableLimit: MAX_TABLES, truncated,
        tables: bounded.map((table) => ({
          name: table.name, sqlHash: digest(String(table.sql || "")),
          columns: db.prepare(`PRAGMA table_info(${checkedIdentifier(table.name)})`).all().map((column) => ({
            cid: column.cid, name: column.name, type: column.type, notnull: column.notnull, pk: column.pk,
            hasDefault: column.dflt_value !== null, defaultDigest: column.dflt_value === null ? null : digest(String(column.dflt_value))
          })),
          indexes: db.prepare(`PRAGMA index_list(${checkedIdentifier(table.name)})`).all()
        }))
      };
    } finally { db.close(); }
  }

  profileDatabase(filePath) {
    safeSqliteFile(filePath);
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
      const integrityRows = db.prepare("PRAGMA integrity_check(1)").all();
      const foreignKeyViolations = db.prepare("SELECT * FROM pragma_foreign_key_check LIMIT 101").all();
      const tableRows = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT ?").all(MAX_TABLES + 1);
      const truncated = tableRows.length > MAX_TABLES;
      const tables = tableRows.slice(0, MAX_TABLES).map((table) => {
        const columns = db.prepare(`PRAGMA table_info(${checkedIdentifier(table.name)})`).all();
        const indexes = db.prepare(`PRAGMA index_list(${checkedIdentifier(table.name)})`).all();
        const rowCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${checkedIdentifier(table.name)}`).get().count);
        return {
          name: table.name, rowCount,
          columns: columns.map((column) => ({ name: column.name, type: column.type, notnull: column.notnull, pk: column.pk })),
          indexes: indexes.map((index) => ({ name: index.name, unique: index.unique, origin: index.origin, partial: index.partial })),
          schemaHash: digest(String(table.sql || "")),
          columnsHash: digest(JSON.stringify(columns.map((column) => ({ name: column.name, type: column.type, notnull: column.notnull, pk: column.pk, dflt: column.dflt_value })))),
          indexesHash: digest(JSON.stringify(indexes.map((index) => ({ name: index.name, unique: index.unique, origin: index.origin, partial: index.partial }))))
        };
      });
      return {
        integrity: integrityRows.length === 1 && String(integrityRows[0].integrity_check).toLowerCase() === "ok" ? "OK" : "FAILED",
        integrityDigest: digest(JSON.stringify(integrityRows)),
        foreignKeyViolations: Math.min(foreignKeyViolations.length, 101), foreignKeyViolationsTruncated: foreignKeyViolations.length > 100,
        tableLimit: MAX_TABLES, tablesTruncated: truncated, tables,
        totalRows: tables.reduce((sum, table) => sum + table.rowCount, 0),
        schemaDigest: digest(JSON.stringify(tables.map((table) => ({ name: table.name, schemaHash: table.schemaHash, columnsHash: table.columnsHash, indexesHash: table.indexesHash }))))
      };
    } finally { db.close(); }
  }

  async consistentCopy(source, destination) {
    safeSqliteFile(source);
    const destinationDirectory = path.dirname(destination);
    const relativeDirectory = path.relative(this.root, destinationDirectory);
    if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory)) throw codedError("La copia de datos intenta salir del almacenamiento interno.", "DATA_INTERNAL_PATH_INVALID");
    let currentDirectory = this.root;
    for (const part of relativeDirectory.split(path.sep).filter(Boolean)) {
      currentDirectory = path.join(currentDirectory, part);
      if (!fs.existsSync(currentDirectory)) fs.mkdirSync(currentDirectory, { mode: 0o700 });
      const stat = fs.lstatSync(currentDirectory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw codedError("La ruta interna de datos contiene un enlace o archivo inseguro.", "DATA_METADATA_UNSAFE");
    }
    try { fs.unlinkSync(destination); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const db = new DatabaseSync(source, { readOnly: true });
    try { await sqliteBackup(db, destination, { rate: 100 }); }
    catch (error) { try { fs.unlinkSync(destination); } catch {} throw error; }
    finally { db.close(); }
    safeSqliteFile(destination);
    return { path: destination, size: fs.statSync(destination).size, sha256: fileHash(destination) };
  }

  async currentSnapshot(relativePath, label = "fingerprint") {
    const source = this.assertProjectFile(relativePath);
    const destination = path.join(this.root, "snapshots", `${label}.${crypto.randomUUID()}.sqlite`);
    return this.consistentCopy(source, destination);
  }

  async backup(relativePath, label = "backup") {
    const source = this.assertProjectFile(relativePath);
    const safeLabel = String(label).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "backup";
    const destination = path.join(this.root, "backups", `${path.basename(relativePath)}.${safeLabel}.${Date.now()}.${crypto.randomUUID()}.sqlite`);
    const copy = await this.consistentCopy(source, destination);
    return {
      schema: "dorn.data-backup/2", projectId: this.projectId, source: normalizedRelativePath(relativePath),
      path: copy.path, size: copy.size, sha256: copy.sha256, createdAt: new Date().toISOString(), consistent: true
    };
  }

  validateMigrationInput(input = {}) {
    const statements = limitedArray(input.statements, MAX_STATEMENTS, "DATA_MIGRATION_STATEMENT_LIMIT", "La migration").map((sql, index) => {
      const raw = String(sql || "").trim();
      if (!raw || raw.length > 100000) throw codedError(`La sentencia ${index + 1} está vacía o excede el límite.`, "DATA_MIGRATION_SQL_DENIED");
      const parsed = stripSqlCommentsAndCount(raw);
      if (parsed.statements !== 1 || FORBIDDEN_SQL.test(parsed.sql) || FORBIDDEN_DESTRUCTIVE_SQL.test(parsed.sql) || !ALLOWED_MIGRATION_SQL.test(parsed.sql)) throw codedError(`La sentencia ${index + 1} contiene varias operaciones, control transaccional o una operación destructiva/no permitida.`, "DATA_MIGRATION_SQL_DENIED");
      const tables = migrationTables(parsed.sql);
      if (!tables.length) throw codedError(`La sentencia ${index + 1} no declara una tabla afectada verificable.`, "DATA_MIGRATION_TABLE_UNKNOWN");
      const kind = parsed.sql.match(/^\s*([A-Za-z]+)/i)?.[1]?.toUpperCase() || "UNKNOWN";
      return { sql: parsed.sql.replace(/;\s*$/, ""), digest: digest(parsed.sql), tables, kind };
    });
    if (!statements.length) throw codedError("La migration no contiene sentencias.", "DATA_MIGRATION_EMPTY");
    const checks = limitedArray(input.checks, MAX_CHECKS, "DATA_MIGRATION_CHECK_LIMIT", "Los checks").map((check, index) => {
      const parsed = stripSqlCommentsAndCount(String(check?.sql || "").trim());
      const table = String(check?.table || "");
      checkedIdentifier(table);
      if (parsed.statements !== 1 || !/^SELECT\b/i.test(parsed.sql) || parsed.sql.length > 20000 || FORBIDDEN_SQL.test(parsed.sql) || !selectReferencesTable(parsed.sql, table) || !Object.hasOwn(check, "equals")) throw codedError(`El check ${index + 1} debe ser un SELECT único, referenciar su tabla y declarar equals.`, "DATA_MIGRATION_CHECK_INVALID");
      return { name: String(check.name || `check-${index + 1}`).slice(0, 200), table, sql: parsed.sql.replace(/;\s*$/, ""), params: normalizedParams(check.params), column: check.column === undefined || check.column === null ? null : String(check.column), hasExpected: true, equals: check.equals, expected: check.equals };
    });
    const fixtures = limitedArray(input.fixtures, MAX_FIXTURES, "DATA_MIGRATION_FIXTURE_LIMIT", "Los fixtures").map((fixture, index) => {
      const parsed = stripSqlCommentsAndCount(String(fixture?.sql || "").trim());
      const table = String(fixture?.table || "");
      checkedIdentifier(table);
      const expectedCount = fixture.expectedCount === undefined ? null : Number(fixture.expectedCount);
      const expectedDigest = fixture.expectedDigest === undefined || fixture.expectedDigest === null || fixture.expectedDigest === "" ? null : String(fixture.expectedDigest).toLowerCase();
      const countInvalid = expectedCount !== null && (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || expectedCount > 100);
      const digestInvalid = expectedDigest !== null && !/^[0-9a-f]{64}$/.test(expectedDigest);
      if (parsed.statements !== 1 || !/^SELECT\b/i.test(parsed.sql) || parsed.sql.length > 20000 || FORBIDDEN_SQL.test(parsed.sql) || !selectReferencesTable(parsed.sql, table) || (expectedCount === null && expectedDigest === null) || countInvalid || digestInvalid) throw codedError(`El fixture ${index + 1} debe ser un SELECT único, referenciar su tabla y declarar expectedCount (0-100) o expectedDigest SHA-256.`, "DATA_MIGRATION_FIXTURE_INVALID");
      return {
        name: String(fixture.name || `fixture-${index + 1}`).slice(0, 200), table, sql: parsed.sql.replace(/;\s*$/, ""), params: normalizedParams(fixture.params),
        expectedCount, expectedDigest
      };
    });
    const affectedTables = [...new Set(statements.flatMap((statement) => statement.tables))].sort();
    const coveredTables = new Set([...checks.map((check) => check.table), ...fixtures.map((fixture) => fixture.table)]);
    const uncoveredTables = affectedTables.filter((table) => !coveredTables.has(table));
    if (uncoveredTables.length) throw codedError("Cada tabla afectada necesita al menos un check o fixture representativo.", "DATA_MIGRATION_COVERAGE_REQUIRED", { uncoveredTables });
    const digestFixtureTables = new Set(fixtures.filter((fixture) => fixture.expectedDigest).map((fixture) => fixture.table));
    const updateTables = [...new Set(statements.filter((statement) => statement.kind === "UPDATE").flatMap((statement) => statement.tables))].filter((table) => !digestFixtureTables.has(table));
    if (updateTables.length) throw codedError("Toda transformación UPDATE necesita un fixture representativo con expectedDigest.", "DATA_MIGRATION_FIXTURE_REQUIRED", { uncoveredTables: updateTables });
    return { statements, checks, fixtures, affectedTables };
  }

  executeRepresentativeChecks(db, input) {
    const checks = [];
    const fixtures = [];
    for (const check of input.checks) {
      const row = db.prepare(check.sql).get(...check.params);
      const actual = check.column === null ? row : row?.[check.column];
      const passed = check.hasExpected ? Object.is(actual, check.expected) : Boolean(actual);
      checks.push(durableCheckResult(check.name, passed, actual, check.hasExpected ? check.expected : true));
      if (!passed) throw codedError(`Check de migration falló: ${check.name}`, "DATA_MIGRATION_CHECK_FAILED");
    }
    for (const fixture of input.fixtures) {
      const rows = db.prepare(`SELECT * FROM (${fixture.sql}) LIMIT 101`).all(...fixture.params);
      const truncated = rows.length > 100;
      const bounded = rows.slice(0, 100);
      const fixtureDigest = digest(JSON.stringify(bounded, (_key, value) => typeof value === "bigint" ? String(value) : Buffer.isBuffer(value) ? { blob: digest(value), bytes: value.length } : value));
      const countPassed = fixture.expectedCount === null || bounded.length === fixture.expectedCount;
      const digestPassed = fixture.expectedDigest === null || fixtureDigest === fixture.expectedDigest;
      const passed = !truncated && countPassed && digestPassed;
      fixtures.push({ name: fixture.name, passed, rowCount: bounded.length, truncated, digest: fixtureDigest, expectedCount: fixture.expectedCount, expectedDigest: fixture.expectedDigest });
      if (!passed) throw codedError(`Fixture representativo falló: ${fixture.name}`, "DATA_MIGRATION_FIXTURE_FAILED");
    }
    return { checks, fixtures };
  }

  async testMigration(relativePath, input = {}) {
    const normalizedPath = normalizedRelativePath(relativePath);
    const source = this.assertProjectFile(normalizedPath);
    const validated = this.validateMigrationInput(input);
    const migrationTestId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const working = path.join(this.root, "migration-tests", `${migrationTestId}.sqlite`);
    const sourceSnapshot = await this.consistentCopy(source, working);
    const before = this.profileDatabase(working);
    let passed = false;
    let representative = { checks: [], fixtures: [] };
    let error = null;
    const db = new DatabaseSync(working);
    try {
      db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
      for (const statement of validated.statements) db.exec(statement.sql);
      representative = this.executeRepresentativeChecks(db, validated);
      const fkViolations = db.prepare("SELECT * FROM pragma_foreign_key_check LIMIT 1").all();
      if (fkViolations.length) throw codedError("La migration produce violaciones de claves foráneas.", "DATA_MIGRATION_FOREIGN_KEY_FAILED");
      const integrity = db.prepare("PRAGMA integrity_check(1)").get();
      if (String(integrity.integrity_check).toLowerCase() !== "ok") throw codedError("La base migrada no supera integrity_check.", "DATA_MIGRATION_INTEGRITY_FAILED");
      db.exec("COMMIT;");
      passed = true;
    } catch (caught) {
      try { db.exec("ROLLBACK;"); } catch {}
      error = { code: caught.code || "DATA_MIGRATION_TEST_FAILED", message: String(caught.message || caught).slice(0, 1000) };
    } finally { db.close(); }
    const after = this.profileDatabase(working);
    const lossAnalysis = destructiveDelta(before, after);
    if (passed && lossAnalysis.destructive) {
      passed = false;
      error = { code: "DATA_MIGRATION_DESTRUCTIVE_CHANGE", message: "La migration elimina tablas, columnas, índices o filas y quedó bloqueada." };
    }
    const sourceFingerprint = await this.currentSnapshot(normalizedPath, "post-test-source");
    try { fs.unlinkSync(sourceFingerprint.path); } catch {}
    const sourceUnchanged = sourceFingerprint.sha256 === sourceSnapshot.sha256;
    if (!sourceUnchanged) {
      passed = false;
      error = { code: "DATA_SOURCE_CHANGED_DURING_TEST", message: "La base cambió mientras se probaba la migration." };
    }
    const migratedHash = fileHash(working);
    const representativeVerified = passed && validated.checks.length + validated.fixtures.length > 0 && representative.checks.every((check) => check.passed) && representative.fixtures.every((fixture) => fixture.passed);
    const manifest = {
      schema: "dorn.data-migration-test/2", projectId: this.projectId, migrationTestId, relativePath: normalizedPath,
      state: passed ? "TESTED" : "FAILED", readiness: passed && representativeVerified ? "READY" : passed ? "PARTIAL_REPRESENTATIVE_DATA_REQUIRED" : "BLOCKED",
      passed, representativeVerified, sourceSnapshotHash: sourceSnapshot.sha256, sourceSize: sourceSnapshot.size,
      migratedHash, migratedSize: fs.statSync(working).size, workingPath: working, sourceUnchanged,
      statementDigests: validated.statements.map((statement) => statement.digest), affectedTables: validated.affectedTables,
      checks: representative.checks, fixtures: representative.fixtures,
      before, after, delta: {
        rows: after.totalRows - before.totalRows, tables: after.tables.length - before.tables.length,
        schemaChanged: after.schemaDigest !== before.schemaDigest, bytes: fs.statSync(working).size - sourceSnapshot.size
      },
      lossAnalysis, error, evidenceId: null, evidenceSnapshot: null, createdAt
    };
    const durable = this.writeManifest(manifest);
    void this.eventBus?.publish("DATA_MIGRATION_TESTED", { migrationTestId, state: durable.state, readiness: durable.readiness }, { projectId: this.projectId, idempotencyKey: `data-migration-tested:${migrationTestId}` });
    return durable;
  }

  async applyMigration(relativePath, testedOrId, options = {}) {
    const normalizedPath = normalizedRelativePath(relativePath);
    let tested = typeof testedOrId === "string" ? this.getMigrationTest(testedOrId) : testedOrId;
    if (tested?.migrationTestId) {
      const durable = this.getMigrationTest(tested.migrationTestId);
      if (durable.migratedHash !== tested.migratedHash || durable.sourceSnapshotHash !== tested.sourceSnapshotHash) throw codedError("La prueba de migration no coincide con su manifest durable.", "DATA_MIGRATION_MANIFEST_MISMATCH");
      tested = durable;
    }
    if (!tested?.passed || tested?.readiness !== "READY" || !tested?.representativeVerified) throw codedError("La migration no tiene integridad y datos representativos verificados.", "DATA_MIGRATION_REPRESENTATIVE_DATA_REQUIRED");
    if (tested.projectId !== this.projectId || tested.relativePath !== normalizedPath) throw codedError("La migration pertenece a otro proyecto o archivo.", "DATA_PROJECT_ISOLATION_VIOLATION");
    safeSqliteFile(tested.workingPath);
    if (fileHash(tested.workingPath) !== tested.migratedHash) throw codedError("La copia probada fue alterada o dañada.", "DATA_MIGRATION_WORKING_COPY_CHANGED");
    const destination = this.assertProjectFile(normalizedPath);
    if (["APPLIED", "APPLYING"].includes(tested.state) && liveDatabaseHash(destination) === tested.migratedHash) {
      if (tested.state === "APPLYING") tested = this.writeManifest({ ...tested, state: "APPLIED", appliedHash: tested.migratedHash, appliedAt: new Date().toISOString(), recoveredAfterReplacement: true });
      return { schema: "dorn.data-migration/2", applied: true, idempotent: true, state: "ALREADY_APPLIED", migrationTestId: tested.migrationTestId, relativePath: normalizedPath, sha256: tested.migratedHash, backup: tested.backup, rollback: tested.rollback };
    }
    if (!tested.evidenceId || !tested.evidenceSnapshot || !this.evidenceCore) throw codedError("La migration necesita Evidence VERIFIED ligada a la copia migrada.", "DATA_EVIDENCE_REQUIRED");
    const currentEvidence = this.evidenceCore.evaluate(this.project, tested.evidenceId);
    if (currentEvidence.truthState !== "VERIFIED" || currentEvidence.sourceHash !== tested.evidenceSnapshot.sourceHash || currentEvidence.details?.migrationTestId !== tested.migrationTestId || currentEvidence.details?.migratedHash !== tested.migratedHash) throw codedError("La Evidence de migration cambió o no corresponde a los mismos bytes.", "DATA_EVIDENCE_NEEDS_RETEST");
    const current = await this.currentSnapshot(normalizedPath, "pre-apply-current");
    try {
      if (current.sha256 !== tested.sourceSnapshotHash) throw codedError("La base cambió desde la prueba de migration.", "MIGRATION_STALE_OR_UNTESTED");
    } finally { try { fs.unlinkSync(current.path); } catch {} }
    let backup = tested.state === "APPLYING" ? tested.backup : null;
    if (backup) {
      safeSqliteFile(backup.path);
      if (backup.projectId !== this.projectId || backup.source !== normalizedPath || fileHash(backup.path) !== backup.sha256) throw codedError("El backup de una aplicación interrumpida no es recuperable.", "DATA_BACKUP_CORRUPT");
    } else backup = await this.backup(normalizedPath, options.label || "pre-migration");
    const rollback = { backupPath: backup.path, backupHash: backup.sha256, expectedCurrentHash: tested.migratedHash, migrationTestId: tested.migrationTestId, projectId: this.projectId };
    tested = this.writeManifest({ ...tested, state: "APPLYING", backup, rollback, applyStartedAt: tested.applyStartedAt || new Date().toISOString() });
    const replacement = `${destination}.migration-${process.pid}-${crypto.randomBytes(5).toString("hex")}.tmp`;
    fs.copyFileSync(tested.workingPath, replacement);
    const descriptor = fs.openSync(replacement, "r+");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    const appliedHash = swapDatabaseFile(destination, replacement, tested.migratedHash);
    const updated = this.writeManifest({ ...tested, state: "APPLIED", appliedHash, backup, rollback, appliedAt: new Date().toISOString() });
    void this.eventBus?.publish("DATA_MIGRATION_APPLIED", { migrationTestId: tested.migrationTestId, state: "APPLIED", appliedHash }, { projectId: this.projectId, idempotencyKey: `data-migration-applied:${tested.migrationTestId}` });
    return { schema: "dorn.data-migration/2", applied: true, idempotent: false, state: "APPLIED", migrationTestId: tested.migrationTestId, relativePath: normalizedPath, backup, sha256: appliedHash, rollback, manifest: updated };
  }

  async migrationRecoveryStatus(relativePath, migrationTestId) {
    const normalizedPath = normalizedRelativePath(relativePath);
    const tested = this.getMigrationTest(migrationTestId);
    if (tested.relativePath !== normalizedPath) return { safe: false, reason: "La ruta no coincide con el manifest durable." };
    const destination = this.assertProjectFile(normalizedPath);
    if (["APPLIED", "APPLYING"].includes(tested.state) && liveDatabaseHash(destination) === tested.migratedHash) return { safe: true, mode: tested.state === "APPLYING" ? "FINALIZE_APPLIED" : "ALREADY_APPLIED", evidence: [tested.evidenceId].filter(Boolean) };
    const current = await this.currentSnapshot(normalizedPath, "recovery-current");
    try {
      if (["TESTED", "APPLYING"].includes(tested.state) && tested.readiness === "READY" && current.sha256 === tested.sourceSnapshotHash) return { safe: true, mode: "SAFE_RETRY_FROM_TESTED_COPY", evidence: [tested.evidenceId].filter(Boolean) };
      return { safe: false, reason: "El estado actual no coincide ni con el origen probado ni con los bytes aplicados." };
    } finally { try { fs.unlinkSync(current.path); } catch {} }
  }

  async restore(relativePath, backup, options = {}) {
    const normalizedPath = normalizedRelativePath(relativePath);
    const destination = this.assertProjectFile(normalizedPath);
    if (!backup?.path || backup.projectId !== this.projectId || backup.source !== normalizedPath) throw codedError("El backup pertenece a otro proyecto o archivo.", "DATA_PROJECT_ISOLATION_VIOLATION");
    safeSqliteFile(backup.path);
    if (fileHash(backup.path) !== backup.sha256) throw codedError("Backup inválido o dañado.", "DATA_BACKUP_CORRUPT");
    const liveHash = liveDatabaseHash(destination);
    if (liveHash === backup.sha256) {
      if (options.migrationTestId) {
        const tested = this.getMigrationTest(options.migrationTestId);
        if (tested.state !== "ROLLED_BACK") this.writeManifest({ ...tested, state: "ROLLED_BACK", rolledBackAt: new Date().toISOString(), restoredHash: liveHash });
      }
      return { schema: "dorn.data-restore/2", restored: true, idempotent: true, state: "ALREADY_RESTORED", relativePath: normalizedPath, sha256: liveHash };
    }
    if (!options.expectedCurrentHash) throw codedError("El rollback exige el hash exacto del estado que reemplazará.", "DATA_RESTORE_EXPECTED_HASH_REQUIRED");
    if (liveHash !== options.expectedCurrentHash) throw codedError("La base cambió después de crear la ruta de rollback.", "DATA_RESTORE_CONFLICT");
    let testedForRestore = null;
    if (options.migrationTestId) {
      testedForRestore = this.getMigrationTest(options.migrationTestId);
      if (testedForRestore.state !== "RESTORING") testedForRestore = this.writeManifest({ ...testedForRestore, state: "RESTORING", restoreStartedAt: new Date().toISOString() });
    }
    const replacement = `${destination}.restore-${process.pid}-${crypto.randomBytes(5).toString("hex")}.tmp`;
    fs.copyFileSync(backup.path, replacement);
    const descriptor = fs.openSync(replacement, "r+");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    const restoredHash = swapDatabaseFile(destination, replacement, backup.sha256);
    if (options.migrationTestId) {
      const tested = testedForRestore || this.getMigrationTest(options.migrationTestId);
      this.writeManifest({ ...tested, state: "ROLLED_BACK", rolledBackAt: new Date().toISOString(), restoredHash });
    }
    void this.eventBus?.publish("DATA_MIGRATION_RESTORED", { migrationTestId: options.migrationTestId || null, state: "RESTORED", restoredHash }, { projectId: this.projectId, idempotencyKey: `data-migration-restored:${options.migrationTestId || restoredHash}` });
    return { schema: "dorn.data-restore/2", restored: true, relativePath: normalizedPath, sha256: restoredHash };
  }

  restoreRecoveryStatus(relativePath, migrationTestId) {
    const normalizedPath = normalizedRelativePath(relativePath);
    const tested = this.getMigrationTest(migrationTestId);
    if (tested.relativePath !== normalizedPath || !tested.backup || !tested.rollback) return { safe: false, reason: "La migration no conserva un rollback completo para esta ruta." };
    const current = liveDatabaseHash(this.assertProjectFile(normalizedPath));
    if (current === tested.backup.sha256) return { safe: true, mode: "ALREADY_RESTORED", evidence: [tested.evidenceId].filter(Boolean) };
    if (current === tested.rollback.expectedCurrentHash) return { safe: true, mode: "SAFE_RESTORE_EXACT_REVISION", evidence: [tested.evidenceId].filter(Boolean) };
    return { safe: false, reason: "La base cambió fuera del rollback exacto registrado." };
  }

  queryPage(relativePath, input = {}) {
    const tableName = String(input.table || "");
    const keyName = String(input.key || "id");
    const table = checkedIdentifier(tableName);
    const key = checkedIdentifier(keyName);
    const limit = Math.max(1, Math.min(500, Number(input.limit) || 50));
    const requestedColumns = input.columns?.length ? limitedArray(input.columns, MAX_QUERY_COLUMNS, "DATA_QUERY_COLUMN_LIMIT", "Las columnas") : ["*"];
    const columns = requestedColumns.map((column) => column === "*" ? "*" : checkedIdentifier(column)).join(",");
    const db = new DatabaseSync(this.assertProjectFile(relativePath), { readOnly: true });
    try {
      const knownTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map((row) => String(row.name)));
      if (!knownTables.has(tableName)) throw codedError("La tabla solicitada no existe.", "DATA_QUERY_TABLE_UNKNOWN");
      const knownColumns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => String(column.name)));
      if (!knownColumns.has(keyName) || requestedColumns.some((column) => column !== "*" && !knownColumns.has(String(column)))) throw codedError("La consulta solicita una columna desconocida.", "DATA_QUERY_COLUMN_UNKNOWN");
      const cursor = input.cursor === undefined || input.cursor === null ? null : input.cursor;
      const rows = cursor === null
        ? db.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${key} LIMIT ?`).all(limit + 1)
        : db.prepare(`SELECT ${columns} FROM ${table} WHERE ${key}>? ORDER BY ${key} LIMIT ?`).all(cursor, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const automaticPrivate = [...knownColumns].filter((name) => /(?:password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|session[_-]?key)/i.test(name));
      const privateColumns = new Set([...(input.privateColumns || []).map(String), ...automaticPrivate]);
      const redacted = page.map((row) => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, privateColumns.has(name) ? "[REDACTED]" : value])));
      return { schema: "dorn.data-page/2", projectId: this.projectId, relativePath: normalizedRelativePath(relativePath), rows: redacted, limit, hasMore, nextCursor: hasMore ? page.at(-1)?.[keyName] : null };
    } finally { db.close(); }
  }
}

class DataIntelligenceManager {
  constructor(options = {}) {
    if (!options.projectCore) throw new Error("Data Intelligence Manager necesita Project Core.");
    this.projectCore = options.projectCore;
    this.evidenceCore = options.evidenceCore || null;
    this.eventBus = options.eventBus || null;
  }
  projectCore; evidenceCore; eventBus; instances = new Map(); owners = new Map();
  forProject(project) {
    const identity = projectIdentity(project, this.projectCore);
    if (this.instances.has(identity.root)) {
      if (this.owners.get(identity.root) !== identity.projectId) throw codedError("La instancia de datos pertenece a otra identidad.", "DATA_PROJECT_ISOLATION_VIOLATION");
      return this.instances.get(identity.root);
    }
    const instance = new DataIntelligence({ project: identity.project, projectCore: this.projectCore, evidenceCore: this.evidenceCore, eventBus: this.eventBus });
    this.instances.set(identity.root, instance);
    this.owners.set(identity.root, identity.projectId);
    return instance;
  }
  closeAll() { this.instances.clear(); this.owners.clear(); }
}

module.exports = {
  DataIntelligence, DataIntelligenceManager, fileHash, liveDatabaseHash, safeSqliteFile,
  stripSqlCommentsAndCount, migrationTables, destructiveDelta
};
