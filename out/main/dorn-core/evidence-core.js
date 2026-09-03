"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PROJECT_SCHEMA = "dorn.project/1";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const POSITIVE_TRUTH_STATES = new Set(["VERIFIED", "PACKAGED", "INSTALLED", "PUBLISHED"]);
const ALLOWED_TRUTH_STATES = new Set([
  "PROPOSED", "GENERATED", "INTEGRATED", "EXECUTED", "TESTED", "VERIFIED",
  "PACKAGED", "INSTALLED", "PUBLISHED", "BLOCKED", "FAILED"
]);
const ALLOWED_RESULTS = new Set(["PASSED", "FAILED", "BLOCKED", "PARTIAL", "UNKNOWN"]);

function evidenceError(code, message) {
  return Object.assign(new Error(message), { code });
}

function boundedText(value, maximum, fallback = "") {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, maximum);
}

function assertSha256(value, label) {
  const hash = String(value || "").toLowerCase();
  if (!HASH_PATTERN.test(hash)) throw evidenceError("EVIDENCE_HASH_INVALID", `${label} no es un SHA-256 válido.`);
  return hash;
}

function boundedJson(value, maximumBytes, label, fallback) {
  if (value === undefined || value === null) return fallback;
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw evidenceError("EVIDENCE_METADATA_INVALID", `${label} no es JSON serializable.`); }
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) throw evidenceError("EVIDENCE_METADATA_TOO_LARGE", `${label} excede el límite seguro.`);
  return JSON.parse(serialized);
}

function canonicalRoot(rawRoot) {
  const root = fs.realpathSync(String(rawRoot || ""));
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw evidenceError("EVIDENCE_PROJECT_INVALID", "Evidence requiere una carpeta de proyecto real.");
  return root;
}

function metadataIdentity(projectOrRoot) {
  const root = canonicalRoot(typeof projectOrRoot === "string" ? projectOrRoot : projectOrRoot?.rootPath);
  const claimedId = typeof projectOrRoot === "object" && projectOrRoot
    ? boundedText(projectOrRoot.id || projectOrRoot.projectId, 128)
    : "";
  if (claimedId && !/^[a-zA-Z0-9_-]+$/.test(claimedId)) throw evidenceError("EVIDENCE_PROJECT_ID_INVALID", "Evidence recibió una identidad de proyecto inválida.");
  const dornRoot = path.join(root, ".dorn");
  const evidenceRoot = path.join(dornRoot, "evidence");
  for (const [directory, parent, label] of [[dornRoot, root, ".dorn"], [evidenceRoot, dornRoot, ".dorn/evidence"]]) {
    if (!fs.existsSync(directory)) throw evidenceError("EVIDENCE_PROJECT_NOT_ADOPTED", `Falta ${label}; adopta el proyecto antes de registrar Evidence.`);
    const stat = fs.lstatSync(directory);
    const realParent = fs.realpathSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(directory)) !== realParent) {
      throw evidenceError("EVIDENCE_METADATA_UNSAFE", `${label} no es una carpeta de metadatos segura.`);
    }
  }
  const manifestPath = path.join(dornRoot, "project.json");
  if (!fs.existsSync(manifestPath)) throw evidenceError("EVIDENCE_PROJECT_NOT_ADOPTED", "Falta .dorn/project.json; Evidence no inventará una identidad.");
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 64 * 1024) {
    throw evidenceError("EVIDENCE_METADATA_UNSAFE", "El manifiesto de proyecto no es un archivo regular seguro.");
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
  catch { throw evidenceError("EVIDENCE_PROJECT_MANIFEST_INVALID", "El manifiesto de proyecto está dañado; Evidence no lo sobrescribió."); }
  const projectId = boundedText(manifest?.projectId, 128);
  if (manifest?.schema !== PROJECT_SCHEMA || !projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw evidenceError("EVIDENCE_PROJECT_MANIFEST_INVALID", "El manifiesto de proyecto tiene una identidad desconocida.");
  }
  if (claimedId && claimedId !== projectId) throw evidenceError("EVIDENCE_PROJECT_IDENTITY_MISMATCH", "Evidence bloqueó una identidad que no corresponde a esta carpeta.");
  return { root, dornRoot, evidenceRoot, projectId };
}

function safeRelative(root, rawPath) {
  const input = String(rawPath ?? "");
  if (path.isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input) || input.includes("\0")) {
    throw evidenceError("EVIDENCE_PATH_UNSAFE", "Evidence recibió una ruta de fuente insegura.");
  }
  const relativePath = input.replaceAll("\\", "/");
  if (!relativePath || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw evidenceError("EVIDENCE_PATH_UNSAFE", "Evidence recibió una ruta de fuente insegura.");
  }
  const absolute = path.resolve(root, ...relativePath.split("/"));
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) throw evidenceError("EVIDENCE_PATH_ESCAPE", "La fuente de Evidence sale del proyecto.");
  return { relativePath, absolute };
}

