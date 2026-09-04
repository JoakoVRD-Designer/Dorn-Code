"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { WorktreeManager } = require("../out/main/dorn-core/worktree-manager");
const { MultiAgentCoordinator, pathsConflict } = require("../out/main/dorn-core/multi-agent-coordinator");
const { AgentManager } = require("../out/main/dorn-suite/agent-manager");

function sha(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function fixture(context, id = `multi_${crypto.randomUUID().replaceAll("-", "")}`) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-multi-project-"));
  const isolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-multi-isolation-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  context.after(() => fs.rmSync(isolationRoot, { recursive: true, force: true }));
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const worktreeManager = new WorktreeManager({ projectCore, isolationRoot, maxFiles: 1000, maxBytes: 64 * 1024 * 1024 });
  const evidence = new Map();
  const resolveEvidence = ({ evidenceId }) => structuredClone(evidence.get(evidenceId));
  const coordinator = new MultiAgentCoordinator({ projectCore, worktreeManager, resolveEvidence });
  context.after(() => coordinator.closeAll());
  return { root, isolationRoot, projectCore, project, worktreeManager, evidence, coordinator };
}
function graphInput(overrides = {}) {
  return {
    graphId: overrides.graphId || `graph-${crypto.randomUUID()}`,
    workUnitId: overrides.workUnitId || `work-${crypto.randomUUID()}`,
    objective: overrides.objective || "Producir, criticar y seleccionar el cambio más seguro.",
    taskFingerprint: overrides.taskFingerprint || sha("task"),
    budgets: overrides.budgets || { maxParallel: 4, maxCostUsd: 1, maxLatencyMs: 10_000, minimumMarginalUtility: 0.05 },
    nodes: overrides.nodes || [{ nodeId: "research", role: "researcher", utility: 0.9, risk: 0.1 }]
  };
}
function worktree(fixtureValue, workUnitId, relativePath) {
  const { root, project, worktreeManager } = fixtureValue;
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, "before\n");
  return worktreeManager.create(project, { workUnitId, expectedFiles: [relativePath] });
}
function modifyAndTest(fixtureValue, unit, relativePath, content) {
  const target = path.join(unit.executionRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return fixtureValue.worktreeManager.recordTest(fixtureValue.project, unit.workUnitId, {
    passed: true, independent: true, exitCode: 0, command: ["node", "--test"]
  });
}

test("Task Graph rechaza ciclos y cientos de agentes antes de ejecutar", (context) => {
  const { project, coordinator } = fixture(context);
  assert.throws(() => coordinator.createGraph(project, graphInput({ nodes: Array.from({ length: 65 }, (_, index) => ({ nodeId: `node-${index}`, utility: 1 })) })), (error) => error.code === "MULTI_AGENT_NODE_LIMIT");
  assert.throws(() => coordinator.createGraph(project, graphInput({ nodes: [
    { nodeId: "a", dependsOn: ["b"], utility: 1 },
    { nodeId: "b", dependsOn: ["a"], utility: 1 }
  ] })), (error) => error.code === "MULTI_AGENT_GRAPH_CYCLE");
});

test("utilidad marginal y redundancia cancelan trabajo que no justifica costo, latencia y riesgo", (context) => {
  const { project, coordinator } = fixture(context);
  const graph = coordinator.createGraph(project, graphInput({ nodes: [
    { nodeId: "useful", utility: 0.95, risk: 0.05, estimatedCostUsd: 0.05, expectedLatencyMs: 100, redundantKey: "same-research" },
    { nodeId: "duplicate", utility: 0.7, risk: 0.2, estimatedCostUsd: 0.2, expectedLatencyMs: 1000, redundantKey: "same-research" },
    { nodeId: "waste", utility: 0.05, risk: 1, estimatedCostUsd: 1, expectedLatencyMs: 10_000 }
  ] }));
  assert.equal(graph.nodes.find((node) => node.nodeId === "useful").state, "PENDING");
  assert.equal(graph.nodes.find((node) => node.nodeId === "duplicate").state, "REDUNDANT_CANCELLED");
  assert.equal(graph.nodes.find((node) => node.nodeId === "waste").state, "NOT_WORTH_RUNNING");
});

test("waves son deterministas y nunca ponen rutas solapadas en la misma ola", (context) => {
  const { project, coordinator } = fixture(context);
  const graph = coordinator.createGraph(project, graphInput({ nodes: [
    { nodeId: "src-parent", expectedFiles: ["src"], utility: 0.95, risk: 0.1, isolationWorkUnitId: "unit-parent" },
    { nodeId: "src-child", expectedFiles: ["src/app.js"], utility: 0.9, risk: 0.1, isolationWorkUnitId: "unit-child" },
    { nodeId: "docs", expectedFiles: ["docs/readme.md"], utility: 0.8, risk: 0.1, isolationWorkUnitId: "unit-docs" }
  ] }));
  const schedule = coordinator.waves(project, graph.graphId);
  assert.deepEqual(schedule.waves[0], ["src-parent", "docs"]);
  assert.deepEqual(schedule.waves[1], ["src-child"]);
  assert.equal(pathsConflict("src", "src/app.js"), true);
});

test("propiedad temporal bloquea escrituras simultáneas y exige Worktree del mismo scope", (context) => {
  const value = fixture(context);
  const unitA = worktree(value, "unit-a", "src/app.js");
  const unitB = worktree(value, "unit-b", "src/app.js");
  const graph = value.coordinator.createGraph(value.project, graphInput({ nodes: [
    { nodeId: "writer-a", expectedFiles: ["src/app.js"], isolationWorkUnitId: unitA.workUnitId, utility: 0.9, risk: 0.1 },
    { nodeId: "writer-b", expectedFiles: ["src/app.js"], isolationWorkUnitId: unitB.workUnitId, utility: 0.85, risk: 0.1 }
  ] }));
  assert.equal(value.coordinator.claim(value.project, graph.graphId, "writer-a").state, "RUNNING");
  assert.throws(() => value.coordinator.claim(value.project, graph.graphId, "writer-b"), (error) => error.code === "MULTI_AGENT_PATH_CONFLICT");
  value.coordinator.finishNode(value.project, graph.graphId, "writer-a", { success: true, outputHash: sha("a") });
  assert.equal(value.coordinator.claim(value.project, graph.graphId, "writer-b").state, "RUNNING");
});

test("una falla bloquea dependientes y libera todos sus claims", (context) => {
  const value = fixture(context);
  const unit = worktree(value, "unit-fail", "failure.js");
  const graph = value.coordinator.createGraph(value.project, graphInput({ nodes: [
    { nodeId: "producer", expectedFiles: ["failure.js"], isolationWorkUnitId: unit.workUnitId, utility: 0.9, risk: 0.1 },
    { nodeId: "consumer", dependsOn: ["producer"], utility: 0.9, risk: 0.1 }
  ] }));
  value.coordinator.claim(value.project, graph.graphId, "producer");
  const failed = value.coordinator.finishNode(value.project, graph.graphId, "producer", { success: false, error: "falló" });
  assert.equal(failed.state, "FAILED");
  assert.equal(failed.nodes.find((node) => node.nodeId === "producer").state, "FAILED");
  assert.equal(failed.nodes.find((node) => node.nodeId === "consumer").state, "BLOCKED_DEPENDENCY");
});

test("sólo Evidence independiente exacta selecciona y sólo el ganador puede integrarse", (context) => {
  const value = fixture(context);
  const unitA = worktree(value, "candidate-a-unit", "feature.js");
  const unitB = worktree(value, "candidate-b-unit", "feature.js");
  modifyAndTest(value, unitA, "feature.js", "candidate-a\n");
  modifyAndTest(value, unitB, "feature.js", "candidate-b\n");
  const taskFingerprint = sha("comparison-task");
  const graph = value.coordinator.createGraph(value.project, graphInput({ taskFingerprint, nodes: [
    { nodeId: "candidate-a", agentId: "agent-a", expectedFiles: ["feature.js"], isolationWorkUnitId: unitA.workUnitId, comparisonGroup: "implementation", utility: 0.9, risk: 0.1 },
    { nodeId: "candidate-b", agentId: "agent-b", expectedFiles: ["feature.js"], isolationWorkUnitId: unitB.workUnitId, comparisonGroup: "implementation", utility: 0.9, risk: 0.1 }
  ] }));
  for (const [nodeId, outputHash, evidenceId] of [["candidate-a", sha("out-a"), "evidence-a"], ["candidate-b", sha("out-b"), "evidence-b"]]) {
    value.coordinator.claim(value.project, graph.graphId, nodeId);
    value.coordinator.finishNode(value.project, graph.graphId, nodeId, { success: true, outputHash, evidenceId });
    value.evidence.set(evidenceId, {
      projectId: value.project.id, truthState: "VERIFIED", result: "PASSED", independent: true, linkedToWorkUnit: true,
      verifier: { id: "independent-critic" },
      details: { multiAgent: { graphId: graph.graphId, nodeId, taskFingerprint, outputHash, score: nodeId === "candidate-b" ? 0.96 : 0.75 } }
    });
  }
  const selected = value.coordinator.selectWinner(value.project, graph.graphId, "implementation");
  assert.equal(selected.selectedNodeId, "candidate-b");
  assert.equal(selected.nodes.find((node) => node.nodeId === "candidate-a").state, "REJECTED_CANDIDATE");
  const integrated = value.coordinator.integrateWinner(value.project, graph.graphId);
  assert.equal(integrated.graph.state, "INTEGRATED");
  assert.equal(fs.readFileSync(path.join(value.root, "feature.js"), "utf8"), "candidate-b\n");
});

test("Evidence autoevaluada o con bytes distintos nunca elige un ganador", (context) => {
  const value = fixture(context);
  const taskFingerprint = sha("hostile-task");
  const graph = value.coordinator.createGraph(value.project, graphInput({ taskFingerprint, nodes: [
    { nodeId: "candidate-a", agentId: "agent-a", comparisonGroup: "hostile", utility: 0.9, risk: 0.1 },
    { nodeId: "candidate-b", agentId: "agent-b", comparisonGroup: "hostile", utility: 0.9, risk: 0.1 }
  ] }));
  for (const [nodeId, evidenceId] of [["candidate-a", "hostile-a"], ["candidate-b", "hostile-b"]]) {
    value.coordinator.claim(value.project, graph.graphId, nodeId);
    value.coordinator.finishNode(value.project, graph.graphId, nodeId, { success: true, outputHash: sha(nodeId), evidenceId });
    value.evidence.set(evidenceId, {
      projectId: value.project.id, truthState: "VERIFIED", result: "PASSED", independent: true, linkedToWorkUnit: true,
      verifier: { id: nodeId === "candidate-a" ? "agent-a" : "independent" },
      details: { multiAgent: { graphId: graph.graphId, nodeId, taskFingerprint, outputHash: nodeId === "candidate-b" ? sha("wrong") : sha(nodeId), score: 1 } }
    });
  }
  assert.throws(() => value.coordinator.selectWinner(value.project, graph.graphId, "hostile"), (error) => error.code === "MULTI_AGENT_EVIDENCE_INVALID");
});

test("reinicio marca ejecución interrumpida y libera propiedad temporal", (context) => {
  const value = fixture(context);
  const unitA = worktree(value, "recovery-a-unit", "recovery.js");
  const graphA = value.coordinator.createGraph(value.project, graphInput({ graphId: "recovery-a", nodes: [
    { nodeId: "writer-a", expectedFiles: ["recovery.js"], isolationWorkUnitId: unitA.workUnitId, utility: 0.9, risk: 0.1 }
  ] }));
  value.coordinator.claim(value.project, graphA.graphId, "writer-a");
  value.coordinator.closeAll();
  const restored = new MultiAgentCoordinator({ projectCore: value.projectCore, worktreeManager: value.worktreeManager, resolveEvidence: ({ evidenceId }) => value.evidence.get(evidenceId) });
  context.after(() => restored.closeAll());
  assert.equal(restored.graph(value.project, graphA.graphId).nodes[0].state, "INTERRUPTED");
  const unitB = worktree(value, "recovery-b-unit", "recovery.js");
  const graphB = restored.createGraph(value.project, graphInput({ graphId: "recovery-b", nodes: [
    { nodeId: "writer-b", expectedFiles: ["recovery.js"], isolationWorkUnitId: unitB.workUnitId, utility: 0.9, risk: 0.1 }
  ] }));
  assert.equal(restored.claim(value.project, graphB.graphId, "writer-b").state, "RUNNING");
});

test("base enlazada se rechaza y el Coordinator no se expone al renderer", { skip: process.platform === "win32" }, (context) => {
  const value = fixture(context);
  value.coordinator.closeAll();
  const databasePath = path.join(value.root, ".dorn", "tasks", "multi-agent-coordinator.sqlite");
  const outside = path.join(os.tmpdir(), `dorn-multi-outside-${crypto.randomUUID()}.sqlite`);
  fs.writeFileSync(outside, "outside");
  context.after(() => fs.rmSync(outside, { force: true }));
  fs.symlinkSync(outside, databasePath);
  const unsafe = new MultiAgentCoordinator({ projectCore: value.projectCore, worktreeManager: value.worktreeManager });
  assert.throws(() => unsafe.createGraph(value.project, graphInput()), (error) => error.code === "MULTI_AGENT_STORAGE_UNSAFE");
  const sourceRoot = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(sourceRoot, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(sourceRoot, "out", "preload", "index.js"), "utf8");
  assert.match(main, /new MultiAgentCoordinator\(\{/);
  assert.match(main, /multiAgentCoordinator\.createGraph\(project/);
  assert.match(main, /multiAgentCoordinator\.claim\(project/);
  assert.match(main, /multiAgentCoordinator\.finishNode\(project/);
  assert.doesNotMatch(preload, /MultiAgentCoordinator|multi-agent-coordinator\.sqlite|temporary_claims|integrateWinner/);
});

test("Agent Manager conserva orden determinista aunque especialistas terminen fuera de orden", async () => {
  const policy = {
    id: "balanced", maxAgents: 4, maxIterations: 2, tokenBudget: 4096, timeBudgetSeconds: 30,
    maxTools: 4, maxFiles: 20, allowExternalProviders: true, parallel: true
  };
  const manager = new AgentManager({ modeManager: { current: () => policy } });
  const task = manager.plan({ objective: "programar una aplicación y revisar errores", projectId: "project", collaboration: true, maxAgents: 4 });
  const completed = await manager.run(task, async ({ role }) => {
    if (role === "programmer") await new Promise((resolve) => setTimeout(resolve, 15));
    if (role === "critic") await new Promise((resolve) => setTimeout(resolve, 1));
    return role;
  });
  assert.deepEqual(completed.results.map((entry) => entry.role), task.agents.map((agent) => agent.role));
  assert.deepEqual(completed.results.map((entry) => entry.result), task.agents.map((agent) => agent.role));
});
