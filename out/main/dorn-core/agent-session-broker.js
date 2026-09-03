"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { projectIdentity } = require("./job-runtime");
const { sourceHash } = require("./evidence-core");
const { containsSecret } = require("./policy-engine");

const ACTIVE_STATES = new Set([
  "CREATED", "STARTING", "RUNNING", "PAUSING", "PAUSED", "CHECKPOINTED", "RECOVERING", "CANCELLING"
]);
const FINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED", "BLOCKED"]);
const JOB_FINAL_STATES = new Set(["BLOCKED", "CANCELLED", "COMPLETED", "FAILED", "INTERRUPTED", "PARTIAL"]);
const INTERRUPTED_STATES = new Set(["STARTING", "RUNNING", "PAUSING", "CANCELLING"]);
const TRANSITIONS = Object.freeze({
  CREATED: new Set(["STARTING", "CANCELLED", "BLOCKED"]),
  STARTING: new Set(["RUNNING", "CHECKPOINTED", "PAUSED", "RECOVERING", "CANCELLING", "FAILED", "CANCELLED", "BLOCKED"]),
  RUNNING: new Set(["PAUSING", "CHECKPOINTED", "RECOVERING", "CANCELLING", "COMPLETED", "FAILED", "BLOCKED"]),
  PAUSING: new Set(["PAUSED", "RECOVERING", "CANCELLING", "FAILED", "BLOCKED"]),
  PAUSED: new Set(["STARTING", "RECOVERING", "CANCELLED", "BLOCKED"]),
  CHECKPOINTED: new Set(["STARTING", "RUNNING", "PAUSED", "RECOVERING", "CANCELLING", "COMPLETED", "FAILED", "BLOCKED"]),
  RECOVERING: new Set(["STARTING", "RUNNING", "PAUSED", "CANCELLING", "COMPLETED", "FAILED", "CANCELLED", "BLOCKED"]),
  CANCELLING: new Set(["CANCELLED", "FAILED", "BLOCKED"]),
  COMPLETED: new Set(), FAILED: new Set(), CANCELLED: new Set(), BLOCKED: new Set()
});
const STREAM_TYPES = new Set(["STATUS", "MESSAGE", "TOOL", "ARTIFACT", "USAGE", "WARNING", "ERROR"]);
const HEALTH_STATES = new Set(["UNKNOWN", "HEALTHY", "DEGRADED", "UNAVAILABLE"]);
const QUOTA_STATES = new Set(["UNKNOWN", "AVAILABLE", "DEGRADED", "EXHAUSTED"]);
const LIMITS = Object.freeze({ checkpointsPerSession: 10_000, eventsPerSession: 100_000, handoffsPerSession: 1_000, liveAttachmentsPerSession: 100 });

function brokerError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function timestamp() { return new Date().toISOString(); }
function hashJson(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function boundedText(value, maximum, label, options = {}) {
  const text = String(value ?? "").trim();
  if (!text && options.required !== false) throw brokerError("AGENT_SESSION_INPUT_INVALID", `${label} es obligatorio.`);
  if (text.length > maximum) throw brokerError("AGENT_SESSION_INPUT_TOO_LARGE", `${label} excede el límite seguro.`);
  if (containsSecret(text)) throw brokerError("AGENT_SESSION_SECRET_INLINE", `${label} contiene una credencial o secreto y no puede persistirse.`);
  return text;
}

function stableId(value, label, options = {}) {
  const text = boundedText(value, options.maximum || 200, label, options);
  if (!text && options.required === false) return null;
  const pattern = options.runtime ? /^[a-z][a-z0-9_.-]{1,79}$/ : /^[a-zA-Z0-9_.:-]{1,200}$/;
  if (!pattern.test(text)) throw brokerError("AGENT_SESSION_ID_INVALID", `${label} no tiene una identidad estable.`);
  return text;
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

function boundedJson(value, maximum, label, fallback = {}) {
  const source = value === undefined ? fallback : value;
  let json;
  try { json = JSON.stringify(source); }
  catch { throw brokerError("AGENT_SESSION_JSON_INVALID", `${label} no es JSON serializable.`); }
  if (Buffer.byteLength(json, "utf8") > maximum) throw brokerError("AGENT_SESSION_STATE_TOO_LARGE", `${label} excede el límite durable.`);
  if (containsSensitiveField(source) || containsSecret(json)) throw brokerError("AGENT_SESSION_SECRET_INLINE", `${label} contiene una credencial o secreto y no puede persistirse.`);
  return { json, value: JSON.parse(json) };
}

function parseStored(value, fallback, label) {
  try { return value === null || value === undefined ? structuredClone(fallback) : JSON.parse(value); }
  catch { throw brokerError("AGENT_SESSION_DATABASE_CORRUPT", `${label} contiene JSON dañado.`); }
}

function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = operation(); db.exec("COMMIT"); return result; }
  catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
}

function safeRelative(root, rawPath) {
  const input = String(rawPath ?? "");
  if (!input || input.includes("\0") || path.isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input)) {
    throw brokerError("AGENT_HANDOFF_PATH_UNSAFE", "El handoff recibió una ruta absoluta o vacía.");
  }
  const relativePath = input.replaceAll("\\", "/");
  if (relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw brokerError("AGENT_HANDOFF_PATH_UNSAFE", "El handoff recibió una ruta ambigua o insegura.");
  }
  const absolute = path.resolve(root, ...relativePath.split("/"));
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) throw brokerError("AGENT_HANDOFF_PATH_ESCAPE", "El handoff intentó salir del proyecto.");
  return relativePath;
}

