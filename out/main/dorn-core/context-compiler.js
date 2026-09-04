"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { projectIdentity } = require("./job-runtime");
const { safeRelative } = require("./project-integrity");
const { containsSecret } = require("./policy-engine");

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cjs", ".cpp", ".cs", ".css", ".csv", ".dart", ".gd", ".go", ".h", ".hpp",
  ".html", ".ino", ".java", ".js", ".json", ".jsx", ".kt", ".kts", ".md", ".mjs", ".py",
  ".rs", ".scss", ".shader", ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".xml",
  ".yaml", ".yml"
]);
const TEXT_NAMES = new Set([
  "CMakeLists.txt", "Dockerfile", "LICENSE", "Makefile", "README", "package-lock.json", "package.json",
  "requirements.txt", "project.godot"
]);
const PRIVATE_PATH = /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\.[^/]*)?|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]*\.(?:key|pem|p12|pfx|keystore))$/i;
const MAX_CONTEXT_SOURCE_BYTES = 512 * 1024;
const DEFAULT_MAX_CHARS = 48_000;
const DEFAULT_MAX_FILES = 24;
const DEFAULT_MAX_ENTRIES = 80;

function contextError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function timestamp() { return new Date().toISOString(); }

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function boundedText(value, maximum, label, options = {}) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text && options.required !== false) throw contextError("CONTEXT_INPUT_INVALID", `${label} es obligatorio.`);
  if (text.length > maximum) throw contextError("CONTEXT_INPUT_TOO_LARGE", `${label} excede el límite seguro.`);
  if (containsSecret(text)) throw contextError("CONTEXT_SECRET_INLINE", `${label} contiene una credencial y no puede entrar al contexto.`);
  return text;
}

function stableId(value, label, options = {}) {
  const text = boundedText(value, options.maximum || 200, label, options);
  if (text && !/^[a-zA-Z0-9_.:@/-]+$/.test(text)) throw contextError("CONTEXT_ID_INVALID", `${label} no tiene una identidad estable.`);
  return text;
}

function normalizeBudget(input = {}) {
  return {
    maxChars: Math.max(4_000, Math.min(200_000, Number(input.maxChars) || DEFAULT_MAX_CHARS)),
    maxFiles: Math.max(1, Math.min(100, Number(input.maxFiles) || DEFAULT_MAX_FILES)),
    maxEntries: Math.max(5, Math.min(300, Number(input.maxEntries) || DEFAULT_MAX_ENTRIES)),
    maxCharsPerFile: Math.max(1_000, Math.min(32_000, Number(input.maxCharsPerFile) || 12_000))
  };
}

function normalizeSignals(input, kind) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw contextError("CONTEXT_SIGNALS_INVALID", `${kind} debe ser una lista estructurada.`);
  if (input.length > 200) throw contextError("CONTEXT_SIGNALS_TOO_LARGE", `${kind} excede el límite acotado.`);
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw contextError("CONTEXT_SIGNAL_INVALID", `${kind}[${index}] no es estructurado.`);
    const id = stableId(raw.id || raw.requirementId || raw.decisionId || raw.failureId || raw.observationId, `${kind}[${index}].id`);
    const title = boundedText(raw.title || raw.name || id, 500, `${kind}[${index}].title`);
    const content = boundedText(raw.content || raw.text || raw.summary, 8_000, `${kind}[${index}].content`);
    const source = boundedText(raw.source || "PROJECT_TRUTH", 1_000, `${kind}[${index}].source`);
    const updatedAt = raw.updatedAt && Number.isFinite(Date.parse(raw.updatedAt)) ? new Date(raw.updatedAt).toISOString() : null;
    return { kind, id, title, content, source, updatedAt };
  });
}