function sourceHash(root, options = {}) {
  const projectRoot = canonicalRoot(root);
  const relativePaths = [...new Set((options.relativePaths || options.files || []).map(String))].sort();
  if (relativePaths.length > 2000) throw evidenceError("EVIDENCE_SCOPE_TOO_LARGE", "Evidence recibió demasiados archivos en una sola fuente.");
  const hash = crypto.createHash("sha256");
  const sourceFiles = [];
  if (!relativePaths.length) {
    hash.update("DORN_UNSCOPED_SOURCE\0");
    return { hash: hash.digest("hex"), fileCount: 0, sourceFiles, scope: "UNSCOPED", complete: false };
  }
  let complete = true;
  for (const rawPath of relativePaths) {
    const { relativePath, absolute } = safeRelative(projectRoot, rawPath);
    sourceFiles.push(relativePath);
    hash.update(`${relativePath}\0`);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch {
      complete = false;
      hash.update("MISSING\0");
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      complete = false;
      hash.update(`${stat.isSymbolicLink() ? "SYMLINK" : "NON_FILE"}\0`);
      continue;
    }
    const real = fs.realpathSync(absolute);
    if (!real.startsWith(`${projectRoot}${path.sep}`)) {
      complete = false;
      hash.update("ESCAPE\0");
      continue;
    }
    hash.update(`${stat.size}\0`);
    const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const chunk = Buffer.allocUnsafe(512 * 1024);
    try {
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
        complete = false;
        hash.update("RACE\0");
        continue;
      }
      let bytes = 0;
      do {
        bytes = fs.readSync(descriptor, chunk, 0, chunk.length, null);
        if (bytes) hash.update(chunk.subarray(0, bytes));
      } while (bytes);
    } finally { fs.closeSync(descriptor); }
  }
  return { hash: hash.digest("hex"), fileCount: sourceFiles.length, sourceFiles, scope: "WORKING_SET", complete };
}

function imageDimensions(buffer, mime) {
  if (mime === "image/png") {
    if (buffer.length < 24) throw new Error("Screenshot PNG truncado.");
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mime === "image/webp") {
    if (buffer.length < 30 || buffer.toString("ascii", 12, 16) !== "VP8X") throw new Error("Screenshot WebP no usa un contenedor VP8X verificable.");
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    throw new Error("Screenshot JPEG sin dimensiones verificables en el encabezado.");
  }
  throw new Error("Formato de screenshot no soportado.");
}

function crc32Update(crc, buffer) {
  let value = crc >>> 0;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return value >>> 0;
}

function validatePngContainer(descriptor, size) {
  const header = Buffer.alloc(8);
  const scratch = Buffer.allocUnsafe(256 * 1024);
  let position = 8;
  let index = 0;
  let sawIdat = false;
  let sawIend = false;
  while (position < size) {
      if (size - position < 12 || fs.readSync(descriptor, header, 0, 8, position) !== 8) throw new Error("Screenshot PNG truncado entre chunks.");
      const length = header.readUInt32BE(0);
      const type = header.toString("ascii", 4, 8);
      const end = position + 12 + length;
      if (!/^[A-Za-z]{4}$/.test(type) || length > 100 * 1024 * 1024 || end > size) throw new Error("Screenshot PNG contiene un chunk inválido o truncado.");
      if (index === 0 && (type !== "IHDR" || length !== 13)) throw new Error("Screenshot PNG no comienza con IHDR válido.");
      if (type === "IDAT") sawIdat = true;
      let crc = crc32Update(0xffffffff, header.subarray(4, 8));
      let offset = 0;
      while (offset < length) {
        const count = Math.min(scratch.length, length - offset);
        const read = fs.readSync(descriptor, scratch, 0, count, position + 8 + offset);
        if (read !== count) throw new Error("Screenshot PNG truncado dentro de un chunk.");
        crc = crc32Update(crc, scratch.subarray(0, read));
        offset += read;
      }
      const expectedBuffer = Buffer.alloc(4);
      if (fs.readSync(descriptor, expectedBuffer, 0, 4, position + 8 + length) !== 4) throw new Error("Screenshot PNG no contiene CRC completo.");
      const actualCrc = (crc ^ 0xffffffff) >>> 0;
      if (actualCrc !== expectedBuffer.readUInt32BE(0)) throw new Error(`Screenshot PNG contiene CRC inválido en ${type}.`);
      position = end;
      index += 1;
      if (type === "IEND") {
        if (length !== 0 || position !== size) throw new Error("Screenshot PNG contiene bytes no válidos después de IEND.");
        sawIend = true;
        break;
      }
  }
  if (!sawIdat || !sawIend) throw new Error("Screenshot PNG no contiene una imagen completa IDAT/IEND.");
}

