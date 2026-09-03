"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { sourceHash } = require("./evidence-core");

const ACTIVE_JOB_STATES = new Set(["QUEUED", "RUNNING", "CANCELLING"]);
const FINAL_JOB_STATES = new Set(["BLOCKED", "CANCELLED", "COMPLETED", "FAILED", "INTERRUPTED", "PARTIAL"]);
const PRIORITIES = new Set(["INTERACTIVE", "HIGH", "NORMAL", "BACKGROUND", "MAINTENANCE"]);
const PRIORITY_SQL = "CASE priority WHEN 'INTERACTIVE' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 WHEN 'BACKGROUND' THEN 3 ELSE 4 END";

function jobError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function timestamp() { return new Date().toISOString(); }

function safeJson(value, maximum, label, fallback) {
  const json = JSON.stringify(value === undefined ? fallback : value);
  if (Buffer.byteLength(json, "utf8") > maximum) throw jobError("JOB_INPUT_TOO_LARGE", `${label} excede el límite seguro.`);
  return json;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return structuredClone(fallback); }
}

function safeMessage(error) {
  return String(error?.message || error || "Fallo desconocido")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, "[OCULTO]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [OCULTO]")
    .replace(/\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[OCULTO]")
    .slice(0, 4000);
}

function projectIdentity(project, projectCore) {
  const projectId = String(project?.id || project?.projectId || "").trim();
  if (!projectId || !/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) throw jobError("JOB_PROJECT_ID_INVALID", "El Job necesita una identidad de proyecto válida.");
  const requestedRoot = String(project?.rootPath || project?.root || "");
  let root;
  try { root = fs.realpathSync(requestedRoot); } catch { throw jobError("JOB_PROJECT_ROOT_INVALID", "La carpeta del proyecto ya no está disponible."); }
  const probe = projectCore?.probe(root);
  if (!probe || probe.status !== "READY" || probe.manifest?.projectId !== projectId) {
    throw jobError("JOB_PROJECT_IDENTITY_MISMATCH", "El Job no pertenece a la identidad adoptada de esta carpeta.");
  }
  const tasksRoot = path.join(root, ".dorn", "tasks");
  const tasksStat = fs.lstatSync(tasksRoot);
  if (!tasksStat.isDirectory() || tasksStat.isSymbolicLink() || path.dirname(fs.realpathSync(tasksRoot)) !== fs.realpathSync(path.join(root, ".dorn"))) {
    throw jobError("JOB_METADATA_UNSAFE", ".dorn/tasks no es una carpeta de metadatos segura.");
  }
  return { projectId, root, tasksRoot, project: { ...project, id: projectId, rootPath: root } };
}

function safeRelative(root, rawPath) {
  const input = String(rawPath ?? "");
  if (!input || input.includes("\0") || path.isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input)) {
    throw jobError("JOB_SCOPE_PATH_UNSAFE", "Change Scope recibió una ruta absoluta o vacía.");
  }
  const normalized = input.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw jobError("JOB_SCOPE_PATH_UNSAFE", "Change Scope recibió una ruta insegura.");
  }
  const absolute = path.resolve(root, ...normalized.split("/"));
  if (!absolute.startsWith(`${root}${path.sep}`)) throw jobError("JOB_SCOPE_PATH_UNSAFE", "Change Scope intentó salir del proyecto.");
  return normalized;
}

function normalizeScope(identity, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw jobError("JOB_SCOPE_INVALID", "Change Scope debe ser estructurado.");
  if (input.expectedFiles !== undefined && !Array.isArray(input.expectedFiles)) throw jobError("JOB_SCOPE_INVALID", "expectedFiles debe ser una lista explícita.");
  const expectedFiles = [...new Set((input.expectedFiles || []).map((item) => safeRelative(identity.root, item)))].sort();
  if (expectedFiles.length > 2000) throw jobError("JOB_SCOPE_TOO_LARGE", "Change Scope contiene demasiados archivos.");
  const mutatesProject = input.mutatesProject === true;
  if (mutatesProject && !expectedFiles.length) throw jobError("JOB_SCOPE_REQUIRED", "Un Job que modifica el proyecto necesita archivos esperados explícitos.");
  const baseline = sourceHash(identity.root, { relativePaths: expectedFiles });
  return {
    schema: "dorn.change-scope/1",
    projectId: identity.projectId,
    mutatesProject,
    expectedFiles,
    baselineHash: baseline.hash,
    baselineComplete: baseline.complete
  };
}