function isTextCandidate(relativePath, kind) {
  const name = path.posix.basename(relativePath);
  return kind === "SOURCE" || kind === "TEST" || kind === "MANIFEST" || TEXT_NAMES.has(name) || TEXT_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function readIndexedText(root, candidate) {
  if (PRIVATE_PATH.test(candidate.path)) return { excluded: "PRIVATE_PATH" };
  if (!isTextCandidate(candidate.path, candidate.kind)) return { excluded: "NON_TEXT" };
  if (candidate.hashState !== "HASHED" || !HASH_PATTERN.test(String(candidate.sha256 || ""))) return { excluded: "UNHASHED_SOURCE" };
  if (candidate.sizeBytes > MAX_CONTEXT_SOURCE_BYTES) return { excluded: "SOURCE_TOO_LARGE" };
  const checked = safeRelative(root, candidate.path);
  let before;
  try { before = fs.lstatSync(checked.absolute); }
  catch { throw contextError("CONTEXT_INDEX_STALE", `${candidate.path} ya no existe; reindexa el proyecto.`, { relativePath: candidate.path }); }
  if (!before.isFile() || before.isSymbolicLink()) throw contextError("CONTEXT_SOURCE_UNSAFE", `${candidate.path} no es un archivo regular seguro.`);
  const real = fs.realpathSync(checked.absolute);
  if (!real.startsWith(`${root}${path.sep}`)) throw contextError("CONTEXT_SOURCE_ESCAPE", `${candidate.path} sale del proyecto.`);
  if (before.size !== candidate.sizeBytes || Math.trunc(before.mtimeMs) !== candidate.modifiedMs) {
    throw contextError("CONTEXT_INDEX_STALE", `${candidate.path} cambió después del índice; reindexa antes de compilar contexto.`, { relativePath: candidate.path });
  }
  const descriptor = fs.openSync(checked.absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let buffer;
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw contextError("CONTEXT_SOURCE_RACE", `${candidate.path} cambió durante la lectura.`);
    }
    buffer = Buffer.alloc(opened.size);
    let position = 0;
    while (position < buffer.length) {
      const bytes = fs.readSync(descriptor, buffer, position, buffer.length - position, position);
      if (!bytes) throw contextError("CONTEXT_SOURCE_RACE", `${candidate.path} quedó truncado durante la lectura.`);
      position += bytes;
    }
    const after = fs.fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw contextError("CONTEXT_SOURCE_RACE", `${candidate.path} cambió durante la lectura.`);
  } finally { fs.closeSync(descriptor); }
  const actualHash = sha256(buffer);
  if (actualHash !== candidate.sha256) throw contextError("CONTEXT_INDEX_STALE", `${candidate.path} no coincide con el hash del índice.`, { relativePath: candidate.path });
  if (buffer.includes(0)) return { excluded: "BINARY_CONTENT" };
  const content = buffer.toString("utf8");
  if ((content.match(/\ufffd/g) || []).length > Math.max(2, Math.floor(content.length / 1000))) return { excluded: "INVALID_TEXT_ENCODING" };
  if (containsSecret(content)) return { excluded: "SECRET_MATERIAL" };
  return { content, sha256: actualHash, bytes: buffer.length };
}

class ContextCompiler {
  constructor(options = {}) {
    this.projectCore = options.projectCore || null;
    this.projectIntegrity = options.projectIntegrity || null;
    this.evidenceCore = options.evidenceCore || null;
    this.stateCore = options.stateCore || null;
    this.eventBus = options.eventBus || null;
  }

  projectCore;
  projectIntegrity;
  evidenceCore;
  stateCore;
  eventBus;
  databases = new Map();
  databaseOwners = new Map();

  databasePath(root) { return path.join(root, ".dorn", "tasks", "context-compiler.db"); }