function validateImageContainer(descriptor, size, header, mime) {
  if (mime === "image/png") return validatePngContainer(descriptor, size);
  if (mime === "image/jpeg") {
    const tail = Buffer.alloc(2);
    if (size < 4 || fs.readSync(descriptor, tail, 0, 2, size - 2) !== 2 || tail[0] !== 0xff || tail[1] !== 0xd9) throw new Error("Screenshot JPEG no termina con EOI y puede estar truncado.");
    return;
  }
  if (mime === "image/webp") {
    const declaredSize = header.readUInt32LE(4) + 8;
    if (declaredSize !== size) throw new Error("Screenshot WebP tiene un tamaño RIFF incoherente.");
  }
}

function inspectScreenshot(root, input = {}) {
  const projectRoot = canonicalRoot(root);
  const { relativePath, absolute } = safeRelative(projectRoot, input.relativePath || input.path);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Screenshot Evidence requiere una imagen regular dentro del proyecto.");
  const real = fs.realpathSync(absolute);
  if (!real.startsWith(`${projectRoot}${path.sep}`)) throw evidenceError("EVIDENCE_PATH_ESCAPE", "El screenshot de Evidence sale del proyecto.");
  if (!stat.size || stat.size > 100 * 1024 * 1024) throw new Error("Screenshot Evidence recibió una imagen vacía o demasiado grande.");
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const header = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
  let mime;
  let dimensions;
  let sha256;
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      throw evidenceError("EVIDENCE_FILE_RACE", "El screenshot cambió mientras Evidence lo inspeccionaba.");
    }
    const read = fs.readSync(descriptor, header, 0, header.length, 0);
    const data = header.subarray(0, read);
    mime = null;
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = "image/png";
    else if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) mime = "image/jpeg";
    else if (data.length >= 16 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") mime = "image/webp";
    if (!mime) throw new Error("Screenshot Evidence rechazó bytes que no son PNG, JPEG o WebP.");
    dimensions = imageDimensions(data, mime);
    validateImageContainer(descriptor, stat.size, data, mime);
    if (!dimensions.width || !dimensions.height || dimensions.width > 32768 || dimensions.height > 32768) throw new Error("Screenshot Evidence detectó dimensiones inválidas.");
    const hash = crypto.createHash("sha256");
    const chunk = Buffer.allocUnsafe(512 * 1024);
    let position = 0;
    while (position < stat.size) {
      const wanted = Math.min(chunk.length, stat.size - position);
      const bytes = fs.readSync(descriptor, chunk, 0, wanted, position);
      if (bytes !== wanted) throw evidenceError("EVIDENCE_FILE_RACE", "El screenshot cambió mientras Evidence calculaba su hash.");
      hash.update(chunk.subarray(0, bytes));
      position += bytes;
    }
    sha256 = hash.digest("hex");
  } finally { fs.closeSync(descriptor); }
  if (input.sha256 && String(input.sha256) !== sha256) throw new Error("Screenshot Evidence no coincide con el hash declarado.");
  const captureSource = boundedText(input.source, 80, "REAL_CAPTURE").toUpperCase();
  if (!["REAL_CAPTURE", "REAL_BROWSER_CAPTURE", "REAL_PLAYWRIGHT_CAPTURE", "REAL_ELECTRON_CAPTURE", "REAL_DEVICE_CAPTURE"].includes(captureSource)) {
    throw evidenceError("EVIDENCE_CAPTURE_SOURCE_INVALID", "Screenshot Evidence exige una fuente de captura real reconocida.");
  }
  const viewport = input.viewport && typeof input.viewport === "object"
    ? { width: Math.max(1, Math.min(32768, Number(input.viewport.width) || dimensions.width)), height: Math.max(1, Math.min(32768, Number(input.viewport.height) || dimensions.height)) }
    : null;
  const requestedCaptureTime = boundedText(input.capturedAt, 64);
  const capturedAt = requestedCaptureTime && Number.isFinite(Date.parse(requestedCaptureTime)) ? new Date(requestedCaptureTime).toISOString() : new Date(stat.mtimeMs).toISOString();
  return {
    schema: "dorn.screenshot-evidence/1", relativePath, mime, sha256, bytes: stat.size,
    width: dimensions.width, height: dimensions.height,
    viewport,
    route: input.route ? boundedText(input.route, 2000) : null,
    source: captureSource, capturedAt
  };
}