function stringList(value, label, options = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw brokerError("AGENT_HANDOFF_INPUT_INVALID", `${label} debe ser una lista.`);
  const maximum = options.maximum || 200;
  if (value.length > maximum) throw brokerError("AGENT_HANDOFF_INPUT_TOO_LARGE", `${label} contiene demasiadas entradas.`);
  return value.map((item, index) => boundedText(item, options.itemMaximum || 4000, `${label}[${index}]`));
}

function validateDatabaseFiles(databasePath, tasksRoot) {
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(candidate)) !== tasksRoot) {
      throw brokerError("AGENT_SESSION_METADATA_UNSAFE", "La base de Agent Sessions o uno de sus archivos auxiliares no es seguro.");
    }
  }
}

function normalizeUsage(value = {}, previous = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw brokerError("AGENT_SESSION_USAGE_INVALID", "El uso debe ser estructurado.");
  const result = { ...previous };
  const cumulative = new Set(["inputTokens", "outputTokens", "toolCalls", "costUsd"]);
  for (const key of ["inputTokens", "outputTokens", "toolCalls", "costUsd", "latencyMs"]) {
    if (value[key] === undefined) continue;
    const number = Number(value[key]);
    if (!Number.isFinite(number) || number < 0 || (key !== "costUsd" && !Number.isSafeInteger(number))) {
      throw brokerError("AGENT_SESSION_USAGE_INVALID", `usage.${key} necesita un número no negativo.`);
    }
    if (cumulative.has(key) && Number.isFinite(Number(previous[key])) && number < Number(previous[key])) {
      throw brokerError("AGENT_SESSION_USAGE_REGRESSION", `usage.${key} no puede retroceder dentro de la misma sesión.`);
    }
    result[key] = number;
  }
  return result;
}

function normalizeQuota(value = {}, previous = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw brokerError("AGENT_SESSION_QUOTA_INVALID", "La cuota debe ser estructurada.");
  const result = { ...previous };
  if (value.state !== undefined) {
    const state = String(value.state).toUpperCase();
    if (!QUOTA_STATES.has(state)) throw brokerError("AGENT_SESSION_QUOTA_INVALID", "El estado de cuota no es reconocido.");
    result.state = state;
  }
  for (const key of ["remaining", "limit"]) {
    if (value[key] === undefined) continue;
    if (value[key] === null) result[key] = null;
    else {
      const number = Number(value[key]);
      if (!Number.isFinite(number) || number < 0) throw brokerError("AGENT_SESSION_QUOTA_INVALID", `quota.${key} necesita un número no negativo o null.`);
      result[key] = number;
    }
  }
  if (value.resetsAt !== undefined) {
    if (value.resetsAt === null) result.resetsAt = null;
    else if (!Number.isFinite(Date.parse(String(value.resetsAt)))) throw brokerError("AGENT_SESSION_QUOTA_INVALID", "quota.resetsAt no es una fecha válida.");
    else result.resetsAt = new Date(String(value.resetsAt)).toISOString();
  }
  return result;
}

function normalizeTestRun(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw brokerError("AGENT_HANDOFF_INPUT_INVALID", `testsRun[${index}] debe ser estructurado.`);
  const command = stringList(value.command || [], `testsRun[${index}].command`, { maximum: 100, itemMaximum: 8192 });
  const exitCode = value.exitCode === null || value.exitCode === undefined ? null : Number(value.exitCode);
  if (exitCode !== null && !Number.isSafeInteger(exitCode)) throw brokerError("AGENT_HANDOFF_INPUT_INVALID", `testsRun[${index}].exitCode no es válido.`);
  if (value.passed === true && exitCode !== 0) throw brokerError("AGENT_HANDOFF_TEST_INCONSISTENT", `testsRun[${index}] no puede declarar passed sin exitCode 0.`);
  return {
    id: stableId(value.id || `test-${index + 1}`, `testsRun[${index}].id`),
    command,
    passed: value.passed === true,
    exitCode,
    evidenceId: value.evidenceId ? stableId(value.evidenceId, `testsRun[${index}].evidenceId`) : null
  };
}

class AgentSessionBroker {
  constructor(options = {}) {
    if (!options.projectCore || !options.jobRuntime) throw new Error("Agent Session Broker necesita Project Core y Durable Jobs.");
    this.projectCore = options.projectCore;
    this.jobRuntime = options.jobRuntime;
    this.evidenceCore = options.evidenceCore || null;
    this.eventBus = options.eventBus || null;
    this.contextCompiler = options.contextCompiler || null;
  }

  projectCore;
  jobRuntime;
  evidenceCore;
  eventBus;
  contextCompiler;
  databases = new Map();
  databaseOwners = new Map();

  databasePath(identity) { return path.join(identity.tasksRoot, "agent-sessions.db"); }