function rowToJob(row) {
  if (!row) return null;
  return {
    schema: "dorn.job/1",
    id: String(row.id), projectId: String(row.project_id), conversationId: row.conversation_id || null,
    type: String(row.type), state: String(row.state), priority: String(row.priority),
    goal: String(row.goal), payload: parseJson(row.payload_json, {}), scope: parseJson(row.scope_json, {}),
    successContract: parseJson(row.success_contract_json, {}), result: row.result_json ? parseJson(row.result_json, null) : null,
    error: row.error_json ? parseJson(row.error_json, null) : null, progress: row.progress_json ? parseJson(row.progress_json, null) : null,
    idempotencyKey: row.idempotency_key || null, attempt: Number(row.attempt), maxAttempts: Number(row.max_attempts),
    createdAt: row.created_at, updatedAt: row.updated_at, startedAt: row.started_at || null, finishedAt: row.finished_at || null
  };
}

class DurableJobRuntime {
  constructor(options = {}) {
    if (!options.projectCore) throw new Error("Durable Job Runtime necesita Project Core.");
    this.projectCore = options.projectCore;
    this.evidenceCore = options.evidenceCore || null;
    this.eventBus = options.eventBus || null;
    this.stateCore = options.stateCore || null;
    this.maxConcurrency = Math.max(1, Math.min(8, Number(options.maxConcurrency) || 2));
  }

  projectCore;
  evidenceCore;
  eventBus;
  stateCore;
  maxConcurrency;
  databases = new Map();
  databaseOwners = new Map();
  projects = new Map();
  executors = new Map();
  running = new Map();
  launching = new Set();
  pumpScheduled = false;
  stopping = false;

  databasePath(identity) { return path.join(identity.tasksRoot, "jobs.db"); }