function digestArtifact(root, rawPath, declaredHash = null) {
  const { relativePath, absolute } = safeRelative(root, rawPath);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw evidenceError("EVIDENCE_ARTIFACT_UNSAFE", `El artefacto ${relativePath} no es un archivo regular.`);
  const real = fs.realpathSync(absolute);
  if (!real.startsWith(`${root}${path.sep}`)) throw evidenceError("EVIDENCE_ARTIFACT_ESCAPE", `El artefacto ${relativePath} sale del proyecto.`);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const hash = crypto.createHash("sha256");
  const chunk = Buffer.allocUnsafe(512 * 1024);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      throw evidenceError("EVIDENCE_FILE_RACE", `El artefacto ${relativePath} cambió durante su inspección.`);
    }
    let bytes = 0;
    do {
      bytes = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytes) hash.update(chunk.subarray(0, bytes));
    } while (bytes);
  } finally { fs.closeSync(descriptor); }
  const sha256 = hash.digest("hex");
  if (declaredHash && assertSha256(declaredHash, `El hash de ${relativePath}`) !== sha256) {
    throw evidenceError("EVIDENCE_ARTIFACT_HASH_MISMATCH", `El artefacto ${relativePath} no coincide con el hash declarado.`);
  }
  return { relativePath, sha256, bytes: stat.size, verifiedLocalFile: true };
}

function inspectArtifactRefs(root, values) {
  if (values !== undefined && !Array.isArray(values)) throw evidenceError("EVIDENCE_ARTIFACTS_INVALID", "artifactRefs debe ser una lista.");
  if ((values || []).length > 100) throw evidenceError("EVIDENCE_ARTIFACTS_TOO_LARGE", "Evidence recibió demasiados artefactos.");
  return (values || []).map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw evidenceError("EVIDENCE_ARTIFACT_INVALID", `El artefacto ${index + 1} no tiene un contrato válido.`);
    const artifactId = boundedText(raw.artifactId || raw.id, 200);
    const relativePath = boundedText(raw.relativePath, 4096);
    if (!artifactId && !relativePath) throw evidenceError("EVIDENCE_ARTIFACT_INVALID", "Cada artefacto requiere artifactId o relativePath.");
    const inspected = relativePath ? digestArtifact(root, relativePath, raw.sha256 || null) : null;
    return {
      artifactId: artifactId || null,
      kind: boundedText(raw.kind, 100, "artifact"),
      relativePath: inspected?.relativePath || null,
      sha256: inspected?.sha256 || (raw.sha256 ? assertSha256(raw.sha256, "El hash del artefacto") : null),
      bytes: inspected?.bytes ?? (Number.isSafeInteger(Number(raw.bytes)) && Number(raw.bytes) >= 0 ? Number(raw.bytes) : null),
      verifiedLocalFile: inspected?.verifiedLocalFile === true,
      metadata: boundedJson(raw.metadata, 32 * 1024, "Los metadatos del artefacto", {})
    };
  });
}

function artifactSetHash(artifactRefs) {
  const local = artifactRefs.filter((entry) => entry.verifiedLocalFile).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (!local.length) return null;
  const hash = crypto.createHash("sha256");
  for (const entry of local) hash.update(`${entry.relativePath}\0${entry.bytes}\0${entry.sha256}\0`);
  return hash.digest("hex");
}

function safeParseObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