  open(identity) {
    const databasePath = this.databasePath(identity);
    validateDatabaseFiles(databasePath, identity.tasksRoot);
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        PRAGMA busy_timeout=3000;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS agent_session_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_sessions (
          session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL, work_unit_id TEXT NOT NULL,
          runtime_id TEXT NOT NULL, context_pack_id TEXT, state TEXT NOT NULL, external_session_id TEXT,
          objective TEXT NOT NULL, metadata_json TEXT NOT NULL, usage_json TEXT NOT NULL, quota_json TEXT NOT NULL,
          health_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, error_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions(project_id,state,updated_at DESC);
        CREATE TABLE IF NOT EXISTS agent_session_checkpoints (
          checkpoint_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL, reason TEXT NOT NULL, state_json TEXT NOT NULL, state_hash TEXT NOT NULL,
          created_at TEXT NOT NULL, UNIQUE(session_id,sequence)
        );
        CREATE TABLE IF NOT EXISTS agent_session_events (
          event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
          UNIQUE(session_id,sequence)
        );
        CREATE TABLE IF NOT EXISTS agent_session_attachments (
          attachment_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
          consumer_id TEXT NOT NULL, consumer_kind TEXT NOT NULL, attached_at TEXT NOT NULL, detached_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_attachment_live ON agent_session_attachments(session_id,consumer_id) WHERE detached_at IS NULL;
        CREATE TABLE IF NOT EXISTS agent_handoffs (
          handoff_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL, previous_hash TEXT, handoff_hash TEXT NOT NULL, handoff_json TEXT NOT NULL,
          created_at TEXT NOT NULL, UNIQUE(session_id,sequence)
        );
      `);
      const owner = db.prepare("SELECT value FROM agent_session_metadata WHERE key='project_id'").get()?.value || null;
      const rowOwners = db.prepare("SELECT DISTINCT project_id FROM agent_sessions").all().map((row) => String(row.project_id));
      if ((owner && owner !== identity.projectId) || rowOwners.some((candidate) => candidate !== identity.projectId)) {
        throw brokerError("AGENT_SESSION_PROJECT_IDENTITY_MISMATCH", "La base de Agent Sessions pertenece a otro proyecto.");
      }
      if (!owner) db.prepare("INSERT INTO agent_session_metadata(key,value) VALUES('project_id',?)").run(identity.projectId);
      const interrupted = [...INTERRUPTED_STATES];
      const placeholders = interrupted.map(() => "?").join(",");
      const now = timestamp();
      db.prepare(`UPDATE agent_sessions SET state='RECOVERING',external_session_id=NULL,updated_at=?,error_json=? WHERE state IN (${placeholders})`).run(
        now,
        JSON.stringify({ code: "AGENT_SESSION_RESTART_RECOVERY", message: "DORN se cerró durante la sesión; se requiere reanudar desde un checkpoint durable." }),
        ...interrupted
      );
      validateDatabaseFiles(databasePath, identity.tasksRoot);
      return db;
    } catch (error) { try { db.close(); } catch {} throw error; }
  }

  ensure(project) {
    const identity = projectIdentity(project, this.projectCore);
    if (this.databases.has(identity.root)) {
      if (this.databaseOwners.get(identity.root) !== identity.projectId) throw brokerError("AGENT_SESSION_PROJECT_IDENTITY_MISMATCH", "La base abierta pertenece a otra identidad.");
      return { identity, db: this.databases.get(identity.root) };
    }
    const db = this.open(identity);
    this.databases.set(identity.root, db);
    this.databaseOwners.set(identity.root, identity.projectId);
    return { identity, db };
  }

  row(row) {
    if (!row) return null;
    return {
      schema: "dorn.agent-session/3", sessionId: String(row.session_id), projectId: String(row.project_id),
      jobId: String(row.job_id), workUnitId: String(row.work_unit_id), runtimeId: String(row.runtime_id),
      contextPackId: row.context_pack_id || null, state: String(row.state), externalSessionId: row.external_session_id || null,
      objective: String(row.objective), metadata: parseStored(row.metadata_json, {}, "metadata_json"),
      usage: parseStored(row.usage_json, {}, "usage_json"), quota: parseStored(row.quota_json, { state: "UNKNOWN" }, "quota_json"),
      health: parseStored(row.health_json, { state: "UNKNOWN" }, "health_json"), error: parseStored(row.error_json, null, "error_json"),
      createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at || null
    };
  }

  publish(session, type, payload = {}) {
    void this.eventBus?.publish(type, { sessionId: session.sessionId, state: session.state, runtimeId: session.runtimeId, ...payload }, {
      projectId: session.projectId, jobId: session.jobId,
      idempotencyKey: `${type.toLowerCase()}:${session.sessionId}:${session.updatedAt}:${payload.handoffId || payload.checkpointId || "state"}`
    });
  }

  create(project, input = {}) {
    const { identity, db } = this.ensure(project);
    const jobId = stableId(input.jobId, "jobId");
    const job = this.jobRuntime.get(identity.project, jobId);
    if (job.projectId !== identity.projectId || JOB_FINAL_STATES.has(job.state)) throw brokerError("AGENT_SESSION_JOB_INVALID", "La sesión necesita un Job activo del mismo proyecto.");
    const workUnitId = stableId(input.workUnitId || jobId, "workUnitId");
    const runtimeId = stableId(input.runtimeId, "runtimeId", { runtime: true });
    const contextPackId = input.contextPackId ? stableId(input.contextPackId, "contextPackId") : null;
    if (contextPackId) {
      if (!this.contextCompiler) throw brokerError("AGENT_SESSION_CONTEXT_UNAVAILABLE", "La sesión declaró un ContextPack, pero Context Compiler no está disponible.");
      const validation = this.contextCompiler.validate(identity.project, contextPackId);
      if (validation.state !== "FRESH") throw brokerError("AGENT_SESSION_CONTEXT_STALE", "La sesión no puede iniciar con un ContextPack obsoleto.", { validation });
      const contextPack = this.contextCompiler.get(identity.project, contextPackId);
      if (contextPack.projectId !== identity.projectId || (contextPack.jobId && contextPack.jobId !== jobId) || (contextPack.workUnitId && contextPack.workUnitId !== workUnitId)) {
        throw brokerError("AGENT_SESSION_CONTEXT_SCOPE_MISMATCH", "El ContextPack no pertenece al Job y Work Unit de la sesión.");
      }
    }
    const objective = boundedText(input.objective || job.goal, 20_000, "objective");
    const metadata = boundedJson(input.metadata || {}, 256 * 1024, "metadata");
    const sessionId = crypto.randomUUID();
    const now = timestamp();
    db.prepare(`INSERT INTO agent_sessions
      (session_id,project_id,job_id,work_unit_id,runtime_id,context_pack_id,state,external_session_id,objective,metadata_json,usage_json,quota_json,health_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'CREATED',NULL,?,?,?,?,?,?,?)`).run(
      sessionId, identity.projectId, jobId, workUnitId, runtimeId, contextPackId, objective, metadata.json,
      "{}", JSON.stringify({ state: "UNKNOWN" }), JSON.stringify({ state: "UNKNOWN" }), now, now
    );
    const session = this.get(identity.project, sessionId);
    this.publish(session, "AGENT_SESSION_STATE_CHANGED");
    return session;
  }

  get(project, sessionId, options = {}) {
    const { identity, db } = this.ensure(project);
    const id = stableId(sessionId, "sessionId");
    const session = this.row(db.prepare("SELECT * FROM agent_sessions WHERE session_id=?").get(id));
    if (!session) throw brokerError("AGENT_SESSION_NOT_FOUND", "La Agent Session no existe en este proyecto.");
    if (session.projectId !== identity.projectId) throw brokerError("AGENT_SESSION_PROJECT_IDENTITY_MISMATCH", "La Agent Session pertenece a otra identidad.");
    if (options.withCheckpoints) session.checkpoints = this.checkpoints(identity.project, id, options.checkpointLimit);
    if (options.withHandoffs) session.handoffs = this.handoffs(identity.project, id, options.handoffLimit);
    if (options.withAttachments) session.attachments = this.attachments(identity.project, id, { includeDetached: options.includeDetached });
    return session;
  }

  list(project, options = {}) {
    const { identity, db } = this.ensure(project);
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    const state = options.state ? String(options.state).toUpperCase() : null;
    if (state && !ACTIVE_STATES.has(state) && !FINAL_STATES.has(state)) throw brokerError("AGENT_SESSION_STATE_INVALID", "El filtro de estado no es reconocido.");
    const rows = state
      ? db.prepare("SELECT * FROM agent_sessions WHERE project_id=? AND state=? ORDER BY updated_at DESC,session_id DESC LIMIT ?").all(identity.projectId, state, limit)
      : db.prepare("SELECT * FROM agent_sessions WHERE project_id=? ORDER BY updated_at DESC,session_id DESC LIMIT ?").all(identity.projectId, limit);
    return rows.map((row) => this.row(row));
  }

  transition(project, sessionId, nextState, input = {}) {
    const { db } = this.ensure(project);
    const current = this.get(project, sessionId);
    const next = String(nextState || "").toUpperCase();
    if (!TRANSITIONS[current.state]?.has(next)) {
      if (next === current.state) return current;
      throw brokerError("AGENT_SESSION_TRANSITION_INVALID", `Transición inválida: ${current.state} -> ${next}.`);
    }
    const externalSessionId = input.externalSessionId === undefined
      ? current.externalSessionId
      : input.externalSessionId === null ? null : boundedText(input.externalSessionId, 1000, "externalSessionId");
    const error = input.error ? boundedJson({
      code: input.error.code ? stableId(input.error.code, "error.code") : null,
      message: boundedText(input.error.message || input.error, 4000, "error.message")
    }, 16 * 1024, "error") : { json: null, value: null };
    const now = timestamp();
    db.prepare("UPDATE agent_sessions SET state=?,external_session_id=?,updated_at=?,completed_at=?,error_json=? WHERE session_id=? AND state=?").run(
      next, externalSessionId, now, FINAL_STATES.has(next) ? now : null, error.json, current.sessionId, current.state
    );
    const session = this.get(project, current.sessionId);
    this.publish(session, "AGENT_SESSION_STATE_CHANGED");
    return session;
  }

  start(project, sessionId, input = {}) { return this.transition(project, sessionId, "STARTING", input); }
  markRunning(project, sessionId, input = {}) { return this.transition(project, sessionId, "RUNNING", input); }

  cancel(project, sessionId, input = {}) {
    const session = this.get(project, sessionId);
    if (["CREATED", "PAUSED"].includes(session.state)) return this.transition(project, sessionId, "CANCELLED", input);
    return this.transition(project, sessionId, "CANCELLING", input);
  }

  confirmCancelled(project, sessionId, input = {}) { return this.transition(project, sessionId, "CANCELLED", input); }

  checkpoint(project, sessionId, reason, state = {}, options = {}) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    if (!["STARTING", "RUNNING", "PAUSING", "CHECKPOINTED", "RECOVERING"].includes(session.state)) {
      throw brokerError("AGENT_SESSION_CHECKPOINT_STATE_INVALID", `No se puede crear un checkpoint desde ${session.state}.`);
    }
    const checkpointState = boundedJson(state, 512 * 1024, "checkpoint.state");
    const checkpointId = crypto.randomUUID();
    const createdAt = timestamp();
    const nextState = options.pause === true ? "PAUSED" : "CHECKPOINTED";
    const checkpoint = transaction(db, () => {
      const sequence = Number(db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM agent_session_checkpoints WHERE session_id=?").get(session.sessionId).next);
      if (sequence > LIMITS.checkpointsPerSession) throw brokerError("AGENT_SESSION_CHECKPOINT_LIMIT", "La sesión alcanzó el límite durable de checkpoints y necesita consolidación explícita.");
      const stateHash = hashJson({ sessionId: session.sessionId, sequence, state: checkpointState.value });
      db.prepare(`INSERT INTO agent_session_checkpoints (checkpoint_id,session_id,sequence,reason,state_json,state_hash,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        checkpointId, session.sessionId, sequence, boundedText(reason || "Checkpoint durable", 1000, "checkpoint.reason"), checkpointState.json, stateHash, createdAt
      );
      db.prepare("UPDATE agent_sessions SET state=?,updated_at=? WHERE session_id=? AND state=?").run(nextState, createdAt, session.sessionId, session.state);
      return { schema: "dorn.agent-session-checkpoint/2", checkpointId, sessionId: session.sessionId, sequence, reason: String(reason || "Checkpoint durable").trim(), state: checkpointState.value, stateHash, createdAt };
    });
    const updated = this.get(project, session.sessionId);
    this.publish(updated, "AGENT_SESSION_STATE_CHANGED", { checkpointId });
    return checkpoint;
  }