  open(identity) {
    const databasePath = this.databasePath(identity);
    if (fs.existsSync(databasePath)) {
      const stat = fs.lstatSync(databasePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw jobError("JOB_METADATA_UNSAFE", "La base de Jobs no es un archivo regular seguro.");
    }
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        PRAGMA busy_timeout=3000;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS job_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT, type TEXT NOT NULL,
          state TEXT NOT NULL, priority TEXT NOT NULL, goal TEXT NOT NULL, payload_json TEXT NOT NULL,
          scope_json TEXT NOT NULL, success_contract_json TEXT NOT NULL, result_json TEXT, error_json TEXT,
          progress_json TEXT, idempotency_key TEXT UNIQUE, attempt INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 1, next_attempt_at INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS job_dependencies (
          job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          depends_on_job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          PRIMARY KEY(job_id, depends_on_job_id)
        );
        CREATE TABLE IF NOT EXISTS job_checkpoints (
          id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          reason TEXT NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(state, priority, created_at);
        CREATE INDEX IF NOT EXISTS idx_job_dependencies_target ON job_dependencies(depends_on_job_id, job_id);
        CREATE INDEX IF NOT EXISTS idx_job_checkpoints_job ON job_checkpoints(job_id, created_at DESC);
      `);
      const owner = db.prepare("SELECT value FROM job_metadata WHERE key='project_id'").get()?.value || null;
      const rowOwners = db.prepare("SELECT DISTINCT project_id FROM jobs").all().map((item) => String(item.project_id));
      if ((owner && owner !== identity.projectId) || rowOwners.some((item) => item !== identity.projectId)) {
        throw jobError("JOB_PROJECT_IDENTITY_MISMATCH", "La base durable de Jobs pertenece a otro proyecto.");
      }
      if (!owner) db.prepare("INSERT INTO job_metadata(key,value) VALUES('project_id',?)").run(identity.projectId);
      const interruptedAt = timestamp();
      db.prepare(`UPDATE jobs SET state='INTERRUPTED',error_json=?,updated_at=?,finished_at=?
        WHERE state IN ('STARTING','RUNNING','CANCELLING')`).run(
        JSON.stringify({ code: "RESTART_REVIEW_REQUIRED", message: "DORN se cerró durante el trabajo. Revisa el alcance y decide si debe reintentarse." }),
        interruptedAt, interruptedAt
      );
    } catch (error) { try { db.close(); } catch {} throw error; }
    return db;
  }

  ensure(project) {
    const identity = projectIdentity(project, this.projectCore);
    if (this.databases.has(identity.root)) {
      if (this.databaseOwners.get(identity.root) !== identity.projectId) throw jobError("JOB_PROJECT_IDENTITY_MISMATCH", "La base abierta pertenece a otra identidad.");
      return { identity, db: this.databases.get(identity.root) };
    }
    const db = this.open(identity);
    this.databases.set(identity.root, db);
    this.databaseOwners.set(identity.root, identity.projectId);
    this.projects.set(identity.root, identity.project);
    return { identity, db };
  }

  register(type, handler, options = {}) {
    const name = String(type || "").trim();
    if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(name) || typeof handler !== "function") throw jobError("JOB_EXECUTOR_INVALID", "El executor necesita un tipo estable y un handler.");
    this.executors.set(name, {
      handler,
      idempotent: options.idempotent === true,
      recoveryCheck: typeof options.recoveryCheck === "function" ? options.recoveryCheck : null
    });
    this.schedulePump();
    return this;
  }

  enqueue(project, request = {}) {
    const { identity, db } = this.ensure(project);
    const type = String(request.type || "").trim();
    if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(type)) throw jobError("JOB_TYPE_INVALID", "El Job necesita un tipo estable.");
    const scope = normalizeScope(identity, request.scope || {});
    const priority = String(request.priority || "NORMAL").toUpperCase();
    if (!PRIORITIES.has(priority)) throw jobError("JOB_PRIORITY_INVALID", "El Job recibió una prioridad desconocida.");
    const idempotencyKey = request.idempotencyKey ? String(request.idempotencyKey).trim().slice(0, 300) : null;
    if (idempotencyKey) {
      const existing = db.prepare("SELECT * FROM jobs WHERE idempotency_key=?").get(idempotencyKey);
      if (existing) return this.attach(db, rowToJob(existing));
    }
    const dependsOn = [...new Set((Array.isArray(request.dependsOn) ? request.dependsOn : []).map(String))];
    const id = crypto.randomUUID();
    const createdAt = timestamp();
    const successContract = {
      schema: "dorn.job-success/1",
      requiresVerifiedEvidence: request.successContract?.requiresVerifiedEvidence !== false,
      requiresIndependentTest: request.successContract?.requiresIndependentTest !== false,
      description: String(request.successContract?.description || "El resultado debe estar probado sobre los mismos bytes.").slice(0, 2000)
    };
    const maxAttempts = Math.max(1, Math.min(3, Number(request.maxAttempts) || 1));
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const dependencyId of dependsOn) {
        if (!db.prepare("SELECT id FROM jobs WHERE id=?").get(dependencyId)) throw jobError("JOB_DEPENDENCY_UNKNOWN", `Dependencia desconocida: ${dependencyId}`);
      }
      db.prepare(`INSERT INTO jobs (
        id,project_id,conversation_id,type,state,priority,goal,payload_json,scope_json,success_contract_json,
        idempotency_key,max_attempts,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, identity.projectId, request.conversationId || null, type, "QUEUED", priority,
        String(request.goal || type).slice(0, 4000), safeJson(request.payload, 512 * 1024, "El payload", {}),
        safeJson(scope, 256 * 1024, "Change Scope", {}), safeJson(successContract, 64 * 1024, "El contrato de éxito", {}),
        idempotencyKey || null, maxAttempts, createdAt, createdAt
      );
      const insertDependency = db.prepare("INSERT INTO job_dependencies(job_id,depends_on_job_id) VALUES(?,?)");
      for (const dependencyId of dependsOn) insertDependency.run(id, dependencyId);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    const job = this.get(project, id);
    this.stateCore?.bindJob(job);
    void this.emit("JOB_QUEUED", job, `job-queued:${id}`);
    this.schedulePump();
    return job;
  }

  attach(db, job) {
    if (!job) return null;
    job.dependencies = db.prepare(`SELECT j.id,j.type,j.state,j.updated_at
      FROM job_dependencies d JOIN jobs j ON j.id=d.depends_on_job_id WHERE d.job_id=? ORDER BY j.created_at`).all(job.id)
      .map((row) => ({ id: row.id, type: row.type, state: row.state, updatedAt: row.updated_at }));
    job.checkpoints = db.prepare("SELECT id,reason,state_json,created_at FROM job_checkpoints WHERE job_id=? ORDER BY created_at DESC LIMIT 100").all(job.id)
      .map((row) => ({ id: row.id, reason: row.reason, state: parseJson(row.state_json, {}), createdAt: row.created_at }));
    return job;
  }

  get(project, id) {
    const { identity, db } = this.ensure(project);
    const job = this.attach(db, rowToJob(db.prepare("SELECT * FROM jobs WHERE id=? AND project_id=?").get(String(id), identity.projectId)));
    if (!job) throw jobError("JOB_NOT_FOUND", "El Job no existe dentro de este proyecto.");
    return job;
  }

  list(project, options = {}) {
    const { identity, db } = this.ensure(project);
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    const states = Array.isArray(options.states) ? [...new Set(options.states.map((item) => String(item).toUpperCase()))] : [];
    if (states.length) {
      const placeholders = states.map(() => "?").join(",");
      return db.prepare(`SELECT * FROM jobs WHERE project_id=? AND state IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`).all(identity.projectId, ...states, limit).map(rowToJob);
    }
    return db.prepare("SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT ?").all(identity.projectId, limit).map(rowToJob);
  }

  checkpoint(project, id, reason, state = {}) {
    const { db } = this.ensure(project);
    const job = this.get(project, id);
    if (!ACTIVE_JOB_STATES.has(job.state)) throw jobError("JOB_CHECKPOINT_INACTIVE", "Sólo un Job activo puede crear checkpoints.");
    const record = { id: crypto.randomUUID(), reason: String(reason || "checkpoint").slice(0, 1000), state, createdAt: timestamp() };
    db.prepare("INSERT INTO job_checkpoints(id,job_id,reason,state_json,created_at) VALUES(?,?,?,?,?)").run(
      record.id, job.id, record.reason, safeJson(state, 256 * 1024, "El checkpoint", {}), record.createdAt
    );
    return record;
  }

  cancel(project, id) {
    const { db } = this.ensure(project);
    const job = this.get(project, id);
    if (!ACTIVE_JOB_STATES.has(job.state)) return job;
    const key = `${job.projectId}:${job.id}`;
    const now = timestamp();
    if (job.state === "RUNNING") {
      db.prepare("UPDATE jobs SET state='CANCELLING',updated_at=? WHERE id=?").run(now, job.id);
      const reason = jobError("JOB_CANCELLED", "Job cancelado por la persona.");
      this.running.get(key)?.abort(reason);
    } else {
      db.prepare("UPDATE jobs SET state='CANCELLED',error_json=?,updated_at=?,finished_at=? WHERE id=?").run(
        JSON.stringify({ code: "JOB_CANCELLED", message: "Cancelado antes de iniciar." }), now, now, job.id
      );
    }
    return this.get(project, id);
  }

  async reviewInterrupted(project, id, input = {}) {
    const { db } = this.ensure(project);
    const job = this.get(project, id);
    if (job.state !== "INTERRUPTED") throw jobError("JOB_REVIEW_NOT_REQUIRED", "El Job no está esperando revisión de recuperación.");
    const decision = String(input.decision || "").toUpperCase();
    if (decision === "CANCEL") {
      const now = timestamp();
      db.prepare("UPDATE jobs SET state='CANCELLED',error_json=?,updated_at=?,finished_at=? WHERE id=?").run(
        JSON.stringify({ code: "RECOVERY_CANCELLED", message: "La persona decidió no repetir el trabajo interrumpido." }), now, now, job.id
      );
      return this.get(project, id);
    }
    if (decision !== "RETRY") throw jobError("JOB_REVIEW_DECISION_INVALID", "Decide RETRY o CANCEL de forma explícita.");
    const executor = this.executors.get(job.type);
    if (!executor) throw jobError("JOB_EXECUTOR_MISSING", "No existe executor para revisar este Job.");
    let safe = executor.idempotent;
    let recovery = { safe, reason: safe ? "Executor idempotente" : "" };
    if (!safe && executor.recoveryCheck) recovery = await executor.recoveryCheck({ job, project: projectIdentity(project, this.projectCore).project, input });
    if (recovery?.safe !== true) throw jobError("JOB_RECOVERY_UNSAFE", recovery?.reason || "No existe evidencia suficiente para repetir efectos.");
    this.checkpointForDb(db, job.id, "Reintento autorizado después de revisión", { decision: "RETRY", evidenceIds: recovery.evidenceIds || [] });
    const now = timestamp();
    db.prepare("UPDATE jobs SET state='QUEUED',error_json=NULL,finished_at=NULL,next_attempt_at=0,updated_at=? WHERE id=?").run(now, job.id);
    this.schedulePump();
    return this.get(project, id);
  }

  checkpointForDb(db, jobId, reason, state) {
    db.prepare("INSERT INTO job_checkpoints(id,job_id,reason,state_json,created_at) VALUES(?,?,?,?,?)").run(
      crypto.randomUUID(), jobId, String(reason).slice(0, 1000), safeJson(state, 256 * 1024, "El checkpoint", {}), timestamp()
    );
  }

  async wait(project, id, options = {}) {
    const timeoutMs = Math.max(100, Math.min(30 * 60 * 1000, Number(options.timeoutMs) || 60_000));
    const started = Date.now();
    for (;;) {
      const job = this.get(project, id);
      if (!ACTIVE_JOB_STATES.has(job.state)) return job;
      if (options.signal?.aborted) throw options.signal.reason || jobError("JOB_WAIT_CANCELLED", "Espera cancelada.");
      if (Date.now() - started >= timeoutMs) throw jobError("JOB_WAIT_TIMEOUT", "El Job sigue activo después del tiempo máximo.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  schedulePump() {
    if (this.pumpScheduled || this.stopping) return;
    this.pumpScheduled = true;
    queueMicrotask(() => { this.pumpScheduled = false; void this.pump(); });
  }

  async pump() {
    if (this.stopping) return;
    while (this.running.size + this.launching.size < this.maxConcurrency) {
      let selected = null;
      for (const [root, db] of this.databases) {
        const rows = db.prepare(`SELECT * FROM jobs WHERE state='QUEUED' AND next_attempt_at<=? ORDER BY ${PRIORITY_SQL},created_at LIMIT 50`).all(Date.now());
        for (const row of rows) {
          const key = `${row.project_id}:${row.id}`;
          if (this.running.has(key) || this.launching.has(key)) continue;
          const dependencies = db.prepare("SELECT j.id,j.state FROM job_dependencies d JOIN jobs j ON j.id=d.depends_on_job_id WHERE d.job_id=?").all(row.id);
          const failed = dependencies.find((dependency) => FINAL_JOB_STATES.has(String(dependency.state)) && dependency.state !== "COMPLETED");
          if (failed) {
            this.finish(db, this.projects.get(root), row.id, "BLOCKED", null, { code: "JOB_DEPENDENCY_FAILED", message: `La dependencia ${failed.id} terminó en ${failed.state}.` });
            continue;
          }
          if (dependencies.some((dependency) => dependency.state !== "COMPLETED")) continue;
          if (!this.executors.has(row.type)) continue;
          const candidate = { root, db, project: this.projects.get(root), job: rowToJob(row), key };
          if (!selected || this.compare(candidate.job, selected.job) < 0) selected = candidate;
          break;
        }
      }
      if (!selected) return;
      this.launching.add(selected.key);
      void this.run(selected);
    }
  }

  compare(left, right) {
    const priorities = { INTERACTIVE: 0, HIGH: 1, NORMAL: 2, BACKGROUND: 3, MAINTENANCE: 4 };
    return (priorities[left.priority] - priorities[right.priority]) || String(left.createdAt).localeCompare(String(right.createdAt));
  }

  async completion(project, job, result) {
    if (result?.successContractSatisfied !== true) return { completed: false, code: "SUCCESS_CONTRACT_UNSATISFIED", message: "El executor no declaró satisfecho el contrato de éxito." };
    if (job.successContract.requiresVerifiedEvidence === false) return { completed: true };
    if (!this.evidenceCore) return { completed: false, code: "VERIFIED_EVIDENCE_REQUIRED", message: "Evidence Core no está disponible." };
    const evidenceIds = [...new Set((Array.isArray(result.evidenceIds) ? result.evidenceIds : []).map(String))];
    if (!evidenceIds.length) return { completed: false, code: "VERIFIED_EVIDENCE_REQUIRED", message: "El Job no aportó Evidence verificable." };
    let lineage;
    try { lineage = this.evidenceCore.lineage(project, { reference: job.id, limit: 500 }); }
    catch (error) { return { completed: false, code: error.code || "EVIDENCE_LOOKUP_FAILED", message: safeMessage(error) }; }
    const linked = new Set(lineage.entries.map((entry) => entry.evidenceId));
    const expected = job.scope.expectedFiles || [];
    const current = sourceHash(project.rootPath, { relativePaths: expected });
    for (const evidenceId of evidenceIds) {
      let evidence;
      try { evidence = this.evidenceCore.evaluate(project, evidenceId); }
      catch (error) { return { completed: false, code: error.code || "EVIDENCE_LOOKUP_FAILED", message: safeMessage(error) }; }
      if (!linked.has(evidenceId)) return { completed: false, code: "EVIDENCE_NOT_LINKED_TO_JOB", message: "La Evidence no está enlazada al Job exacto." };
      if (evidence.truthState !== "VERIFIED") return { completed: false, code: "EVIDENCE_NOT_VERIFIED", message: `Evidence ${evidenceId} quedó en ${evidence.truthState}.` };
      if (job.successContract.requiresIndependentTest && evidence.environment?.independent !== true) {
        return { completed: false, code: "INDEPENDENT_TEST_REQUIRED", message: "La prueba no se declaró independiente del executor." };
      }
      const files = [...new Set(evidence.sourceFiles || [])].sort();
      if (JSON.stringify(files) !== JSON.stringify(expected) || evidence.sourceHash !== current.hash || !current.complete) {
        return { completed: false, code: "TESTED_BYTES_MISMATCH", message: "La Evidence no observa exactamente los archivos y bytes actuales del Change Scope." };
      }
    }
    return { completed: true, sourceHash: current.hash, evidenceIds };
  }

  async run(context) {
    const { db, project, job, key } = context;
    const executor = this.executors.get(job.type);
    if (!executor || this.stopping) { this.launching.delete(key); return; }
    const controller = new AbortController();
    this.running.set(key, controller);
    this.launching.delete(key);
    const startedAt = timestamp();
    db.prepare("UPDATE jobs SET state='RUNNING',attempt=attempt+1,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND state='QUEUED'").run(startedAt, startedAt, job.id);
    const runningJob = this.get(project, job.id);
    this.stateCore?.bindJob(runningJob);
    await this.emit("JOB_STARTED", runningJob, `job-started:${job.id}:${runningJob.attempt}`);
    let lastProgress = null;
    let repeated = 0;
    try {
      const result = await executor.handler({
        project, job: runningJob, signal: controller.signal,
        checkpoint: (reason, state) => this.checkpoint(project, job.id, reason, state),
        progress: (value) => {
          const serialized = safeJson(value, 128 * 1024, "El progreso", {});
          repeated = serialized === lastProgress ? repeated + 1 : 0;
          lastProgress = serialized;
          if (repeated >= 8) throw jobError("JOB_NON_PROGRESS", "El Job repitió el mismo progreso sin avanzar.");
          db.prepare("UPDATE jobs SET progress_json=?,updated_at=? WHERE id=?").run(serialized, timestamp(), job.id);
        }
      });
      if (controller.signal.aborted) this.finish(db, project, job.id, "CANCELLED", null, { code: "JOB_CANCELLED", message: "Job cancelado." });
      else {
        const gate = await this.completion(project, this.get(project, job.id), result || {});
        this.finish(db, project, job.id, gate.completed ? "COMPLETED" : "PARTIAL", { ...(result || {}), completionGate: gate }, gate.completed ? null : { code: gate.code, message: gate.message });
      }
    } catch (error) {
      if (this.stopping) return;
      const current = this.get(project, job.id);
      const retryable = executor.idempotent && error?.retryable === true && current.attempt < current.maxAttempts && !controller.signal.aborted;
      if (retryable) {
        const backoffMs = Math.min(30_000, 250 * 2 ** Math.max(0, current.attempt - 1));
        this.checkpointForDb(db, job.id, "Fallo recuperable antes de reintentar", { code: error.code || "JOB_RETRY", message: safeMessage(error), backoffMs });
        db.prepare("UPDATE jobs SET state='QUEUED',error_json=?,next_attempt_at=?,updated_at=? WHERE id=?").run(
          JSON.stringify({ code: error.code || "JOB_RETRY", message: safeMessage(error) }), Date.now() + backoffMs, timestamp(), job.id
        );
        const timer = setTimeout(() => this.schedulePump(), backoffMs + 5);
        timer.unref?.();
      } else {
        this.finish(db, project, job.id, controller.signal.aborted ? "CANCELLED" : "FAILED", null, { code: error.code || "JOB_FAILED", message: safeMessage(error) });
      }
    } finally {
      this.running.delete(key);
      this.launching.delete(key);
      this.schedulePump();
    }
  }

  finish(db, project, id, state, result, error) {
    if (!FINAL_JOB_STATES.has(state)) throw jobError("JOB_FINAL_STATE_INVALID", "Estado final de Job inválido.");
    const finishedAt = timestamp();
    db.prepare("UPDATE jobs SET state=?,result_json=?,error_json=?,updated_at=?,finished_at=? WHERE id=?").run(
      state, result ? safeJson(result, 1024 * 1024, "El resultado", {}) : null,
      error ? safeJson(error, 64 * 1024, "El error", {}) : null, finishedAt, finishedAt, id
    );
    const job = this.get(project, id);
    this.stateCore?.bindJob(job);
    void this.emit("JOB_STATE_CHANGED", job, `job-state:${id}:${state}:${finishedAt}`);
    return job;
  }

  async emit(type, job, idempotencyKey) {
    if (!this.eventBus) return null;
    return this.eventBus.publish(type, { jobId: job.id, type: job.type, state: job.state, progress: job.progress || null }, {
      projectId: job.projectId, conversationId: job.conversationId, jobId: job.id, idempotencyKey
    });
  }

  closeAll() {
    this.stopping = true;
    const stoppedAt = timestamp();
    for (const controller of this.running.values()) controller.abort(jobError("JOB_SHUTDOWN", "DORN se está cerrando; el Job requiere revisión al volver."));
    for (const db of this.databases.values()) {
      try {
        db.prepare(`UPDATE jobs SET state='INTERRUPTED',error_json=?,updated_at=?,finished_at=? WHERE state IN ('STARTING','RUNNING','CANCELLING')`).run(
          JSON.stringify({ code: "RESTART_REVIEW_REQUIRED", message: "DORN se cerró durante el trabajo. Revisa antes de reintentar." }), stoppedAt, stoppedAt
        );
        db.close();
      } catch {}
    }
    this.databases.clear();
    this.databaseOwners.clear();
    this.projects.clear();
  }
}

module.exports = { DurableJobRuntime, ACTIVE_JOB_STATES, FINAL_JOB_STATES, normalizeScope, projectIdentity };