  ensure(project) {
    const identity = projectIdentity(project, this.projectCore);
    if (this.databases.has(identity.root)) {
      if (this.databaseOwners.get(identity.root) !== identity.projectId) throw contextError("CONTEXT_PROJECT_IDENTITY_MISMATCH", "La base de contexto abierta pertenece a otra identidad.");
      return { ...identity, db: this.databases.get(identity.root) };
    }
    const databasePath = this.databasePath(identity.root);
    if (fs.existsSync(databasePath)) {
      const stat = fs.lstatSync(databasePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw contextError("CONTEXT_METADATA_UNSAFE", "La base Context Compiler no es un archivo regular seguro.");
    }
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=3000;
        PRAGMA synchronous=NORMAL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS context_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS context_packs (
          pack_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,source_scan_id TEXT NOT NULL,
          state TEXT NOT NULL,pack_hash TEXT NOT NULL,pack_json TEXT NOT NULL,
          invalidation_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_context_packs_project ON context_packs(project_id,created_at DESC);
        CREATE TABLE IF NOT EXISTS context_pack_sources (
          pack_id TEXT NOT NULL REFERENCES context_packs(pack_id) ON DELETE CASCADE,
          source_kind TEXT NOT NULL,source_id TEXT NOT NULL,source_hash TEXT NOT NULL,
          PRIMARY KEY(pack_id,source_kind,source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_context_sources_lookup ON context_pack_sources(source_kind,source_id,pack_id);
      `);
      const owner = db.prepare("SELECT value FROM context_metadata WHERE key='project_id'").get()?.value || null;
      const foreign = Number(db.prepare("SELECT COUNT(*) AS count FROM context_packs WHERE project_id!=?").get(identity.projectId).count);
      if ((owner && owner !== identity.projectId) || foreign) throw contextError("CONTEXT_PROJECT_IDENTITY_MISMATCH", "La base Context Compiler contiene otra identidad de proyecto.");
      if (!owner) db.prepare("INSERT INTO context_metadata(key,value) VALUES('project_id',?)").run(identity.projectId);
    } catch (error) { try { db.close(); } catch {} throw error; }
    this.databases.set(identity.root, db);
    this.databaseOwners.set(identity.root, identity.projectId);
    return { ...identity, db };
  }

  assertScope(projectId, scope) {
    if (!scope) return;
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw contextError("CONTEXT_SCOPE_INVALID", "El scope del Context Compiler debe ser estructurado.");
    this.stateCore?.assertScope({
      projectId,
      ...(scope.conversationId ? { conversationId: String(scope.conversationId) } : {}),
      ...(scope.generation !== undefined ? { generation: Number(scope.generation) } : {})
    });
  }

  build(project, input = {}) {
    if (!this.projectIntegrity) throw contextError("CONTEXT_INTEGRITY_UNAVAILABLE", "Context Compiler necesita Project Integrity.");
    const identity = this.ensure(project);
    this.assertScope(identity.projectId, input.scope);
    const query = boundedText(input.query || input.goal, 2_000, "La consulta del contexto");
    const budget = normalizeBudget(input.budget);
    const candidates = this.projectIntegrity.contextCandidates(project, {
      query,
      requestedPaths: input.requestedFiles,
      changedPaths: input.changedFiles,
      maxCandidates: Math.min(2000, Math.max(200, budget.maxFiles * 20))
    });
    if (candidates.state !== "READY") {
      const code = candidates.state === "SCAN_REQUIRED" ? "CONTEXT_SCAN_REQUIRED" : "CONTEXT_INDEX_STALE";
      throw contextError(code, candidates.state === "SCAN_REQUIRED" ? "Context Compiler requiere un escaneo completo antes de seleccionar archivos." : "El índice tiene cambios pendientes; reescanea antes de compilar contexto.", { contextCandidates: candidates });
    }
    if (candidates.missingRequestedPaths?.length) {
      throw contextError("CONTEXT_REQUESTED_FILE_NOT_INDEXED", "Un archivo solicitado no pertenece al índice fresco del proyecto.", { missingRequestedPaths: candidates.missingRequestedPaths });
    }
    const signalSets = [
      ...normalizeSignals(input.requirements, "REQUIREMENT"),
      ...normalizeSignals(input.decisions, "DECISION"),
      ...normalizeSignals(input.runtimeObservations, "RUNTIME_OBSERVATION"),
      ...normalizeSignals(input.failures, "FAILURE")
    ];
    if (input.evidenceIds !== undefined && !Array.isArray(input.evidenceIds)) throw contextError("CONTEXT_EVIDENCE_INVALID", "evidenceIds debe ser una lista explícita.");
    const evidenceIds = [...new Set((input.evidenceIds || []).map((value) => stableId(value, "evidenceId")))];
    if (evidenceIds.length > 200) throw contextError("CONTEXT_EVIDENCE_TOO_LARGE", "Context Compiler recibió demasiadas Evidence explícitas.");
    const evidenceById = new Map();
    if (evidenceIds.length && this.evidenceCore) {
      const requested = new Set(evidenceIds);
      for (const entry of this.evidenceCore.list(project, { limit: 2000 })) {
        if (requested.has(entry.evidenceId)) evidenceById.set(entry.evidenceId, this.evidenceCore.evaluate(project, entry.evidenceId));
      }
    }
    const missingEvidence = evidenceIds.filter((id) => !evidenceById.has(id));
    if (missingEvidence.length) throw contextError("CONTEXT_EVIDENCE_NOT_FOUND", "Una Evidence solicitada no existe en este proyecto.", { missingEvidence });

    const entries = [];
    const exclusions = [];
    let usedChars = 0;
    let usedFiles = 0;
    const add = (entry, content) => {
      if (entries.length >= budget.maxEntries) return false;
      const available = budget.maxChars - usedChars;
      if (available <= 0) return false;
      const selected = String(content || "").slice(0, available);
      if (!selected) return false;
      entries.push({ ...entry, content: selected, contentChars: selected.length, truncated: selected.length < String(content || "").length });
      usedChars += selected.length;
      return true;
    };
    const signalScore = { REQUIREMENT: 940, DECISION: 900, FAILURE: 860, RUNTIME_OBSERVATION: 780 };
    for (const signal of signalSets.sort((left, right) => signalScore[right.kind] - signalScore[left.kind] || left.id.localeCompare(right.id))) {
      add({
        kind: signal.kind, id: signal.id, title: signal.title, source: signal.source,
        sourceHash: sha256(signal.content), freshness: signal.updatedAt ? "DATED" : "SNAPSHOT",
        updatedAt: signal.updatedAt, score: signalScore[signal.kind], selectionReasons: [`EXPLICIT_${signal.kind}`]
      }, signal.content);
    }
    for (const id of evidenceIds) {
      const evidence = evidenceById.get(id);
      const summary = JSON.stringify({
        evidenceId: evidence.evidenceId, evidenceType: evidence.evidenceType, truthState: evidence.truthState,
        result: evidence.result, sourceHash: evidence.sourceHash, sourceFiles: evidence.sourceFiles,
        artifactHash: evidence.artifactHash, createdAt: evidence.createdAt
      });
      if (containsSecret(summary)) throw contextError("CONTEXT_SECRET_INLINE", `Evidence ${id} contiene material sensible.`);
      add({
        kind: "EVIDENCE", id, title: evidence.evidenceType, source: "EVIDENCE_CORE",
        sourceHash: sha256(summary), evidenceSourceHash: evidence.sourceHash,
        freshness: evidence.truthState === "NEEDS_RETEST" ? "STALE" : "EVALUATED",
        score: 880, selectionReasons: ["EXPLICIT_EVIDENCE"]
      }, summary);
    }
    for (const candidate of candidates.candidates) {
      if (usedFiles >= budget.maxFiles || entries.length >= budget.maxEntries || usedChars >= budget.maxChars) break;
      let inspected;
      try { inspected = readIndexedText(identity.root, candidate); }
      catch (error) { throw error; }
      if (inspected.excluded) {
        if (exclusions.length < 200) exclusions.push({ path: candidate.path, reason: inspected.excluded });
        continue;
      }
      const content = inspected.content.slice(0, budget.maxCharsPerFile);
      if (add({
        kind: "FILE", id: candidate.path, path: candidate.path, title: path.posix.basename(candidate.path),
        fileKind: candidate.kind, source: "PROJECT_INTEGRITY", sourceHash: inspected.sha256,
        bytes: inspected.bytes, freshness: "HASH_VERIFIED", score: candidate.score,
        selectionReasons: candidate.selectionReasons
      }, content)) usedFiles += 1;
    }
    if (!entries.length) throw contextError("CONTEXT_EMPTY", "Context Compiler no encontró contenido seguro y pertinente dentro del presupuesto.");
    this.assertScope(identity.projectId, input.scope);
    const createdAt = timestamp();
    const packId = crypto.randomUUID();
    const pack = {
      schema: "dorn.context-pack/2", contextPackId: packId, projectId: identity.projectId,
      conversationId: input.scope?.conversationId ? stableId(input.scope.conversationId, "conversationId") : null,
      generation: input.scope?.generation === undefined ? null : Number(input.scope.generation),
      jobId: input.jobId ? stableId(input.jobId, "jobId") : null,
      workUnitId: input.workUnitId ? stableId(input.workUnitId, "workUnitId") : null,
      query, state: "FRESH", freshness: "HASH_VERIFIED", sourceScanId: candidates.sourceScanId,
      sourceIndex: { indexedFiles: candidates.indexedFiles, deferredHashes: candidates.deferredHashes },
      budget: { ...budget, usedChars, usedFiles, usedEntries: entries.length },
      selection: { candidateCount: candidates.candidates.length, exclusions, entries },
      createdAt
    };
    const packHash = sha256(stableJson(pack));
    pack.packHash = packHash;
    const packJson = JSON.stringify(pack);
    if (Buffer.byteLength(packJson, "utf8") > 2 * 1024 * 1024) throw contextError("CONTEXT_PACK_TOO_LARGE", "El ContextPack excede el límite durable.");
    const insertSource = identity.db.prepare("INSERT INTO context_pack_sources(pack_id,source_kind,source_id,source_hash) VALUES(?,?,?,?)");
    identity.db.exec("BEGIN IMMEDIATE");
    try {
      identity.db.prepare(`INSERT INTO context_packs
        (pack_id,project_id,source_scan_id,state,pack_hash,pack_json,invalidation_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?, ?,?)`).run(packId, identity.projectId, candidates.sourceScanId, "FRESH", packHash, packJson, "[]", createdAt, createdAt);
      for (const entry of entries) insertSource.run(packId, entry.kind, entry.id, entry.sourceHash);
      identity.db.exec("COMMIT");
    } catch (error) { identity.db.exec("ROLLBACK"); throw error; }
    void this.eventBus?.publish("CONTEXT_PACK_BUILT", { contextPackId: packId, state: "FRESH", entries: entries.length }, {
      projectId: identity.projectId, conversationId: pack.conversationId,
      idempotencyKey: `context-pack:${packId}`
    });
    return pack;
  }

  get(project, packId) {
    const identity = this.ensure(project);
    const id = stableId(packId, "contextPackId");
    const row = identity.db.prepare("SELECT * FROM context_packs WHERE pack_id=? AND project_id=?").get(id, identity.projectId);
    if (!row) throw contextError("CONTEXT_PACK_NOT_FOUND", "El ContextPack no existe en este proyecto.");
    let pack;
    try { pack = JSON.parse(row.pack_json); } catch { throw contextError("CONTEXT_PACK_CORRUPT", "El ContextPack durable está dañado."); }
    if (!pack || pack.schema !== "dorn.context-pack/2" || pack.projectId !== identity.projectId || pack.contextPackId !== id) {
      throw contextError("CONTEXT_PACK_CORRUPT", "El ContextPack durable no conserva su identidad.");
    }
    const declaredHash = pack.packHash;
    const canonical = { ...pack };
    delete canonical.packHash;
    if (!HASH_PATTERN.test(String(declaredHash || "")) || sha256(stableJson(canonical)) !== declaredHash || row.pack_hash !== declaredHash) {
      throw contextError("CONTEXT_PACK_CORRUPT", "El ContextPack durable no coincide con su hash canónico.");
    }
    return { ...pack, state: row.state, invalidations: JSON.parse(row.invalidation_json || "[]") };
  }

  validate(project, packId) {
    const pack = this.get(project, packId);
    const identity = this.ensure(project);
    const reasons = [...(pack.invalidations || [])];
    for (const entry of pack.selection.entries) {
      if (entry.kind === "FILE") {
        try {
          const inspected = readIndexedText(identity.root, {
            path: entry.path, kind: entry.fileKind, hashState: "HASHED", sha256: entry.sourceHash,
            sizeBytes: entry.bytes, modifiedMs: Math.trunc(fs.lstatSync(path.join(identity.root, ...entry.path.split("/"))).mtimeMs)
          });
          if (inspected.excluded || inspected.sha256 !== entry.sourceHash) reasons.push({ sourceKind: "FILE", sourceId: entry.path, reason: inspected.excluded || "HASH_CHANGED" });
        } catch (error) { reasons.push({ sourceKind: "FILE", sourceId: entry.path, reason: error.code || "SOURCE_UNAVAILABLE" }); }
      } else if (entry.kind === "EVIDENCE" && this.evidenceCore) {
        try {
          const current = this.evidenceCore.evaluate(project, entry.id);
          const summary = JSON.stringify({
            evidenceId: current.evidenceId, evidenceType: current.evidenceType, truthState: current.truthState,
            result: current.result, sourceHash: current.sourceHash, sourceFiles: current.sourceFiles,
            artifactHash: current.artifactHash, createdAt: current.createdAt
          });
          if (sha256(summary) !== entry.sourceHash) reasons.push({ sourceKind: "EVIDENCE", sourceId: entry.id, reason: "EVIDENCE_CHANGED" });
        } catch (error) { reasons.push({ sourceKind: "EVIDENCE", sourceId: entry.id, reason: error.code || "EVIDENCE_UNAVAILABLE" }); }
      }
    }
    const uniqueReasons = [...new Map(reasons.map((reason) => [`${reason.sourceKind}:${reason.sourceId}:${reason.reason}`, reason])).values()];
    const state = uniqueReasons.length ? "STALE" : "FRESH";
    identity.db.prepare("UPDATE context_packs SET state=?,invalidation_json=?,updated_at=? WHERE pack_id=? AND project_id=?")
      .run(state, JSON.stringify(uniqueReasons), timestamp(), pack.contextPackId, identity.projectId);
    return { schema: "dorn.context-pack-validation/1", contextPackId: pack.contextPackId, projectId: identity.projectId, state, reasons: uniqueReasons, checkedAt: timestamp() };
  }

  invalidate(project, relativePath, reason = "FILE_MODIFIED") {
    const identity = this.ensure(project);
    const checked = safeRelative(identity.root, relativePath);
    const rows = identity.db.prepare(`SELECT p.pack_id,p.invalidation_json FROM context_packs p
      JOIN context_pack_sources s ON s.pack_id=p.pack_id
      WHERE p.project_id=? AND s.source_kind='FILE' AND s.source_id=?`).all(identity.projectId, checked.relativePath);
    const now = timestamp();
    for (const row of rows) {
      let invalidations = [];
      try { invalidations = JSON.parse(row.invalidation_json || "[]"); } catch {}
      const item = { sourceKind: "FILE", sourceId: checked.relativePath, reason: boundedText(reason, 200, "invalidation reason") };
      if (!invalidations.some((entry) => entry.sourceKind === item.sourceKind && entry.sourceId === item.sourceId && entry.reason === item.reason)) invalidations.push(item);
      identity.db.prepare("UPDATE context_packs SET state='STALE',invalidation_json=?,updated_at=? WHERE pack_id=?")
        .run(JSON.stringify(invalidations.slice(-500)), now, row.pack_id);
    }
    return { schema: "dorn.context-invalidation/1", projectId: identity.projectId, relativePath: checked.relativePath, invalidatedPacks: rows.length };
  }

  closeAll() {
    for (const db of this.databases.values()) { try { db.close(); } catch {} }
    this.databases.clear();
    this.databaseOwners.clear();
  }
}

module.exports = {
  ContextCompiler, normalizeBudget, normalizeSignals, readIndexedText, PRIVATE_PATH,
  MAX_CONTEXT_SOURCE_BYTES, stableJson
};