  pause(project, sessionId, reason, state = {}) { return this.checkpoint(project, sessionId, reason || "Pausa solicitada", state, { pause: true }); }

  resume(project, sessionId, input = {}) {
    const session = this.get(project, sessionId);
    if (!["PAUSED", "CHECKPOINTED", "RECOVERING"].includes(session.state)) throw brokerError("AGENT_SESSION_RESUME_STATE_INVALID", `No se puede reanudar desde ${session.state}.`);
    const checkpoint = this.checkpoints(project, sessionId, 1)[0];
    if (!checkpoint) throw brokerError("AGENT_SESSION_CHECKPOINT_REQUIRED", "Reanudar exige un checkpoint durable.");
    return this.transition(project, sessionId, "STARTING", { ...input, externalSessionId: input.externalSessionId ?? null });
  }

  recover(project, sessionId, input = {}) {
    const session = this.get(project, sessionId);
    if (session.state !== "RECOVERING") throw brokerError("AGENT_SESSION_RECOVERY_STATE_INVALID", "La sesión no está esperando recuperación.");
    const checkpoint = this.checkpoints(project, sessionId, 1)[0];
    if (!checkpoint) throw brokerError("AGENT_SESSION_CHECKPOINT_REQUIRED", "La recuperación automática no repetirá efectos sin un checkpoint.");
    return this.resume(project, sessionId, input);
  }

