"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { containsSecret } = require("./policy-engine");

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const POSITIVE_TRUTH = new Set(["VERIFIED", "PACKAGED", "INSTALLED", "PUBLISHED"]);
const MODES = new Set(["OFFICIAL", "SHADOW", "CANDIDATE"]);

function routerError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function digest(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function iso(now = Date.now()) { return new Date(now).toISOString(); }
function id(value, label) {
  const normalized = String(value || "").trim();
  if (!SAFE_ID.test(normalized)) throw routerError("BENCHMARK_ID_INVALID", `${label} inválido.`);
  return normalized;
}
function hash(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256.test(normalized)) throw routerError("BENCHMARK_HASH_INVALID", `${label} necesita SHA-256 exacto.`);
  return normalized;
}
function text(value, label, maximum = 300) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum || /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized)) {
    throw routerError("BENCHMARK_FIELD_INVALID", `${label} inválido.`);
  }
  if (containsSecret(normalized)) throw routerError("BENCHMARK_SECRET_REJECTED", `${label} parece contener material sensible.`);
  return normalized;
}
function optionalText(value, label, maximum = 300) { return value === null || value === undefined || String(value).trim() === "" ? null : text(value, label, maximum); }
function bounded(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}
function list(value, label, maximum = 64) {
  if (value !== undefined && !Array.isArray(value)) throw routerError("BENCHMARK_LIST_INVALID", `${label} debe ser una lista.`);
  const result = [...new Set((value || []).map((entry) => text(entry, label, 200)))].sort();
  if (result.length > maximum) throw routerError("BENCHMARK_LIST_TOO_LARGE", `${label} excede el límite.`);
  return result;
}
function parse(value, fallback) { try { return JSON.parse(value); } catch { return structuredClone(fallback); } }

function normalizeCombination(input = {}) {
  const normalized = {
    model: text(input.model || input.modelId, "model", 300),
    harness: text(input.harness || input.harnessId, "harness", 300),
    accessRoute: text(input.accessRoute || input.route || input.routeId, "accessRoute", 300),
    skills: list(input.skills, "skills"),
    tools: list(input.tools, "tools"),
    contextStrategy: text(input.contextStrategy || "conversation-bounded-v1", "contextStrategy", 200)
  };
  if (containsSecret(JSON.stringify(normalized))) throw routerError("BENCHMARK_SECRET_REJECTED", "La combinación contiene material sensible.");
  return { normalized, comboKey: digest(JSON.stringify(normalized)) };
}

function observationMetrics(rows = []) {
  const verified = rows.filter((row) => row.mode === "OFFICIAL" && ["SUCCEEDED", "FAILED"].includes(row.state) && row.verified && row.independent);
  if (!verified.length) return {
    score: null, verifiedSamples: 0, successRate: null, averageQuality: null,
    averageLatencyMs: null, averageCostUsd: null, costSamples: 0
  };
  const successes = verified.filter((row) => row.success);
  const average = (items, field) => items.length ? items.reduce((sum, row) => sum + Number(row[field] || 0), 0) / items.length : null;
  const costRows = verified.filter((row) => row.cost_usd !== null);
  const successRate = successes.length / verified.length;
  const quality = average(verified, "quality");
  const latency = average(verified, "latency_ms");
  const cost = average(costRows, "cost_usd");
  const confidence = verified.length / (verified.length + 3);
  const raw = successRate * 55 + quality * 35 - Math.min(7, latency / 15_000) - (cost === null ? 0 : Math.min(3, cost));
  return {
    score: raw * (0.7 + confidence * 0.3), verifiedSamples: verified.length, successRate,
    averageQuality: quality, averageLatencyMs: latency, averageCostUsd: cost, costSamples: costRows.length
  };
}