class EvidenceCore {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.onRecord = typeof options.onRecord === "function" ? options.onRecord : null;
  }

  eventBus;
  onRecord;
  databases = new Map();
  databaseOwners = new Map();

  databasePath(projectRoot) { return path.join(projectRoot, ".dorn", "evidence", "evidence.db"); }

  ensure(projectOrRoot) {
    const identity = metadataIdentity(projectOrRoot);
    if (this.databases.has(identity.root)) {
      if (this.databaseOwners.get(identity.root) !== identity.projectId) {
        throw evidenceError("EVIDENCE_PROJECT_IDENTITY_MISMATCH", "La base Evidence abierta pertenece a otra identidad.");
      }
      return this.databases.get(identity.root);
    }
    const databasePath = this.databasePath(identity.root);
    if (fs.existsSync(databasePath)) {
      const stat = fs.lstatSync(databasePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw evidenceError("EVIDENCE_METADATA_UNSAFE", "La base Evidence no es un archivo regular seguro.");
    }
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=3000;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS evidence_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence_entries (
          evidence_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          truth_state TEXT NOT NULL,
          result TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          source_scope TEXT NOT NULL,
          source_files_json TEXT NOT NULL DEFAULT '[]',
          evidence_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_evidence_created ON evidence_entries(created_at DESC, evidence_id DESC);
        CREATE INDEX IF NOT EXISTS idx_evidence_truth ON evidence_entries(truth_state, created_at DESC);
        CREATE TABLE IF NOT EXISTS evidence_links (
          evidence_id TEXT NOT NULL REFERENCES evidence_entries(evidence_id) ON DELETE CASCADE,
          ref_kind TEXT NOT NULL, relation TEXT NOT NULL, ref_id TEXT NOT NULL,
          label TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
          PRIMARY KEY(evidence_id,ref_kind,relation,ref_id)
        );
        CREATE INDEX IF NOT EXISTS idx_evidence_links_ref ON evidence_links(ref_kind,ref_id,created_at DESC);
      `);
      const storedOwner = db.prepare("SELECT value FROM evidence_metadata WHERE key='project_id'").get()?.value || null;
      const rowOwners = db.prepare("SELECT DISTINCT project_id FROM evidence_entries WHERE project_id IS NOT NULL").all().map((row) => String(row.project_id));
      const unknownRows = Number(db.prepare("SELECT COUNT(*) AS count FROM evidence_entries WHERE project_id IS NULL OR project_id='' ").get().count);
      if (unknownRows || (storedOwner && storedOwner !== identity.projectId) || rowOwners.some((owner) => owner !== identity.projectId)) {
        throw evidenceError("EVIDENCE_PROJECT_IDENTITY_MISMATCH", "La base Evidence contiene registros de otra identidad de proyecto.");
      }
      if (!storedOwner) db.prepare("INSERT INTO evidence_metadata(key,value) VALUES('project_id',?)").run(identity.projectId);
      this.migrateLegacy(identity, db);
    } catch (error) {
      try { db.close(); } catch {}
      throw error;
    }
    this.databases.set(identity.root, db);
    this.databaseOwners.set(identity.root, identity.projectId);
    return db;
  }

  migrateLegacy(identity, db) {
    if (db.prepare("SELECT value FROM evidence_metadata WHERE key='legacy_index_reviewed'").get()) return;
    const legacyPath = path.join(identity.evidenceRoot, "index.json");
    const reviewed = () => db.prepare("INSERT OR REPLACE INTO evidence_metadata(key,value) VALUES('legacy_index_reviewed',?)").run(new Date().toISOString());
    if (!fs.existsSync(legacyPath)) { reviewed(); return; }
    const stat = fs.lstatSync(legacyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) {
      throw evidenceError("EVIDENCE_LEGACY_UNSAFE", "El índice Evidence heredado no es un archivo regular acotado.");
    }
    let entries;
    try {
      const parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      entries = Array.isArray(parsed?.entries) ? parsed.entries.slice(0, 10000) : [];
    } catch { throw evidenceError("EVIDENCE_LEGACY_INVALID", "El índice Evidence heredado está dañado; no se sobrescribió."); }
    const insert = db.prepare(`INSERT OR IGNORE INTO evidence_entries
      (evidence_id,project_id,truth_state,result,source_hash,source_scope,source_files_json,evidence_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        const evidenceId = boundedText(entry?.evidenceId, 128);
        if (!evidenceId || !/^[a-zA-Z0-9_-]+$/.test(evidenceId) || entry?.projectId !== identity.projectId || !HASH_PATTERN.test(String(entry?.sourceHash || ""))) continue;
        const sourceFiles = Array.isArray(entry.sourceFiles) ? [...new Set(entry.sourceFiles.map(String))].slice(0, 2000) : [];
        for (const relativePath of sourceFiles) safeRelative(identity.root, relativePath);
        const normalized = {
          schema: "dorn.evidence/2", ...boundedJson(entry, 512 * 1024, "La Evidence heredada", {}),
          evidenceId, projectId: identity.projectId, truthState: "PROPOSED", result: "UNKNOWN",
          sourceHash: String(entry.sourceHash), sourceScope: "LEGACY_REVIEW_REQUIRED", sourceComplete: false,
          sourceFiles, createdAt: Number.isFinite(Date.parse(entry.createdAt)) ? new Date(entry.createdAt).toISOString() : new Date(0).toISOString()
        };
        insert.run(evidenceId, identity.projectId, normalized.truthState, normalized.result, normalized.sourceHash, normalized.sourceScope, JSON.stringify(sourceFiles), JSON.stringify(normalized), normalized.createdAt);
      }
      reviewed();
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  row(row) {
    if (!row) return null;
    try {
      const evidence = JSON.parse(row.evidence_json);
      return evidence && evidence.schema === "dorn.evidence/2" ? evidence : null;
    } catch { return null; }
  }

  list(projectOrRoot, options = {}) {
    const identity = metadataIdentity(projectOrRoot);
    const db = this.ensure(projectOrRoot);
    const limit = Math.max(1, Math.min(2000, Number(options.limit) || 200));
    const before = options.before && Number.isFinite(Date.parse(options.before)) ? new Date(options.before).toISOString() : null;
    const rows = before
      ? db.prepare("SELECT evidence_json FROM evidence_entries WHERE project_id=? AND created_at<? ORDER BY created_at DESC,evidence_id DESC LIMIT ?").all(identity.projectId, before, limit)
      : db.prepare("SELECT evidence_json FROM evidence_entries WHERE project_id=? ORDER BY created_at DESC,evidence_id DESC LIMIT ?").all(identity.projectId, limit);
    return rows.map((row) => this.row(row)).filter(Boolean);
  }

  record(project, input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw evidenceError("EVIDENCE_INPUT_INVALID", "Evidence requiere una solicitud estructurada.");
    const identity = metadataIdentity(project);
    const db = this.ensure(project);
    if (input.files !== undefined && !Array.isArray(input.files)) throw evidenceError("EVIDENCE_SCOPE_INVALID", "files debe ser una lista explícita.");
    const explicitFiles = [...new Set((input.files || []).map(String))].sort();
    if (explicitFiles.length > 2000) throw evidenceError("EVIDENCE_SCOPE_TOO_LARGE", "Evidence recibió demasiados archivos.");
    for (const relativePath of explicitFiles) safeRelative(identity.root, relativePath);
    const screenshot = input.screenshot ? inspectScreenshot(identity.root, input.screenshot) : null;
    const artifactRefs = inspectArtifactRefs(identity.root, input.artifactRefs);
    const computedArtifactSetHash = artifactSetHash(artifactRefs);
    const declaredArtifactHash = input.artifactHash ? assertSha256(input.artifactHash, "artifactHash") : null;
    const artifactHash = declaredArtifactHash || screenshot?.sha256 || (artifactRefs.length === 1 ? artifactRefs[0].sha256 : computedArtifactSetHash);
    if (declaredArtifactHash) {
      const validArtifactHashes = new Set([screenshot?.sha256, computedArtifactSetHash, ...artifactRefs.map((entry) => entry.sha256)].filter(Boolean));
      if (!validArtifactHashes.has(declaredArtifactHash)) throw evidenceError("EVIDENCE_ARTIFACT_HASH_MISMATCH", "artifactHash no coincide con ningún artefacto local verificado.");
    }

    let source;
    if (explicitFiles.length) {
      source = sourceHash(identity.root, { relativePaths: explicitFiles });
      if (input.sourceHash && assertSha256(input.sourceHash, "sourceHash") !== source.hash) {
        throw evidenceError("EVIDENCE_SOURCE_HASH_MISMATCH", "sourceHash no coincide con los bytes actuales del working set.");
      }
      source.scope = boundedText(input.sourceScope, 80, "WORKING_SET").toUpperCase();
    } else if (artifactHash && (screenshot || artifactRefs.some((entry) => entry.verifiedLocalFile))) {
      source = { hash: artifactHash, fileCount: 0, sourceFiles: [], scope: screenshot && !artifactRefs.length ? "SCREENSHOT" : "ARTIFACT", complete: true };
      if (input.sourceHash && assertSha256(input.sourceHash, "sourceHash") !== source.hash) {
        throw evidenceError("EVIDENCE_SOURCE_HASH_MISMATCH", "sourceHash no coincide con el artefacto verificado.");
      }
    } else if (input.sourceHash) {
      source = { hash: assertSha256(input.sourceHash, "sourceHash"), fileCount: 0, sourceFiles: [], scope: "EXPLICIT_UNSCOPED", complete: false };
    } else {
      source = sourceHash(identity.root, { relativePaths: [] });
    }

    const result = boundedText(input.result, 32, "FAILED").toUpperCase();
    if (!ALLOWED_RESULTS.has(result)) throw evidenceError("EVIDENCE_RESULT_INVALID", "Evidence recibió un resultado desconocido.");
    const exitCode = input.exitCode === undefined || input.exitCode === null ? null : Number(input.exitCode);
    if (exitCode !== null && (!Number.isSafeInteger(exitCode) || exitCode < -2147483648 || exitCode > 2147483647)) {
      throw evidenceError("EVIDENCE_EXIT_CODE_INVALID", "Evidence recibió un exitCode inválido.");
    }
    const requestedTruth = boundedText(input.truthState, 32).toUpperCase();
    if (requestedTruth && !ALLOWED_TRUTH_STATES.has(requestedTruth)) throw evidenceError("EVIDENCE_TRUTH_INVALID", "Evidence recibió un truth state desconocido.");
    let truthState = requestedTruth || (result === "PASSED" && exitCode === 0 ? "VERIFIED" : result === "BLOCKED" ? "BLOCKED" : "FAILED");
    if (POSITIVE_TRUTH_STATES.has(truthState) && (result !== "PASSED" || exitCode !== 0)) {
      throw evidenceError("EVIDENCE_POSITIVE_WITHOUT_PASS", "Un estado verificable exige resultado PASSED y exitCode 0.");
    }
    const positiveTruthRequested = POSITIVE_TRUTH_STATES.has(truthState);
    if (POSITIVE_TRUTH_STATES.has(truthState) && !source.complete) truthState = "TESTED";
    const evidenceType = boundedText(input.evidenceType, 100, "COMMAND").toUpperCase();
    if (!/^[A-Z0-9_.:-]+$/.test(evidenceType)) throw evidenceError("EVIDENCE_TYPE_INVALID", "Evidence recibió un tipo inválido.");
    if (positiveTruthRequested && /VISUAL|SCREENSHOT/.test(evidenceType) && !screenshot) {
      throw evidenceError("EVIDENCE_SCREENSHOT_REQUIRED", "La verificación visual exige Screenshot Evidence real.");
    }
    const buildHash = input.buildHash ? assertSha256(input.buildHash, "buildHash") : null;
    const evidence = {
      schema: "dorn.evidence/2", evidenceId: crypto.randomUUID(), projectId: identity.projectId,
      evidenceType, command: input.command ? boundedText(input.command, 8000) : null,
      scenario: input.scenario ? boundedText(input.scenario, 4000) : null,
      environment: boundedJson(input.environment, 128 * 1024, "El entorno Evidence", null),
      sourceHash: source.hash, sourceScope: source.scope, sourceComplete: source.complete,
      sourceFiles: source.sourceFiles, fileCount: source.fileCount,
      buildHash, artifactHash: artifactHash || null, artifactRefs, screenshot,
      verifier: boundedJson(input.verifier, 64 * 1024, "El verificador Evidence", null),
      details: boundedJson(input.details, 512 * 1024, "Los detalles Evidence", null),
      exitCode, result, truthState, createdAt: new Date().toISOString()
    };
    boundedJson(evidence, 1024 * 1024, "La entrada Evidence", null);

    const links = [];
    const addLinks = (kind, relation, values) => {
      if (values !== undefined && !Array.isArray(values)) throw evidenceError("EVIDENCE_LINKS_INVALID", `${kind} debe ser una lista.`);
      for (const raw of values || []) {
        const entry = raw && typeof raw === "object" ? raw : { id: raw };
        const reference = boundedText(entry.id || entry.reference, 1000);
        if (reference) links.push({ kind, relation, reference, label: entry.label ? boundedText(entry.label, 500) : null, metadata: boundedJson(entry.metadata, 32 * 1024, "Los metadatos del enlace", {}) });
      }
    };
    addLinks("requirement", "verifies", input.requirements);
    addLinks("test", "result-of", input.tests);
    addLinks("build", "observes", input.builds);
    addLinks("task", "produced-by", input.tasks);
    addLinks("artifact", "contains", artifactRefs.map((entry) => ({ id: entry.artifactId || entry.relativePath, metadata: entry })));
    if (input.links !== undefined && !Array.isArray(input.links)) throw evidenceError("EVIDENCE_LINKS_INVALID", "links debe ser una lista.");
    for (const raw of input.links || []) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const reference = boundedText(raw.reference || raw.id, 1000);
      if (reference) links.push({
        kind: boundedText(raw.kind, 100, "reference"), relation: boundedText(raw.relation, 100, "related"),
        reference, label: raw.label ? boundedText(raw.label, 500) : null,
        metadata: boundedJson(raw.metadata, 32 * 1024, "Los metadatos del enlace", {})
      });
    }
    if (links.length > 1000) throw evidenceError("EVIDENCE_LINKS_TOO_LARGE", "Evidence recibió demasiados enlaces.");

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO evidence_entries
        (evidence_id,project_id,truth_state,result,source_hash,source_scope,source_files_json,evidence_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        evidence.evidenceId, evidence.projectId, evidence.truthState, evidence.result, evidence.sourceHash,
        evidence.sourceScope, JSON.stringify(evidence.sourceFiles), JSON.stringify(evidence), evidence.createdAt
      );
      const insertLink = db.prepare("INSERT OR IGNORE INTO evidence_links(evidence_id,ref_kind,relation,ref_id,label,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)");
      for (const link of links) insertLink.run(evidence.evidenceId, link.kind, link.relation, link.reference, link.label, JSON.stringify(link.metadata), evidence.createdAt);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    void this.eventBus?.publish("EVIDENCE_RECORDED", { evidenceId: evidence.evidenceId, truthState }, {
      projectId: evidence.projectId, idempotencyKey: `evidence:${evidence.evidenceId}`
    });
    try { this.onRecord?.(project, evidence, input); } catch {}
    return evidence;
  }

  evaluate(project, evidenceId, options = {}) {
    const identity = metadataIdentity(project);
    const db = this.ensure(project);
    const evidence = this.row(db.prepare("SELECT evidence_json FROM evidence_entries WHERE evidence_id=? AND project_id=?").get(boundedText(evidenceId, 128), identity.projectId));
    if (!evidence) throw evidenceError("EVIDENCE_NOT_FOUND", "La evidencia solicitada no existe para este proyecto.");
    if (evidence.projectId !== identity.projectId) throw evidenceError("EVIDENCE_PROJECT_IDENTITY_MISMATCH", "La Evidence solicitada pertenece a otro proyecto.");
    if (!POSITIVE_TRUTH_STATES.has(evidence.truthState)) return evidence;
    if (!evidence.sourceComplete) return { ...evidence, truthState: "NEEDS_RETEST", retestReason: "SOURCE_SCOPE_INCOMPLETE" };
    if (evidence.screenshot) {
      try {
        const currentScreenshot = inspectScreenshot(identity.root, evidence.screenshot);
        if (currentScreenshot.sha256 !== evidence.screenshot.sha256) return { ...evidence, truthState: "NEEDS_RETEST", currentScreenshotHash: currentScreenshot.sha256 };
      } catch (error) {
        return { ...evidence, truthState: "NEEDS_RETEST", screenshotError: boundedText(error?.message || error, 4000) };
      }
    }
    if (Array.isArray(evidence.artifactRefs) && evidence.artifactRefs.some((entry) => entry.verifiedLocalFile)) {
      try {
        const currentArtifacts = inspectArtifactRefs(identity.root, evidence.artifactRefs);
        const original = evidence.artifactRefs.filter((entry) => entry.verifiedLocalFile).map((entry) => `${entry.relativePath}:${entry.sha256}`).sort();
        const current = currentArtifacts.filter((entry) => entry.verifiedLocalFile).map((entry) => `${entry.relativePath}:${entry.sha256}`).sort();
        if (JSON.stringify(original) !== JSON.stringify(current)) return { ...evidence, truthState: "NEEDS_RETEST", retestReason: "ARTIFACT_CHANGED" };
      } catch (error) {
        return { ...evidence, truthState: "NEEDS_RETEST", artifactError: boundedText(error?.message || error, 4000) };
      }
    }
    if (Array.isArray(evidence.sourceFiles) && evidence.sourceFiles.length) {
      const cacheKey = `${identity.projectId}:${JSON.stringify(evidence.sourceFiles)}`;
      let current = options.cache?.get(cacheKey);
      if (!current) {
        current = sourceHash(identity.root, { relativePaths: evidence.sourceFiles });
        options.cache?.set(cacheKey, current);
      }
      if (!current.complete || current.hash !== evidence.sourceHash) return { ...evidence, truthState: "NEEDS_RETEST", currentSourceHash: current.hash };
    }
    return evidence;
  }

  status(project, options = {}) {
    const identity = metadataIdentity(project);
    const limit = Math.max(1, Math.min(2000, Number(options.limit) || 300));
    const cache = new Map();
    const entries = this.list(project, { limit }).map((entry) => this.evaluate(project, entry.evidenceId, { cache }));
    const total = Number(this.ensure(project).prepare("SELECT COUNT(*) AS count FROM evidence_entries WHERE project_id=?").get(identity.projectId).count);
    return {
      schema: "dorn.evidence-status/1", projectId: identity.projectId, entries, total, hasMore: total > entries.length,
      verified: entries.filter((entry) => POSITIVE_TRUTH_STATES.has(entry.truthState)).length,
      needsRetest: entries.filter((entry) => entry.truthState === "NEEDS_RETEST").length
    };
  }

  lineage(project, options = {}) {
    const identity = metadataIdentity(project);
    const db = this.ensure(project);
    const limit = Math.max(1, Math.min(2000, Number(options.limit) || 200));
    const reference = options.reference ? boundedText(options.reference, 1000) : null;
    const rows = reference
      ? db.prepare(`SELECT l.*,e.truth_state,e.result FROM evidence_links l JOIN evidence_entries e ON e.evidence_id=l.evidence_id WHERE e.project_id=? AND l.ref_id=? ORDER BY l.created_at DESC,l.evidence_id DESC LIMIT ?`).all(identity.projectId, reference, limit)
      : db.prepare(`SELECT l.*,e.truth_state,e.result FROM evidence_links l JOIN evidence_entries e ON e.evidence_id=l.evidence_id WHERE e.project_id=? ORDER BY l.created_at DESC,l.evidence_id DESC LIMIT ?`).all(identity.projectId, limit);
    return {
      schema: "dorn.evidence-lineage/1", projectId: identity.projectId, reference,
      entries: rows.map((row) => ({
        evidenceId: row.evidence_id, kind: row.ref_kind, relation: row.relation, reference: row.ref_id,
        label: row.label, metadata: safeParseObject(row.metadata_json), truthState: row.truth_state,
        result: row.result, createdAt: row.created_at
      }))
    };
  }

  closeAll() {
    for (const db of this.databases.values()) { try { db.close(); } catch {} }
    this.databases.clear();
    this.databaseOwners.clear();
  }
}

module.exports = {
  EvidenceCore, sourceHash, inspectScreenshot, imageDimensions, metadataIdentity,
  inspectArtifactRefs, artifactSetHash
};