  checkpoints(project, sessionId, limit = 50) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    return db.prepare("SELECT * FROM agent_session_checkpoints WHERE session_id=? ORDER BY sequence DESC LIMIT ?").all(session.sessionId, safeLimit).map((row) => ({
      schema: "dorn.agent-session-checkpoint/2", checkpointId: row.checkpoint_id, sessionId: row.session_id,
      sequence: Number(row.sequence), reason: row.reason, state: parseStored(row.state_json, {}, "checkpoint.state_json"),
      stateHash: row.state_hash, createdAt: row.created_at
    }));
  }

  attach(project, sessionId, input = {}) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    if (FINAL_STATES.has(session.state)) throw brokerError("AGENT_SESSION_ATTACHMENT_FINAL", "Una sesión finalizada no acepta nuevos attachments.");
    const consumerId = stableId(input.consumerId, "consumerId");
    const consumerKind = stableId(input.consumerKind || "runtime", "consumerKind", { runtime: true });
    const liveAttachments = Number(db.prepare("SELECT COUNT(*) AS total FROM agent_session_attachments WHERE session_id=? AND detached_at IS NULL").get(session.sessionId).total);
    if (liveAttachments >= LIMITS.liveAttachmentsPerSession) throw brokerError("AGENT_SESSION_ATTACHMENT_LIMIT", "La sesión alcanzó el límite de consumidores adjuntos.");
    const attachment = { schema: "dorn.agent-session-attachment/1", attachmentId: crypto.randomUUID(), sessionId: session.sessionId, consumerId, consumerKind, attachedAt: timestamp(), detachedAt: null };
    try {
      db.prepare("INSERT INTO agent_session_attachments(attachment_id,session_id,consumer_id,consumer_kind,attached_at,detached_at) VALUES(?,?,?,?,?,NULL)").run(
        attachment.attachmentId, attachment.sessionId, attachment.consumerId, attachment.consumerKind, attachment.attachedAt
      );
    } catch (error) {
      if (/UNIQUE/i.test(String(error?.message || error))) throw brokerError("AGENT_SESSION_ALREADY_ATTACHED", "El consumidor ya está adjunto a esta sesión.");
      throw error;
    }
    return attachment;
  }

  detach(project, sessionId, consumerId) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    const id = stableId(consumerId, "consumerId");
    const detachedAt = timestamp();
    const result = db.prepare("UPDATE agent_session_attachments SET detached_at=? WHERE session_id=? AND consumer_id=? AND detached_at IS NULL").run(detachedAt, session.sessionId, id);
    if (!result.changes) throw brokerError("AGENT_SESSION_ATTACHMENT_NOT_FOUND", "El consumidor no estaba adjunto a esta sesión.");
    return { sessionId: session.sessionId, consumerId: id, detachedAt };
  }

  attachments(project, sessionId, options = {}) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    const rows = options.includeDetached
      ? db.prepare("SELECT * FROM agent_session_attachments WHERE session_id=? ORDER BY attached_at,attachment_id").all(session.sessionId)
      : db.prepare("SELECT * FROM agent_session_attachments WHERE session_id=? AND detached_at IS NULL ORDER BY attached_at,attachment_id").all(session.sessionId);
    return rows.map((row) => ({ schema: "dorn.agent-session-attachment/1", attachmentId: row.attachment_id, sessionId: row.session_id, consumerId: row.consumer_id, consumerKind: row.consumer_kind, attachedAt: row.attached_at, detachedAt: row.detached_at || null }));
  }

  appendEvent(project, sessionId, input = {}) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    if (FINAL_STATES.has(session.state)) throw brokerError("AGENT_SESSION_STREAM_FINAL", "Una sesión finalizada no acepta eventos nuevos.");
    const eventType = String(input.type || "").toUpperCase();
    if (!STREAM_TYPES.has(eventType)) throw brokerError("AGENT_SESSION_STREAM_TYPE_INVALID", "El tipo de evento de sesión no es reconocido.");
    const payload = boundedJson(input.payload || {}, 128 * 1024, "stream.payload");
    return transaction(db, () => {
      const sequence = Number(db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM agent_session_events WHERE session_id=?").get(session.sessionId).next);
      if (sequence > LIMITS.eventsPerSession) throw brokerError("AGENT_SESSION_STREAM_LIMIT", "La sesión alcanzó el límite durable de eventos y necesita consolidación explícita.");
      const event = { schema: "dorn.agent-session-event/1", eventId: crypto.randomUUID(), sessionId: session.sessionId, sequence, type: eventType, payload: payload.value, createdAt: timestamp() };
      db.prepare("INSERT INTO agent_session_events(event_id,session_id,sequence,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?)").run(event.eventId, event.sessionId, event.sequence, event.type, payload.json, event.createdAt);
      return event;
    });
  }

  stream(project, sessionId, options = {}) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    const after = Math.max(0, Number(options.after) || 0);
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
    return db.prepare("SELECT * FROM agent_session_events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?").all(session.sessionId, after, limit).map((row) => ({
      schema: "dorn.agent-session-event/1", eventId: row.event_id, sessionId: row.session_id, sequence: Number(row.sequence),
      type: row.event_type, payload: parseStored(row.payload_json, {}, "event.payload_json"), createdAt: row.created_at
    }));
  }

  recordUsage(project, sessionId, input = {}) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    if (FINAL_STATES.has(session.state)) throw brokerError("AGENT_SESSION_USAGE_FINAL", "Una sesión finalizada no acepta telemetría nueva.");
    const usage = normalizeUsage(input.usage || {}, session.usage);
    const quota = normalizeQuota(input.quota || {}, session.quota);
    const usageJson = boundedJson(usage, 32 * 1024, "usage");
    const quotaJson = boundedJson(quota, 32 * 1024, "quota");
    transaction(db, () => {
      db.prepare("UPDATE agent_sessions SET usage_json=?,quota_json=?,updated_at=? WHERE session_id=?").run(usageJson.json, quotaJson.json, timestamp(), session.sessionId);
      const sequence = Number(db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM agent_session_events WHERE session_id=?").get(session.sessionId).next);
      if (sequence > LIMITS.eventsPerSession) throw brokerError("AGENT_SESSION_STREAM_LIMIT", "La sesión alcanzó el límite durable de eventos y necesita consolidación explícita.");
      const payload = boundedJson({ usage, quota }, 64 * 1024, "usage.event");
      db.prepare("INSERT INTO agent_session_events(event_id,session_id,sequence,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(), session.sessionId, sequence, "USAGE", payload.json, timestamp());
    });
    return this.get(project, session.sessionId);
  }

  recordHealth(project, sessionId, input = {}) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    const state = String(input.state || "UNKNOWN").toUpperCase();
    if (!HEALTH_STATES.has(state)) throw brokerError("AGENT_SESSION_HEALTH_INVALID", "El estado de salud del runtime no es reconocido.");
    const health = boundedJson({
      state,
      reason: input.reason ? boundedText(input.reason, 2000, "health.reason") : null,
      checkedAt: timestamp()
    }, 16 * 1024, "health");
    db.prepare("UPDATE agent_sessions SET health_json=?,updated_at=? WHERE session_id=?").run(health.json, health.value.checkedAt, session.sessionId);
    return this.get(project, session.sessionId);
  }

  createHandoff(project, sessionId, input = {}) {
    const { identity, db } = this.ensure(project);
    const session = this.get(project, sessionId);
    if (!["CHECKPOINTED", "PAUSED"].includes(session.state)) throw brokerError("AGENT_HANDOFF_CHECKPOINT_REQUIRED", "El handoff exige una sesión pausada o checkpointed para no perder efectos.");
    const checkpoint = this.checkpoints(project, session.sessionId, 1)[0];
    if (!checkpoint) throw brokerError("AGENT_HANDOFF_CHECKPOINT_REQUIRED", "El handoff exige un checkpoint durable.");
    let contextPackSnapshot = null;
    if (session.contextPackId) {
      if (!this.contextCompiler) throw brokerError("AGENT_HANDOFF_CONTEXT_UNAVAILABLE", "El handoff no puede verificar su ContextPack.");
      const validation = this.contextCompiler.validate(identity.project, session.contextPackId);
      if (validation.state !== "FRESH") throw brokerError("AGENT_HANDOFF_CONTEXT_STALE", "El handoff no puede transferir un ContextPack obsoleto.", { validation });
      const currentPack = this.contextCompiler.get(identity.project, session.contextPackId);
      contextPackSnapshot = { contextPackId: currentPack.contextPackId, packHash: currentPack.packHash };
    }
    const toRuntimeId = stableId(input.toRuntimeId, "toRuntimeId", { runtime: true });
    if (toRuntimeId === session.runtimeId) throw brokerError("AGENT_HANDOFF_RUNTIME_UNCHANGED", "Un CrossAgentHandoff necesita una ruta de runtime distinta.");
    const filesChanged = [...new Set(stringList(input.filesChanged || [], "filesChanged", { maximum: 1000, itemMaximum: 4096 }).map((item) => safeRelative(identity.root, item)))].sort();
    const fileSource = sourceHash(identity.root, { relativePaths: filesChanged });
    const evidenceIds = [...new Set(stringList(input.evidence || [], "evidence", { maximum: 200, itemMaximum: 200 }).map((id) => stableId(id, "evidenceId")))];
    if (evidenceIds.length && !this.evidenceCore) throw brokerError("AGENT_HANDOFF_EVIDENCE_UNAVAILABLE", "El handoff declaró Evidence pero Evidence Core no está disponible.");
    const evidence = evidenceIds.map((evidenceId) => {
      const entry = this.evidenceCore.evaluate(identity.project, evidenceId);
      return { evidenceId, truthState: entry.truthState, sourceHash: entry.sourceHash };
    });
    const testsInput = input.testsRun === undefined ? [] : input.testsRun;
    if (!Array.isArray(testsInput) || testsInput.length > 200) throw brokerError("AGENT_HANDOFF_INPUT_INVALID", "testsRun debe ser una lista acotada.");
    const testsRun = testsInput.map(normalizeTestRun);
    if (testsRun.some((test) => test.evidenceId && !evidenceIds.includes(test.evidenceId))) {
      throw brokerError("AGENT_HANDOFF_TEST_EVIDENCE_UNLINKED", "Cada Evidence declarada por un test debe formar parte del handoff.");
    }
    const sequence = Number(db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM agent_handoffs WHERE session_id=?").get(session.sessionId).next);
    if (sequence > LIMITS.handoffsPerSession) throw brokerError("AGENT_HANDOFF_LIMIT", "La sesión alcanzó el límite de handoffs y necesita una nueva Work Unit explícita.");
    const previousHash = db.prepare("SELECT handoff_hash FROM agent_handoffs WHERE session_id=? ORDER BY sequence DESC LIMIT 1").get(session.sessionId)?.handoff_hash || null;
    const createdAt = timestamp();
    const body = {
      schema: "dorn.cross-agent-handoff/2", handoffId: crypto.randomUUID(), sequence,
      projectId: identity.projectId, jobId: session.jobId, workUnitId: session.workUnitId, sessionId: session.sessionId,
      fromRuntimeId: session.runtimeId, toRuntimeId, contextPackId: session.contextPackId,
      contextPackHash: contextPackSnapshot?.packHash || null,
      checkpoint: { checkpointId: checkpoint.checkpointId, sequence: checkpoint.sequence, stateHash: checkpoint.stateHash },
      goal: boundedText(input.goal || session.objective, 20_000, "goal"),
      findings: stringList(input.findings || [], "findings"),
      decisions: stringList(input.decisions || [], "decisions"),
      filesChanged, sourceHash: fileSource.hash, sourceComplete: fileSource.complete,
      patchRefs: stringList(input.patchRefs || [], "patchRefs", { maximum: 200, itemMaximum: 1000 }),
      testsRun, evidence,
      warnings: stringList(input.warnings || [], "warnings"),
      unresolved: stringList(input.unresolved || [], "unresolved"),
      suggestedNextAction: boundedText(input.suggestedNextAction, 8000, "suggestedNextAction"),
      previousHandoffHash: previousHash, createdAt
    };
    boundedJson(body, 1024 * 1024, "handoff");
    const handoff = { ...body, handoffHash: hashJson(body) };
    transaction(db, () => {
      db.prepare("INSERT INTO agent_handoffs(handoff_id,session_id,sequence,previous_hash,handoff_hash,handoff_json,created_at) VALUES(?,?,?,?,?,?,?)").run(
        handoff.handoffId, session.sessionId, sequence, previousHash, handoff.handoffHash, JSON.stringify(handoff), createdAt
      );
      db.prepare("UPDATE agent_sessions SET runtime_id=?,state='RECOVERING',external_session_id=NULL,updated_at=? WHERE session_id=? AND state=?").run(
        toRuntimeId, createdAt, session.sessionId, session.state
      );
    });
    const updated = this.get(project, session.sessionId);
    this.publish(updated, "AGENT_SESSION_HANDOFF_CREATED", { handoffId: handoff.handoffId, fromRuntimeId: session.runtimeId, toRuntimeId });
    return handoff;
  }

  handoffs(project, sessionId, limit = 50) {
    const { db } = this.ensure(project);
    const session = this.get(project, sessionId);
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    return db.prepare("SELECT handoff_json FROM agent_handoffs WHERE session_id=? ORDER BY sequence DESC LIMIT ?").all(session.sessionId, safeLimit).map((row) => parseStored(row.handoff_json, {}, "handoff_json"));
  }

  evaluateHandoff(project, handoffId) {
    const { identity, db } = this.ensure(project);
    const id = stableId(handoffId, "handoffId");
    const row = db.prepare("SELECT session_id,sequence,handoff_json FROM agent_handoffs WHERE handoff_id=?").get(id);
    if (!row) throw brokerError("AGENT_HANDOFF_NOT_FOUND", "El handoff no existe en este proyecto.");
    const handoff = parseStored(row.handoff_json, {}, "handoff_json");
    const { handoffHash, ...body } = handoff;
    const previous = Number(row.sequence) > 1
      ? db.prepare("SELECT handoff_hash FROM agent_handoffs WHERE session_id=? AND sequence=?").get(row.session_id, Number(row.sequence) - 1)
      : null;
    const chainValid = Number(row.sequence) === 1 ? handoff.previousHandoffHash === null : previous?.handoff_hash === handoff.previousHandoffHash;
    const hashValid = hashJson(body) === handoffHash;
    const currentSource = sourceHash(identity.root, { relativePaths: handoff.filesChanged || [] });
    const sourceCurrent = currentSource.hash === handoff.sourceHash && currentSource.complete === handoff.sourceComplete;
    const evidence = (handoff.evidence || []).map((snapshot) => {
      try {
        const current = this.evidenceCore?.evaluate(identity.project, snapshot.evidenceId);
        return { ...snapshot, currentTruthState: current?.truthState || "UNAVAILABLE", currentSourceHash: current?.sourceHash || null, current: Boolean(current && current.truthState === snapshot.truthState && current.sourceHash === snapshot.sourceHash) };
      } catch { return { ...snapshot, currentTruthState: "UNAVAILABLE", currentSourceHash: null, current: false }; }
    });
    const evidenceCurrent = evidence.every((entry) => entry.current);
    let contextCurrent = handoff.contextPackId ? false : true;
    let currentContextPackHash = null;
    if (handoff.contextPackId && this.contextCompiler) {
      try {
        const validation = this.contextCompiler.validate(identity.project, handoff.contextPackId);
        const currentPack = this.contextCompiler.get(identity.project, handoff.contextPackId);
        currentContextPackHash = currentPack.packHash;
        contextCurrent = validation.state === "FRESH" && currentPack.packHash === handoff.contextPackHash;
      } catch { contextCurrent = false; }
    }
    return {
      ...handoff,
      continuityState: hashValid && chainValid && sourceCurrent && evidenceCurrent && contextCurrent && (handoff.sourceComplete || !(handoff.filesChanged || []).length)
        ? (handoff.sourceComplete ? "CURRENT" : "CURRENT_UNSCOPED") : "NEEDS_RETEST",
      hashValid, chainValid, sourceCurrent, currentSourceHash: currentSource.hash, evidenceCurrent, evidence,
      contextCurrent, currentContextPackHash
    };
  }

  close(project) {
    const identity = projectIdentity(project, this.projectCore);
    const db = this.databases.get(identity.root);
    if (!db) return false;
    try { db.close(); } catch {}
    this.databases.delete(identity.root);
    this.databaseOwners.delete(identity.root);
    return true;
  }

  closeAll() {
    for (const db of this.databases.values()) try { db.close(); } catch {}
    this.databases.clear();
    this.databaseOwners.clear();
  }
}

module.exports = {
  AgentSessionBroker, ACTIVE_STATES, FINAL_STATES, INTERRUPTED_STATES, TRANSITIONS,
  LIMITS, boundedJson, normalizeUsage, normalizeQuota, safeRelative
};