class IntelligenceBenchmarkRouter {
  constructor(options = {}) {
    this.filePath = options.filePath || ":memory:";
    this.ownerId = id(options.ownerId || "dorn-ai", "ownerId");
    this.resolveEvidence = typeof options.resolveEvidence === "function" ? options.resolveEvidence : null;
    this.resolveIsolation = typeof options.resolveIsolation === "function" ? options.resolveIsolation : null;
    this.clock = typeof options.clock === "function" ? options.clock : Date.now;
    if (this.filePath !== ":memory:") {
      const parent = path.dirname(path.resolve(this.filePath));
      const parentStat = fs.lstatSync(parent);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw routerError("BENCHMARK_STORAGE_UNSAFE", "La carpeta del Router de benchmarking no es segura.");
      if (fs.existsSync(this.filePath)) {
        const stat = fs.lstatSync(this.filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw routerError("BENCHMARK_STORAGE_UNSAFE", "El registro de benchmarking no puede ser un enlace.");
      }
    }
    this.db = new DatabaseSync(this.filePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;");
    this.migrate();
    this.assertOwner();
    this.recover();
  }

  filePath; ownerId; resolveEvidence; resolveIsolation; clock; db;

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS benchmark_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS benchmark_combinations(
        combo_key TEXT PRIMARY KEY,combo_json TEXT NOT NULL,model_id TEXT NOT NULL,harness_id TEXT NOT NULL,
        access_route_id TEXT NOT NULL,context_strategy_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS benchmark_observations(
        observation_id TEXT PRIMARY KEY,project_scope TEXT NOT NULL,task_kind TEXT NOT NULL,
        combo_key TEXT NOT NULL REFERENCES benchmark_combinations(combo_key),mode TEXT NOT NULL,state TEXT NOT NULL,
        work_unit_id TEXT,task_fingerprint TEXT NOT NULL,source_hash TEXT,isolation_id TEXT,
        success INTEGER,quality REAL,latency_ms REAL,cost_usd REAL,verified INTEGER NOT NULL DEFAULT 0,
        independent INTEGER NOT NULL DEFAULT 0,evidence_id TEXT,evidence_hash TEXT,revision_hash TEXT,
        evaluator_id TEXT,output_hash TEXT,failure_family TEXT,created_at TEXT NOT NULL,finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_benchmark_task ON benchmark_observations(project_scope,task_kind,combo_key,mode,state);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_evidence_once ON benchmark_observations(evidence_id) WHERE evidence_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS benchmark_experiments(
        experiment_id TEXT PRIMARY KEY,project_scope TEXT NOT NULL,work_unit_id TEXT NOT NULL,mode TEXT NOT NULL,
        baseline_combo_key TEXT NOT NULL REFERENCES benchmark_combinations(combo_key),
        candidate_combo_key TEXT NOT NULL REFERENCES benchmark_combinations(combo_key),task_kind TEXT NOT NULL,
        task_fingerprint TEXT NOT NULL,source_hash TEXT NOT NULL,isolation_id TEXT NOT NULL,
        candidate_observation_id TEXT,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS benchmark_events(
        event_id TEXT PRIMARY KEY,type TEXT NOT NULL,reference_id TEXT,detail_json TEXT NOT NULL,created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_benchmark_events ON benchmark_events(created_at DESC,event_id DESC);
    `);
  }

  assertOwner() {
    const owner = this.db.prepare("SELECT value FROM benchmark_metadata WHERE key='owner_id'").get()?.value || null;
    if (owner && owner !== this.ownerId) throw routerError("BENCHMARK_OWNER_MISMATCH", "El registro de benchmarking pertenece a otra identidad.");
    if (!owner) this.db.prepare("INSERT INTO benchmark_metadata(key,value) VALUES('owner_id',?)").run(this.ownerId);
  }

  recover() {
    const timestamp = iso(this.clock());
    const observations = Number(this.db.prepare("UPDATE benchmark_observations SET state='ABANDONED',finished_at=? WHERE state='RUNNING'").run(timestamp).changes);
    const experiments = Number(this.db.prepare("UPDATE benchmark_experiments SET state='INTERRUPTED',updated_at=? WHERE state='RUNNING'").run(timestamp).changes);
    if (observations || experiments) this.event("RECOVERY_COMPLETED", null, { observations, experiments });
    return { observations, experiments };
  }

  event(type, referenceId, detail = {}) {
    const safeDetail = JSON.parse(JSON.stringify(detail, (key, value) => /api.?key|authorization|password|secret|token/i.test(key) ? "[REDACTED]" : value));
    if (containsSecret(JSON.stringify(safeDetail))) throw routerError("BENCHMARK_SECRET_REJECTED", "Un evento del Router contiene material sensible.");
    this.db.prepare("INSERT INTO benchmark_events(event_id,type,reference_id,detail_json,created_at) VALUES(?,?,?,?,?)")
      .run(crypto.randomUUID(), text(type, "eventType", 100), referenceId ? String(referenceId).slice(0, 300) : null, JSON.stringify(safeDetail).slice(0, 64 * 1024), iso(this.clock()));
    this.db.prepare("DELETE FROM benchmark_events WHERE event_id IN (SELECT event_id FROM benchmark_events ORDER BY created_at DESC,event_id DESC LIMIT -1 OFFSET 10000)").run();
  }

  combination(input) {
    const { normalized, comboKey } = normalizeCombination(input);
    const timestamp = iso(this.clock());
    this.db.prepare(`INSERT INTO benchmark_combinations(
      combo_key,combo_json,model_id,harness_id,access_route_id,context_strategy_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(combo_key) DO UPDATE SET combo_json=excluded.combo_json,updated_at=excluded.updated_at`)
      .run(comboKey, JSON.stringify(normalized), normalized.model, normalized.harness, normalized.accessRoute, normalized.contextStrategy, timestamp, timestamp);
    return { comboKey, combo: normalized };
  }

  beginObservation(input = {}) {
    const combination = this.combination(input.combo || input.combination);
    const mode = String(input.mode || "OFFICIAL").toUpperCase();
    if (!MODES.has(mode)) throw routerError("BENCHMARK_MODE_INVALID", "Modo de observación desconocido.");
    const observationId = input.observationId ? id(input.observationId, "observationId") : crypto.randomUUID();
    const projectScope = id(input.projectScope || input.projectId || "global", "projectScope");
    const taskKind = text(input.taskKind || "general", "taskKind", 200).toLowerCase();
    const taskFingerprint = hash(input.taskFingerprint, "taskFingerprint");
    const sourceHash = input.sourceHash ? hash(input.sourceHash, "sourceHash") : null;
    const workUnitId = optionalText(input.workUnitId, "workUnitId", 256);
    const isolationId = optionalText(input.isolationId, "isolationId", 256);
    if (mode !== "OFFICIAL" && (!workUnitId || !sourceHash || !isolationId)) {
      throw routerError("BENCHMARK_ISOLATION_REQUIRED", "Shadow y Candidate requieren Work Unit, sourceHash y aislamiento explícitos.");
    }
    this.db.prepare(`INSERT INTO benchmark_observations(
      observation_id,project_scope,task_kind,combo_key,mode,state,work_unit_id,task_fingerprint,source_hash,isolation_id,created_at
    ) VALUES(?,?,?,?,?,'RUNNING',?,?,?,?,?)`).run(
      observationId, projectScope, taskKind, combination.comboKey, mode, workUnitId, taskFingerprint, sourceHash, isolationId, iso(this.clock())
    );
    this.event("OBSERVATION_STARTED", observationId, { projectScope, taskKind, comboKey: combination.comboKey, mode, workUnitId });
    return { schema: "dorn.benchmark-observation/1", observationId, projectScope, taskKind, mode, state: "RUNNING", ...combination };
  }

  evidence(input, row) {
    if (input.verified !== true) return { verified: false, independent: false };
    if (!this.resolveEvidence) throw routerError("BENCHMARK_EVIDENCE_RESOLVER_REQUIRED", "Una medición verificable exige Evidence Core.");
    if (row.project_scope === "global") throw routerError("BENCHMARK_PROJECT_EVIDENCE_REQUIRED", "Evidence verificable necesita un proyecto real.");
    const evidenceId = id(input.evidenceId, "evidenceId");
    const evaluatorId = text(input.evaluatorId, "evaluatorId", 200);
    const evidence = this.resolveEvidence({ projectId: row.project_scope, evidenceId, workUnitId: row.work_unit_id });
    if (!evidence || evidence.evidenceId !== evidenceId || evidence.projectId !== row.project_scope || !POSITIVE_TRUTH.has(evidence.truthState) || evidence.result !== "PASSED") {
      throw routerError("BENCHMARK_EVIDENCE_INVALID", "La Evidence no verifica este proyecto y resultado.");
    }
    if (evidence.linkedToWorkUnit !== true || evidence.independent !== true) throw routerError("BENCHMARK_EVIDENCE_NOT_INDEPENDENT", "La Evidence debe ser independiente y estar ligada a la Work Unit.");
    const priorUse = this.db.prepare("SELECT observation_id FROM benchmark_observations WHERE evidence_id=? AND observation_id<>?").get(evidenceId, row.observation_id);
    if (priorUse) throw routerError("BENCHMARK_EVIDENCE_REUSED", "Una misma Evidence no puede multiplicar muestras de benchmarking.");
    const expectedSource = hash(row.source_hash || input.sourceHash, "sourceHash");
    if (evidence.sourceHash !== expectedSource) throw routerError("BENCHMARK_EVIDENCE_SOURCE_MISMATCH", "La Evidence no corresponde a los mismos bytes.");
    const combo = parse(this.db.prepare("SELECT combo_json FROM benchmark_combinations WHERE combo_key=?").get(row.combo_key)?.combo_json, {});
    if (evaluatorId === combo.harness) throw routerError("BENCHMARK_SELF_EVALUATION_BLOCKED", "El harness ejecutor no puede verificarse a sí mismo.");
    const attestation = evidence.details?.benchmark;
    const expectedOutputHash = hash(input.outputHash, "outputHash");
    const expectedQuality = bounded(input.quality, input.success === true ? 0.5 : 0, 0, 1);
    const expectedLatency = bounded(input.latencyMs, 0, 0, 86_400_000);
    const expectedCost = input.costUsd === null || input.costUsd === undefined ? null : bounded(input.costUsd, 0, 0, 1_000_000);
    if (!attestation || attestation.taskFingerprint !== row.task_fingerprint || attestation.comboKey !== row.combo_key
      || attestation.outputHash !== expectedOutputHash || attestation.success !== (input.success === true)
      || Number(attestation.quality) !== expectedQuality || Number(attestation.latencyMs) !== expectedLatency
      || (attestation.costUsd === null || attestation.costUsd === undefined ? null : Number(attestation.costUsd)) !== expectedCost
      || String(evidence.verifier?.id || "") !== evaluatorId) {
      throw routerError("BENCHMARK_ATTESTATION_MISMATCH", "La Evidence no atestigua exactamente la combinación, tarea y métricas declaradas.");
    }
    return {
      verified: true, independent: true, evidenceId, evaluatorId,
      evidenceHash: digest(JSON.stringify(evidence)), revisionHash: hash(input.revisionHash || evidence.sourceHash, "revisionHash")
    };
  }

  finishObservation(observationId, input = {}) {
    const requestedId = id(observationId, "observationId");
    const row = this.db.prepare("SELECT * FROM benchmark_observations WHERE observation_id=?").get(requestedId);
    if (!row) throw routerError("BENCHMARK_OBSERVATION_UNKNOWN", "Observación desconocida.");
    if (row.state !== "RUNNING") return this.observation(requestedId);
    const success = input.success === true;
    const quality = bounded(input.quality, success ? 0.5 : 0, 0, 1);
    const latencyMs = bounded(input.latencyMs, 0, 0, 86_400_000);
    const costUsd = input.costUsd === null || input.costUsd === undefined ? null : bounded(input.costUsd, 0, 0, 1_000_000);
    const outputHash = input.outputHash ? hash(input.outputHash, "outputHash") : null;
    if (success && !outputHash) throw routerError("BENCHMARK_OUTPUT_HASH_REQUIRED", "Una ejecución exitosa necesita el hash de su resultado.");
    const verified = this.evidence(input, row);
    const failureFamily = success ? null : text(input.failureFamily || "UNKNOWN", "failureFamily", 100);
    this.db.prepare(`UPDATE benchmark_observations SET state=?,success=?,quality=?,latency_ms=?,cost_usd=?,verified=?,independent=?,
      evidence_id=?,evidence_hash=?,revision_hash=?,evaluator_id=?,output_hash=?,failure_family=?,finished_at=? WHERE observation_id=?`)
      .run(success ? "SUCCEEDED" : "FAILED", Number(success), quality, latencyMs, costUsd, Number(verified.verified), Number(verified.independent),
        verified.evidenceId || null, verified.evidenceHash || null, verified.revisionHash || null, verified.evaluatorId || null,
        outputHash, failureFamily, iso(this.clock()), requestedId);
    this.event("OBSERVATION_FINISHED", requestedId, { success, verified: verified.verified, latencyMs, costKnown: costUsd !== null, failureFamily });
    return this.observation(requestedId);
  }

  observation(observationId) {
    const row = this.db.prepare("SELECT * FROM benchmark_observations WHERE observation_id=?").get(id(observationId, "observationId"));
    if (!row) return null;
    const combo = parse(this.db.prepare("SELECT combo_json FROM benchmark_combinations WHERE combo_key=?").get(row.combo_key)?.combo_json, {});
    return {
      schema: "dorn.benchmark-observation/1", observationId: row.observation_id, projectScope: row.project_scope,
      taskKind: row.task_kind, comboKey: row.combo_key, combo, mode: row.mode, state: row.state,
      workUnitId: row.work_unit_id, taskFingerprint: row.task_fingerprint, sourceHash: row.source_hash,
      isolationId: row.isolation_id, success: row.success === null ? null : Boolean(row.success), quality: row.quality,
      latencyMs: row.latency_ms, costUsd: row.cost_usd, verified: Boolean(row.verified), independent: Boolean(row.independent),
      evidenceId: row.evidence_id, evidenceHash: row.evidence_hash, revisionHash: row.revision_hash,
      evaluatorId: row.evaluator_id, outputHash: row.output_hash, failureFamily: row.failure_family,
      createdAt: row.created_at, finishedAt: row.finished_at
    };
  }

  metrics(projectScope, taskKind, comboKey) {
    const rows = this.db.prepare(`SELECT mode,state,success,quality,latency_ms,cost_usd,verified,independent
      FROM benchmark_observations WHERE project_scope=? AND task_kind=? AND combo_key=? ORDER BY finished_at DESC LIMIT 500`)
      .all(id(projectScope || "global", "projectScope"), text(taskKind || "general", "taskKind", 200).toLowerCase(), hash(comboKey, "comboKey"));
    return observationMetrics(rows);
  }

  plan(input = {}) {
    const projectScope = id(input.projectScope || input.projectId || "global", "projectScope");
    const taskKind = text(input.taskKind || "general", "taskKind", 200).toLowerCase();
    const required = new Set(list(input.requiredCapabilities, "requiredCapabilities"));
    const candidates = (Array.isArray(input.candidates) ? input.candidates : []).slice(0, 500).flatMap((candidate, index) => {
      if (!candidate || candidate.available !== true) return [];
      const capabilities = list(candidate.capabilities, "candidateCapabilities");
      if ([...required].some((capability) => !capabilities.includes(capability))) return [];
      const combination = this.combination(candidate.combo || candidate.combination);
      return [{
        candidateId: id(candidate.candidateId || candidate.connectionId || `candidate-${index}`, "candidateId"),
        capabilities, priority: Math.round(bounded(candidate.priority, index + 100, -100_000, 100_000)),
        ...combination, metrics: this.metrics(projectScope, taskKind, combination.comboKey)
      }];
    });
    candidates.sort((left, right) => {
      const leftObserved = left.metrics.verifiedSamples > 0;
      const rightObserved = right.metrics.verifiedSamples > 0;
      return Number(rightObserved) - Number(leftObserved)
        || (right.metrics.score ?? -Infinity) - (left.metrics.score ?? -Infinity)
        || right.metrics.verifiedSamples - left.metrics.verifiedSamples
        || left.priority - right.priority || left.candidateId.localeCompare(right.candidateId);
    });
    if (!candidates.length) return { schema: "dorn.benchmark-route-plan/1", state: "BLOCKED", reason: "NO_AVAILABLE_COMPATIBLE_COMBINATION", projectScope, taskKind };
    const selected = candidates[0];
    const historical = selected.metrics.verifiedSamples > 0;
    return {
      schema: "dorn.benchmark-route-plan/1", state: historical ? "SELECTED" : "SELECTED_COLD_START",
      basis: historical ? "HISTORICAL_INDEPENDENT_EVIDENCE" : "COLD_START_HEALTH_CAPABILITIES_PRIORITY",
      projectScope, taskKind, requiredCapabilities: [...required], selected,
      reasons: historical ? [
        `${selected.metrics.verifiedSamples} ejecución(es) oficiales con Evidence independiente`,
        `éxito ${(selected.metrics.successRate * 100).toFixed(0)}% y calidad ${selected.metrics.averageQuality.toFixed(2)}`,
        `latencia media ${Math.round(selected.metrics.averageLatencyMs)} ms`,
        selected.metrics.averageCostUsd === null ? "costo aún no observado" : `costo medio USD ${selected.metrics.averageCostUsd.toFixed(6)}`
      ] : ["sin historial oficial verificado", "ruta disponible y capacidades compatibles", `prioridad configurada ${selected.priority}`],
      alternatives: candidates.slice(1, 4)
    };
  }

  createExperiment(input = {}) {
    if (!this.resolveIsolation) throw routerError("BENCHMARK_ISOLATION_RESOLVER_REQUIRED", "Los experimentos necesitan Worktree Manager.");
    const experimentId = input.experimentId ? id(input.experimentId, "experimentId") : crypto.randomUUID();
    const projectScope = id(input.projectId, "projectId");
    const workUnitId = id(input.workUnitId, "workUnitId");
    const isolationId = text(input.isolationId || workUnitId, "isolationId", 256);
    const mode = String(input.mode || "SHADOW").toUpperCase();
    if (!new Set(["SHADOW", "CANDIDATE"]).has(mode)) throw routerError("BENCHMARK_EXPERIMENT_MODE_INVALID", "El experimento debe ser Shadow o Candidate.");
    const isolation = this.resolveIsolation({ projectId: projectScope, workUnitId, isolationId });
    if (!isolation || isolation.projectId !== projectScope || isolation.workUnitId !== workUnitId || isolation.executionRootAvailable !== true || !["ISOLATED", "TESTED"].includes(isolation.state)) {
      throw routerError("BENCHMARK_ISOLATION_INVALID", "El experimento no tiene un Worktree aislado activo.");
    }
    const baseline = this.combination(input.baselineCombo);
    const candidate = this.combination(input.candidateCombo);
    if (baseline.comboKey === candidate.comboKey) throw routerError("BENCHMARK_EXPERIMENT_IDENTICAL", "Baseline y Candidate deben ser combinaciones distintas.");
    const taskKind = text(input.taskKind || "general", "taskKind", 200).toLowerCase();
    const taskFingerprint = hash(input.taskFingerprint, "taskFingerprint");
    const sourceHash = hash(input.sourceHash, "sourceHash");
    const timestamp = iso(this.clock());
    this.db.prepare(`INSERT INTO benchmark_experiments(
      experiment_id,project_scope,work_unit_id,mode,baseline_combo_key,candidate_combo_key,task_kind,
      task_fingerprint,source_hash,isolation_id,state,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,'PLANNED',?,?)`).run(
      experimentId, projectScope, workUnitId, mode, baseline.comboKey, candidate.comboKey, taskKind,
      taskFingerprint, sourceHash, isolationId, timestamp, timestamp
    );
    this.event("EXPERIMENT_PLANNED", experimentId, { projectScope, workUnitId, mode, baselineComboKey: baseline.comboKey, candidateComboKey: candidate.comboKey });
    return this.experiment(experimentId);
  }

  beginExperiment(experimentId) {
    const requestedId = id(experimentId, "experimentId");
    const row = this.db.prepare("SELECT * FROM benchmark_experiments WHERE experiment_id=?").get(requestedId);
    if (!row || row.state !== "PLANNED") throw routerError("BENCHMARK_EXPERIMENT_STATE_INVALID", "El experimento no está listo para iniciar.");
    const combo = parse(this.db.prepare("SELECT combo_json FROM benchmark_combinations WHERE combo_key=?").get(row.candidate_combo_key)?.combo_json, {});
    const observation = this.beginObservation({
      projectScope: row.project_scope, taskKind: row.task_kind, combo, mode: row.mode,
      workUnitId: row.work_unit_id, taskFingerprint: row.task_fingerprint, sourceHash: row.source_hash, isolationId: row.isolation_id
    });
    this.db.prepare("UPDATE benchmark_experiments SET candidate_observation_id=?,state='RUNNING',updated_at=? WHERE experiment_id=?")
      .run(observation.observationId, iso(this.clock()), requestedId);
    this.event("EXPERIMENT_STARTED", requestedId, { observationId: observation.observationId });
    return this.experiment(requestedId);
  }

  finishExperiment(experimentId, input = {}) {
    const requestedId = id(experimentId, "experimentId");
    const row = this.db.prepare("SELECT * FROM benchmark_experiments WHERE experiment_id=?").get(requestedId);
    if (!row || row.state !== "RUNNING" || !row.candidate_observation_id) throw routerError("BENCHMARK_EXPERIMENT_STATE_INVALID", "El experimento no está ejecutándose.");
    const observation = this.finishObservation(row.candidate_observation_id, input);
    this.db.prepare("UPDATE benchmark_experiments SET state=?,updated_at=? WHERE experiment_id=?")
      .run(observation.verified && observation.independent ? "COMPARABLE" : "NEEDS_EVIDENCE", iso(this.clock()), requestedId);
    this.event("EXPERIMENT_FINISHED", requestedId, { observationId: observation.observationId, state: observation.verified ? "COMPARABLE" : "NEEDS_EVIDENCE" });
    return this.experiment(requestedId);
  }

  experiment(experimentId) {
    const row = this.db.prepare("SELECT * FROM benchmark_experiments WHERE experiment_id=?").get(id(experimentId, "experimentId"));
    if (!row) return null;
    const combo = (key) => parse(this.db.prepare("SELECT combo_json FROM benchmark_combinations WHERE combo_key=?").get(key)?.combo_json, {});
    const baselineMetrics = this.metrics(row.project_scope, row.task_kind, row.baseline_combo_key);
    const candidateObservation = row.candidate_observation_id ? this.observation(row.candidate_observation_id) : null;
    return {
      schema: "dorn.benchmark-experiment/1", experimentId: row.experiment_id, projectId: row.project_scope,
      workUnitId: row.work_unit_id, mode: row.mode, taskKind: row.task_kind, taskFingerprint: row.task_fingerprint,
      sourceHash: row.source_hash, isolationId: row.isolation_id, state: row.state,
      baseline: { comboKey: row.baseline_combo_key, combo: combo(row.baseline_combo_key), metrics: baselineMetrics },
      candidate: { comboKey: row.candidate_combo_key, combo: combo(row.candidate_combo_key), observation: candidateObservation },
      comparison: candidateObservation?.verified && baselineMetrics.verifiedSamples ? {
        qualityDelta: candidateObservation.quality - baselineMetrics.averageQuality,
        latencyDeltaMs: candidateObservation.latencyMs - baselineMetrics.averageLatencyMs,
        comparable: true
      } : { comparable: false },
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  report(options = {}) {
    const projectScope = options.projectScope ? id(options.projectScope, "projectScope") : null;
    const where = projectScope ? "WHERE project_scope=?" : "";
    const args = projectScope ? [projectScope] : [];
    const observations = this.db.prepare(`SELECT mode,state,COUNT(*) AS count FROM benchmark_observations ${where} GROUP BY mode,state`).all(...args);
    const experiments = this.db.prepare(`SELECT state,COUNT(*) AS count FROM benchmark_experiments ${where} GROUP BY state`).all(...args);
    return {
      schema: "dorn.intelligence-benchmark-router/1", ownerId: this.ownerId, state: "FOUNDATION",
      combinations: Number(this.db.prepare("SELECT COUNT(*) AS count FROM benchmark_combinations").get().count),
      observations: observations.map((row) => ({ mode: row.mode, state: row.state, count: Number(row.count) })),
      experiments: experiments.map((row) => ({ state: row.state, count: Number(row.count) }))
    };
  }

  close() { this.db.close(); }
}

module.exports = { IntelligenceBenchmarkRouter, normalizeCombination, observationMetrics };
