"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { projectIdentity } = require("./job-runtime");

const ID = /^[a-zA-Z0-9_.:-]{1,160}$/;
const HASH = /^[a-f0-9]{64}$/;
const POSITIVE_EVIDENCE = new Set(["VERIFIED", "PACKAGED", "INSTALLED", "PUBLISHED"]);
const TERMINAL = new Set([
  "COMPLETED", "FAILED", "INTERRUPTED", "BLOCKED_DEPENDENCY", "NOT_WORTH_RUNNING",
  "REDUNDANT_CANCELLED", "REJECTED_CANDIDATE", "INTEGRATED"
]);

function coordinatorError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}
function timestamp() { return new Date().toISOString(); }
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return structuredClone(fallback); } }
function boundedText(value, maximum, fallback = "") { return (String(value ?? "").trim() || fallback).slice(0, maximum); }
function boundedNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}
function assertId(value, label) {
  const id = boundedText(value, 160);
  if (!ID.test(id)) throw coordinatorError("MULTI_AGENT_ID_INVALID", `${label} necesita una identidad estable.`);
  return id;
}
function assertHash(value, label) {
  const hash = boundedText(value, 64).toLowerCase();
  if (!HASH.test(hash)) throw coordinatorError("MULTI_AGENT_HASH_INVALID", `${label} necesita un SHA-256 exacto.`);
  return hash;
}
function safeRelative(root, rawPath) {
  const input = String(rawPath ?? "");
  if (!input || input.includes("\0") || path.isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input)) {
    throw coordinatorError("MULTI_AGENT_PATH_UNSAFE", "El Task Graph recibió una ruta absoluta o vacía.");
  }
  const normalized = input.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..") || parts[0] === ".dorn") {
    throw coordinatorError("MULTI_AGENT_PATH_UNSAFE", "El Task Graph recibió una ruta insegura o reservada.");
  }
  const absolute = path.resolve(root, ...parts);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw coordinatorError("MULTI_AGENT_PATH_UNSAFE", "La ruta sale del proyecto.");
  return normalized;
}
function pathsConflict(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
function pathSetsConflict(left, right) {
  return left.some((a) => right.some((b) => pathsConflict(a, b)));
}
function marginalUtility(node, budgets) {
  const value = boundedNumber(node.utility, 0, 1, 0);
  const risk = boundedNumber(node.risk, 0, 1, 0.5);
  const cost = boundedNumber(node.estimatedCostUsd, 0, 1_000_000, 0);
  const latency = boundedNumber(node.expectedLatencyMs, 0, 86_400_000, 0);
  const costPenalty = budgets.maxCostUsd > 0 ? Math.min(1, cost / budgets.maxCostUsd) * 0.25 : (cost > 0 ? 0.25 : 0);
  const latencyPenalty = budgets.maxLatencyMs > 0 ? Math.min(1, latency / budgets.maxLatencyMs) * 0.2 : (latency > 0 ? 0.2 : 0);
  return Number((value - costPenalty - latencyPenalty - risk * 0.35).toFixed(6));
}
function topological(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const indegree = new Map(nodes.map((node) => [node.nodeId, 0]));
  const edges = new Map(nodes.map((node) => [node.nodeId, []]));
  for (const node of nodes) for (const dependency of node.dependsOn) {
    if (!byId.has(dependency)) throw coordinatorError("MULTI_AGENT_DEPENDENCY_UNKNOWN", `La dependencia ${dependency} no existe.`);
    if (dependency === node.nodeId) throw coordinatorError("MULTI_AGENT_GRAPH_CYCLE", "Un nodo no puede depender de sí mismo.");
    indegree.set(node.nodeId, indegree.get(node.nodeId) + 1);
    edges.get(dependency).push(node.nodeId);
  }
  const ready = [...nodes.filter((node) => indegree.get(node.nodeId) === 0).map((node) => node.nodeId)].sort();
  const ordered = [];
  while (ready.length) {
    const id = ready.shift();
    ordered.push(id);
    for (const target of edges.get(id).sort()) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) ready.push(target);
    }
    ready.sort();
  }
  if (ordered.length !== nodes.length) throw coordinatorError("MULTI_AGENT_GRAPH_CYCLE", "El Task Graph contiene un ciclo.");
  return ordered;
}

class MultiAgentCoordinator {
  constructor(options = {}) {
    if (!options.projectCore) throw new Error("Multi-agent Coordinator necesita Project Core.");
    if (!options.worktreeManager) throw new Error("Multi-agent Coordinator necesita Worktree Manager.");
    this.projectCore = options.projectCore;
    this.worktreeManager = options.worktreeManager;
    this.resolveEvidence = options.resolveEvidence || null;
    this.maxNodes = Math.max(4, Math.min(64, Number(options.maxNodes) || 64));
    this.maxParallel = Math.max(1, Math.min(8, Number(options.maxParallel) || 4));
  }

  projectCore;
  worktreeManager;
  resolveEvidence;
  maxNodes;
  maxParallel;
  databases = new Map();

  identity(project) { return projectIdentity(project, this.projectCore); }
  databasePath(identity) { return path.join(identity.tasksRoot, "multi-agent-coordinator.sqlite"); }

  ensure(project) {
    const identity = this.identity(project);
    if (this.databases.has(identity.projectId)) return { identity, db: this.databases.get(identity.projectId) };
    const filePath = this.databasePath(identity);
    if (fs.existsSync(filePath)) {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw coordinatorError("MULTI_AGENT_STORAGE_UNSAFE", "El registro multiagente no es un archivo regular seguro.");
    }
    const db = new DatabaseSync(filePath);
    try {
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        PRAGMA busy_timeout=3000;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS coordinator_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_graphs (
          graph_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, work_unit_id TEXT NOT NULL,
          objective TEXT NOT NULL, task_fingerprint TEXT NOT NULL, budgets_json TEXT NOT NULL,
          state TEXT NOT NULL, selected_node_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_nodes (
          graph_id TEXT NOT NULL REFERENCES task_graphs(graph_id) ON DELETE CASCADE,
          node_id TEXT NOT NULL, role TEXT NOT NULL, agent_id TEXT NOT NULL, state TEXT NOT NULL,
          depends_json TEXT NOT NULL, expected_files_json TEXT NOT NULL, isolation_work_unit_id TEXT,
          redundant_key TEXT, comparison_group TEXT, marginal_utility REAL NOT NULL,
          output_hash TEXT, evidence_id TEXT, error_text TEXT, started_at TEXT, finished_at TEXT,
          PRIMARY KEY(graph_id,node_id)
        );
        CREATE TABLE IF NOT EXISTS temporary_claims (
          graph_id TEXT NOT NULL, node_id TEXT NOT NULL, relative_path TEXT NOT NULL,
          claimed_at TEXT NOT NULL, PRIMARY KEY(graph_id,relative_path)
        );
        CREATE INDEX IF NOT EXISTS idx_task_nodes_state ON task_nodes(graph_id,state,node_id);
      `);
      const owner = db.prepare("SELECT value FROM coordinator_metadata WHERE key='project_id'").get()?.value || null;
      const rowOwners = db.prepare("SELECT DISTINCT project_id FROM task_graphs").all().map((entry) => String(entry.project_id));
      if ((owner && owner !== identity.projectId) || rowOwners.some((entry) => entry !== identity.projectId)) {
        throw coordinatorError("MULTI_AGENT_PROJECT_IDENTITY_MISMATCH", "El registro multiagente pertenece a otro proyecto.");
      }
      if (!owner) db.prepare("INSERT INTO coordinator_metadata(key,value) VALUES('project_id',?)").run(identity.projectId);
      const interruptedAt = timestamp();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE task_nodes SET state='INTERRUPTED',error_text=?,finished_at=? WHERE state='RUNNING'")
          .run("DORN se cerró durante el nodo; necesita revisión explícita.", interruptedAt);
        db.prepare("DELETE FROM temporary_claims").run();
        db.prepare("UPDATE task_graphs SET state='NEEDS_REVIEW',updated_at=? WHERE graph_id IN (SELECT graph_id FROM task_nodes WHERE state='INTERRUPTED')")
          .run(interruptedAt);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    } catch (error) { try { db.close(); } catch {} throw error; }
    this.databases.set(identity.projectId, db);
    return { identity, db };
  }

  rowNode(row) {
    return row ? {
      nodeId: row.node_id, role: row.role, agentId: row.agent_id, state: row.state,
      dependsOn: parseJson(row.depends_json, []), expectedFiles: parseJson(row.expected_files_json, []),
      isolationWorkUnitId: row.isolation_work_unit_id || null, redundantKey: row.redundant_key || null,
      comparisonGroup: row.comparison_group || null, marginalUtility: Number(row.marginal_utility),
      outputHash: row.output_hash || null, evidenceId: row.evidence_id || null, error: row.error_text || null,
      startedAt: row.started_at || null, finishedAt: row.finished_at || null
    } : null;
  }

  graph(project, graphId) {
    const { identity, db } = this.ensure(project);
    const row = db.prepare("SELECT * FROM task_graphs WHERE graph_id=? AND project_id=?").get(assertId(graphId, "Task Graph"), identity.projectId);
    if (!row) throw coordinatorError("MULTI_AGENT_GRAPH_UNKNOWN", "El Task Graph no existe para este proyecto.");
    return {
      schema: "dorn.multi-agent-graph/1", graphId: row.graph_id, projectId: row.project_id,
      workUnitId: row.work_unit_id, objective: row.objective, taskFingerprint: row.task_fingerprint,
      budgets: parseJson(row.budgets_json, {}), state: row.state, selectedNodeId: row.selected_node_id || null,
      nodes: db.prepare("SELECT * FROM task_nodes WHERE graph_id=? ORDER BY node_id").all(row.graph_id).map((entry) => this.rowNode(entry)),
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  createGraph(project, input = {}) {
    const { identity, db } = this.ensure(project);
    const graphId = assertId(input.graphId || crypto.randomUUID(), "Task Graph");
    const workUnitId = assertId(input.workUnitId, "Work Unit");
    const objective = boundedText(input.objective, 20_000);
    if (!objective) throw coordinatorError("MULTI_AGENT_OBJECTIVE_REQUIRED", "El Task Graph necesita un objetivo explícito.");
    const taskFingerprint = assertHash(input.taskFingerprint, "Task Graph");
    if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > this.maxNodes) {
      throw coordinatorError("MULTI_AGENT_NODE_LIMIT", `El Task Graph admite entre 1 y ${this.maxNodes} nodos; no cientos de agentes.`);
    }
    const budgets = {
      maxParallel: Math.max(1, Math.min(this.maxParallel, Number(input.budgets?.maxParallel) || this.maxParallel)),
      maxCostUsd: boundedNumber(input.budgets?.maxCostUsd, 0, 1_000_000, 0),
      maxLatencyMs: boundedNumber(input.budgets?.maxLatencyMs, 0, 86_400_000, 0),
      minimumMarginalUtility: boundedNumber(input.budgets?.minimumMarginalUtility, -1, 1, 0.05)
    };
    const seen = new Set();
    const nodes = input.nodes.map((raw) => {
      const nodeId = assertId(raw.nodeId, "Nodo");
      if (seen.has(nodeId)) throw coordinatorError("MULTI_AGENT_NODE_DUPLICATE", `El nodo ${nodeId} está duplicado.`);
      seen.add(nodeId);
      const expectedFiles = [...new Set((raw.expectedFiles || []).map((item) => safeRelative(identity.root, item)))].sort();
      if (expectedFiles.length > 2000) throw coordinatorError("MULTI_AGENT_SCOPE_TOO_LARGE", "Un nodo declara demasiados archivos.");
      return {
        nodeId, role: boundedText(raw.role, 100, "specialist"), agentId: assertId(raw.agentId || nodeId, "Agente"),
        dependsOn: [...new Set((raw.dependsOn || []).map((item) => assertId(item, "Dependencia")))].sort(),
        expectedFiles, isolationWorkUnitId: raw.isolationWorkUnitId ? assertId(raw.isolationWorkUnitId, "Aislamiento") : null,
        redundantKey: raw.redundantKey ? boundedText(raw.redundantKey, 200) : null,
        comparisonGroup: raw.comparisonGroup ? boundedText(raw.comparisonGroup, 200) : null,
        marginalUtility: marginalUtility(raw, budgets), state: "PENDING"
      };
    });
    topological(nodes);
    for (const node of nodes) if (node.marginalUtility < budgets.minimumMarginalUtility) node.state = "NOT_WORTH_RUNNING";
    const redundantGroups = new Map();
    for (const node of nodes.filter((entry) => entry.state === "PENDING" && entry.redundantKey)) {
      if (!redundantGroups.has(node.redundantKey)) redundantGroups.set(node.redundantKey, []);
      redundantGroups.get(node.redundantKey).push(node);
    }
    for (const group of redundantGroups.values()) {
      group.sort((left, right) => right.marginalUtility - left.marginalUtility || left.nodeId.localeCompare(right.nodeId));
      for (const redundant of group.slice(1)) redundant.state = "REDUNDANT_CANCELLED";
    }
    const createdAt = timestamp();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO task_graphs(graph_id,project_id,work_unit_id,objective,task_fingerprint,budgets_json,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?, ?,?)`).run(graphId, identity.projectId, workUnitId, objective, taskFingerprint, JSON.stringify(budgets), "PLANNED", createdAt, createdAt);
      const insert = db.prepare(`INSERT INTO task_nodes(graph_id,node_id,role,agent_id,state,depends_json,expected_files_json,isolation_work_unit_id,redundant_key,comparison_group,marginal_utility)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      for (const node of nodes) insert.run(graphId, node.nodeId, node.role, node.agentId, node.state, JSON.stringify(node.dependsOn), JSON.stringify(node.expectedFiles), node.isolationWorkUnitId, node.redundantKey, node.comparisonGroup, node.marginalUtility);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return this.graph(identity.project, graphId);
  }

  waves(project, graphId) {
    const graph = this.graph(project, graphId);
    const byId = new Map(graph.nodes.map((node) => [node.nodeId, node]));
    const remaining = new Set(graph.nodes.filter((node) => node.state === "PENDING").map((node) => node.nodeId));
    const completed = new Set(graph.nodes.filter((node) => node.state === "COMPLETED" || node.state === "INTEGRATED").map((node) => node.nodeId));
    const waves = [];
    while (remaining.size) {
      const ready = [...remaining].map((id) => byId.get(id)).filter((node) => node.dependsOn.every((id) => completed.has(id))).sort((a, b) => b.marginalUtility - a.marginalUtility || a.nodeId.localeCompare(b.nodeId));
      if (!ready.length) break;
      const wave = [];
      for (const node of ready) {
        if (wave.length >= graph.budgets.maxParallel) break;
        if (!wave.some((selected) => pathSetsConflict(selected.expectedFiles, node.expectedFiles))) wave.push(node);
      }
      if (!wave.length) wave.push(ready[0]);
      waves.push(wave.map((node) => node.nodeId));
      for (const node of wave) { remaining.delete(node.nodeId); completed.add(node.nodeId); }
    }
    return { graphId: graph.graphId, maxParallel: graph.budgets.maxParallel, waves, unschedulable: [...remaining].sort() };
  }

  claim(project, graphId, nodeId) {
    const { identity, db } = this.ensure(project);
    graphId = assertId(graphId, "Task Graph"); nodeId = assertId(nodeId, "Nodo");
    db.exec("BEGIN IMMEDIATE");
    try {
      const graph = db.prepare("SELECT * FROM task_graphs WHERE graph_id=? AND project_id=?").get(graphId, identity.projectId);
      const row = graph && db.prepare("SELECT * FROM task_nodes WHERE graph_id=? AND node_id=?").get(graphId, nodeId);
      if (!row) throw coordinatorError("MULTI_AGENT_NODE_UNKNOWN", "El nodo no existe para este proyecto.");
      const node = this.rowNode(row);
      if (node.state !== "PENDING") throw coordinatorError("MULTI_AGENT_NODE_NOT_CLAIMABLE", `El nodo está en estado ${node.state}.`);
      for (const dependency of node.dependsOn) {
        const state = db.prepare("SELECT state FROM task_nodes WHERE graph_id=? AND node_id=?").get(graphId, dependency)?.state;
        if (state !== "COMPLETED" && state !== "INTEGRATED") throw coordinatorError("MULTI_AGENT_DEPENDENCY_NOT_READY", `La dependencia ${dependency} no terminó.`);
      }
      if (node.expectedFiles.length) {
        if (!node.isolationWorkUnitId) throw coordinatorError("MULTI_AGENT_ISOLATION_REQUIRED", "Un nodo escritor necesita Worktree/Sandbox aislado.");
        const unit = this.worktreeManager.get(identity.project, node.isolationWorkUnitId);
        if (unit.projectId !== identity.projectId || unit.executionRootAvailable !== true || !["ISOLATED", "TESTED", "REWORK_REQUIRED"].includes(unit.state)) {
          throw coordinatorError("MULTI_AGENT_ISOLATION_INVALID", "El aislamiento no corresponde al proyecto o no está disponible.");
        }
        if (node.expectedFiles.some((file) => !unit.expectedFiles.includes(file))) throw coordinatorError("MULTI_AGENT_ISOLATION_SCOPE_MISMATCH", "El Worktree no cubre todo el Change Scope del nodo.");
      }
      const claims = db.prepare("SELECT graph_id,node_id,relative_path FROM temporary_claims").all();
      const collision = claims.find((claim) => claim.node_id !== nodeId && node.expectedFiles.some((file) => pathsConflict(file, claim.relative_path)));
      if (collision) throw coordinatorError("MULTI_AGENT_PATH_CONFLICT", `La ruta ${collision.relative_path} ya tiene propietario temporal.`, { ownerNodeId: collision.node_id });
      const claimedAt = timestamp();
      const insertClaim = db.prepare("INSERT INTO temporary_claims(graph_id,node_id,relative_path,claimed_at) VALUES(?,?,?,?)");
      for (const file of node.expectedFiles) insertClaim.run(graphId, nodeId, file, claimedAt);
      db.prepare("UPDATE task_nodes SET state='RUNNING',started_at=? WHERE graph_id=? AND node_id=?").run(claimedAt, graphId, nodeId);
      db.prepare("UPDATE task_graphs SET state='RUNNING',updated_at=? WHERE graph_id=?").run(claimedAt, graphId);
      db.exec("COMMIT");
      return this.graph(identity.project, graphId).nodes.find((entry) => entry.nodeId === nodeId);
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  finishNode(project, graphId, nodeId, input = {}) {
    const { identity, db } = this.ensure(project);
    graphId = assertId(graphId, "Task Graph"); nodeId = assertId(nodeId, "Nodo");
    const outputHash = input.success === true ? assertHash(input.outputHash, "Resultado") : null;
    const finishedAt = timestamp();
    db.exec("BEGIN IMMEDIATE");
    try {
      const node = db.prepare("SELECT state FROM task_nodes WHERE graph_id=? AND node_id=?").get(graphId, nodeId);
      if (!node || node.state !== "RUNNING") throw coordinatorError("MULTI_AGENT_NODE_NOT_RUNNING", "Sólo un nodo en ejecución puede terminar.");
      const nextState = input.success === true ? "COMPLETED" : "FAILED";
      db.prepare("UPDATE task_nodes SET state=?,output_hash=?,evidence_id=?,error_text=?,finished_at=? WHERE graph_id=? AND node_id=?")
        .run(nextState, outputHash, input.evidenceId ? assertId(input.evidenceId, "Evidence") : null, input.success === true ? null : boundedText(input.error, 4000, "Fallo no especificado."), finishedAt, graphId, nodeId);
      db.prepare("DELETE FROM temporary_claims WHERE graph_id=? AND node_id=?").run(graphId, nodeId);
      if (nextState === "FAILED") {
        let changed = true;
        while (changed) {
          changed = false;
          const pending = db.prepare("SELECT node_id,depends_json FROM task_nodes WHERE graph_id=? AND state='PENDING'").all(graphId);
          for (const candidate of pending) {
            const failedDependency = parseJson(candidate.depends_json, []).some((dependency) => {
              const state = db.prepare("SELECT state FROM task_nodes WHERE graph_id=? AND node_id=?").get(graphId, dependency)?.state;
              return state === "FAILED" || state === "BLOCKED_DEPENDENCY";
            });
            if (failedDependency) { db.prepare("UPDATE task_nodes SET state='BLOCKED_DEPENDENCY',finished_at=? WHERE graph_id=? AND node_id=?").run(finishedAt, graphId, candidate.node_id); changed = true; }
          }
        }
      }
      const active = db.prepare("SELECT COUNT(*) AS count FROM task_nodes WHERE graph_id=? AND state IN ('PENDING','RUNNING')").get(graphId).count;
      const comparisons = db.prepare("SELECT COUNT(*) AS count FROM task_nodes WHERE graph_id=? AND comparison_group IS NOT NULL").get(graphId).count;
      const failures = db.prepare("SELECT COUNT(*) AS count FROM task_nodes WHERE graph_id=? AND state IN ('FAILED','INTERRUPTED','BLOCKED_DEPENDENCY')").get(graphId).count;
      const graphState = Number(active) ? "RUNNING" : Number(failures) ? "FAILED" : Number(comparisons) ? "AWAITING_COMPARISON" : "COMPLETED";
      db.prepare("UPDATE task_graphs SET state=?,updated_at=? WHERE graph_id=?").run(graphState, finishedAt, graphId);
      db.exec("COMMIT");
      return this.graph(identity.project, graphId);
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  selectWinner(project, graphId, comparisonGroup) {
    if (!this.resolveEvidence) throw coordinatorError("MULTI_AGENT_EVIDENCE_UNAVAILABLE", "No existe un resolutor de Evidence independiente.");
    const graph = this.graph(project, graphId);
    const group = boundedText(comparisonGroup, 200);
    const candidates = graph.nodes.filter((node) => node.comparisonGroup === group && node.state === "COMPLETED");
    if (candidates.length < 2) throw coordinatorError("MULTI_AGENT_COMPARISON_INCOMPLETE", "La comparación necesita al menos dos candidatos terminados.");
    const verified = candidates.map((node) => {
      if (!node.evidenceId || !node.outputHash) throw coordinatorError("MULTI_AGENT_EVIDENCE_REQUIRED", `El candidato ${node.nodeId} no tiene Evidence exacta.`);
      const evidence = this.resolveEvidence({ project, projectId: graph.projectId, graphId: graph.graphId, workUnitId: graph.workUnitId, nodeId: node.nodeId, evidenceId: node.evidenceId });
      const attestation = evidence?.details?.multiAgent || {};
      const verifierId = boundedText(evidence?.verifier?.id || evidence?.verifier?.name, 160);
      const valid = evidence?.projectId === graph.projectId && POSITIVE_EVIDENCE.has(evidence?.truthState) && evidence?.result === "PASSED" &&
        evidence?.independent === true && evidence?.linkedToWorkUnit === true && verifierId && verifierId !== node.agentId &&
        attestation.graphId === graph.graphId && attestation.nodeId === node.nodeId && attestation.taskFingerprint === graph.taskFingerprint &&
        attestation.outputHash === node.outputHash && Number.isFinite(Number(attestation.score)) && Number(attestation.score) >= 0 && Number(attestation.score) <= 1;
      if (!valid) throw coordinatorError("MULTI_AGENT_EVIDENCE_INVALID", `Evidence de ${node.nodeId} no es independiente o no coincide con bytes/tarea.`);
      return { node, score: Number(attestation.score), verifierId };
    }).sort((left, right) => right.score - left.score || right.node.marginalUtility - left.node.marginalUtility || left.node.nodeId.localeCompare(right.node.nodeId));
    const winner = verified[0];
    const { identity, db } = this.ensure(project);
    const selectedAt = timestamp();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE task_nodes SET state='SELECTED' WHERE graph_id=? AND node_id=?").run(graph.graphId, winner.node.nodeId);
      for (const loser of verified.slice(1)) db.prepare("UPDATE task_nodes SET state='REJECTED_CANDIDATE' WHERE graph_id=? AND node_id=?").run(graph.graphId, loser.node.nodeId);
      db.prepare("UPDATE task_graphs SET selected_node_id=?,state='WINNER_SELECTED',updated_at=? WHERE graph_id=?").run(winner.node.nodeId, selectedAt, graph.graphId);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { ...this.graph(identity.project, graph.graphId), comparison: { group, winnerNodeId: winner.node.nodeId, score: winner.score, verifierId: winner.verifierId } };
  }

  integrateWinner(project, graphId) {
    const graph = this.graph(project, graphId);
    const winner = graph.nodes.find((node) => node.nodeId === graph.selectedNodeId);
    if (!winner || winner.state !== "SELECTED") throw coordinatorError("MULTI_AGENT_WINNER_REQUIRED", "Sólo el ganador seleccionado puede integrarse.");
    if (!winner.isolationWorkUnitId) throw coordinatorError("MULTI_AGENT_ISOLATION_REQUIRED", "El ganador no tiene Worktree para integrar.");
    const prepared = this.worktreeManager.prepareIntegration(project, winner.isolationWorkUnitId);
    if (prepared.state !== "READY_TO_INTEGRATE") throw coordinatorError("MULTI_AGENT_WINNER_NOT_READY", "Los bytes del ganador no superaron los gates de integración.");
    const integrated = this.worktreeManager.integrate(project, winner.isolationWorkUnitId);
    const { identity, db } = this.ensure(project);
    const integratedAt = timestamp();
    db.prepare("UPDATE task_nodes SET state='INTEGRATED',finished_at=? WHERE graph_id=? AND node_id=?").run(integratedAt, graph.graphId, winner.nodeId);
    db.prepare("UPDATE task_graphs SET state='INTEGRATED',updated_at=? WHERE graph_id=?").run(integratedAt, graph.graphId);
    return { graph: this.graph(identity.project, graph.graphId), worktree: integrated };
  }

  closeAll() {
    for (const db of this.databases.values()) try { db.close(); } catch {}
    this.databases.clear();
  }
}

module.exports = { MultiAgentCoordinator, marginalUtility, pathsConflict, pathSetsConflict, topological };
