"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { ProjectIntegrityEngine } = require("../out/main/dorn-core/project-integrity");
const { EvidenceCore } = require("../out/main/dorn-core/evidence-core");
const { StateCore } = require("../out/main/dorn-core/state-core");
const { ContextCompiler } = require("../out/main/dorn-core/context-compiler");
const { DurableJobRuntime } = require("../out/main/dorn-core/job-runtime");
const { AgentSessionBroker } = require("../out/main/dorn-core/agent-session-broker");

const sourceRoot = path.resolve(__dirname, "..");

function temporary(context, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function adopted(context, projectCore, id) {
  const root = temporary(context, `dorn-context-${id}-`);
  projectCore.adopt(root, { projectId: id, name: id });
  return { id, name: id, rootPath: root };
}

function scan(engine, project) {
  let status = engine.start(project);
  let guard = 0;
  while (status.nextCursor && guard < 10_000) {
    status = engine.scanPage(project, { scanId: status.nextCursor, fileBudget: 1000, timeBudgetMs: 5000 });
    guard += 1;
  }
  assert.equal(status.state, "COMPLETED");
  return status;
}

function harness(context, id = "context_a") {
  const projectCore = new ProjectCore();
  const project = adopted(context, projectCore, id);
  const projectIntegrity = new ProjectIntegrityEngine({ projectCore });
  const evidenceCore = new EvidenceCore();
  const compiler = new ContextCompiler({ projectCore, projectIntegrity, evidenceCore });
  context.after(() => {
    compiler.closeAll();
    projectIntegrity.closeAll();
    evidenceCore.closeAll();
  });
  return { projectCore, project, projectIntegrity, evidenceCore, compiler };
}

test("Context Compiler crea un Working Set pequeño con procedencia, razones, presupuesto y secretos excluidos", (context) => {
  const { project, projectIntegrity, compiler } = harness(context, "context_relevant");
  fs.mkdirSync(path.join(project.rootPath, "src"));
  fs.mkdirSync(path.join(project.rootPath, "tests"));
  fs.writeFileSync(path.join(project.rootPath, "package.json"), JSON.stringify({ name: "kimi-connector", scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(project.rootPath, "src", "kimi-client.js"), "export function connectKimi(model) { return { provider: 'moonshot', model }; }\n");
  fs.writeFileSync(path.join(project.rootPath, "src", "unrelated.js"), "export const unrelated = true;\n");
  fs.writeFileSync(path.join(project.rootPath, "tests", "kimi.test.js"), "import { connectKimi } from '../src/kimi-client.js'; void connectKimi;\n");
  fs.writeFileSync(path.join(project.rootPath, ".env"), "API_KEY=sk-this-must-never-enter-context\n");
  scan(projectIntegrity, project);

  const pack = compiler.build(project, {
    query: "conexión automática Kimi Moonshot",
    requestedFiles: ["src/kimi-client.js", ".env"],
    requirements: [{ id: "REQ-KIMI-AUTO", title: "Kimi sin plantillas manuales", content: "El usuario introduce únicamente su clave y DORN verifica la conexión.", source: "PDF_CURRENT" }],
    decisions: [{ id: "DEC-SAFE-ACTIVATION", title: "Activación comprobada", content: "La configuración anterior permanece activa hasta que la prueba real pase.", source: "PROJECT_TRUTH" }],
    budget: { maxChars: 12_000, maxFiles: 4, maxEntries: 12, maxCharsPerFile: 4_000 }
  });
  assert.equal(pack.schema, "dorn.context-pack/2");
  assert.equal(pack.state, "FRESH");
  assert.match(pack.packHash, /^[a-f0-9]{64}$/);
  assert.ok(pack.budget.usedChars <= pack.budget.maxChars);
  assert.ok(pack.budget.usedFiles <= pack.budget.maxFiles);
  assert.ok(pack.budget.usedEntries <= pack.budget.maxEntries);
  const kimi = pack.selection.entries.find((entry) => entry.path === "src/kimi-client.js");
  assert.ok(kimi);
  assert.equal(kimi.source, "PROJECT_INTEGRITY");
  assert.equal(kimi.freshness, "HASH_VERIFIED");
  assert.ok(kimi.selectionReasons.includes("EXPLICIT_FILE"));
  assert.ok(pack.selection.entries.some((entry) => entry.kind === "REQUIREMENT" && entry.id === "REQ-KIMI-AUTO"));
  assert.ok(pack.selection.exclusions.some((entry) => entry.path === ".env" && entry.reason === "PRIVATE_PATH"));
  assert.doesNotMatch(JSON.stringify(pack), /sk-this-must-never-enter-context/);
  assert.equal(compiler.validate(project, pack.contextPackId).state, "FRESH");
});

test("Context Compiler invalida únicamente los packs afectados y detecta bytes mutados", (context) => {
  const { project, projectIntegrity, compiler } = harness(context, "context_targeted");
  fs.writeFileSync(path.join(project.rootPath, "alpha.js"), "export const alpha = 1;\n");
  fs.writeFileSync(path.join(project.rootPath, "beta.js"), "export const beta = 1;\n");
  scan(projectIntegrity, project);
  const alpha = compiler.build(project, { query: "alpha", requestedFiles: ["alpha.js"], budget: { maxFiles: 1, maxChars: 4_000, maxEntries: 5 } });
  const beta = compiler.build(project, { query: "beta", requestedFiles: ["beta.js"], budget: { maxFiles: 1, maxChars: 4_000, maxEntries: 5 } });
  const invalidated = compiler.invalidate(project, "alpha.js");
  assert.equal(invalidated.invalidatedPacks, 1);
  assert.equal(compiler.get(project, alpha.contextPackId).state, "STALE");
  assert.equal(compiler.get(project, beta.contextPackId).state, "FRESH");
  fs.writeFileSync(path.join(project.rootPath, "beta.js"), "export const beta = 2;\n");
  const validation = compiler.validate(project, beta.contextPackId);
  assert.equal(validation.state, "STALE");
  assert.ok(validation.reasons.some((reason) => reason.sourceId === "beta.js"));
});

test("Context Compiler exige índice completo y fresco; no inventa archivos solicitados", (context) => {
  const { project, projectIntegrity, compiler } = harness(context, "context_truth");
  fs.writeFileSync(path.join(project.rootPath, "main.js"), "export const main = true;\n");
  assert.throws(() => compiler.build(project, { query: "main", requestedFiles: ["main.js"] }), (error) => error.code === "CONTEXT_SCAN_REQUIRED");
  scan(projectIntegrity, project);
  assert.throws(() => compiler.build(project, { query: "missing", requestedFiles: ["missing.js"] }), (error) => error.code === "CONTEXT_REQUESTED_FILE_NOT_INDEXED");
  projectIntegrity.invalidate(project, "main.js");
  assert.throws(() => compiler.build(project, { query: "main", requestedFiles: ["main.js"] }), (error) => error.code === "CONTEXT_INDEX_STALE");
});

test("Context Compiler aísla A→B y descarta un scope de conversación obsoleto", async (context) => {
  const projectCore = new ProjectCore();
  const projectA = adopted(context, projectCore, "context_scope_a");
  const projectB = adopted(context, projectCore, "context_scope_b");
  fs.writeFileSync(path.join(projectA.rootPath, "a.js"), "export const a = true;\n");
  fs.writeFileSync(path.join(projectB.rootPath, "b.js"), "export const b = true;\n");
  const integrity = new ProjectIntegrityEngine({ projectCore });
  const state = new StateCore({ resolveConversation: async (id) => id === "conversation-a" ? { id, projectId: projectA.id } : { id, projectId: projectB.id } });
  const compiler = new ContextCompiler({ projectCore, projectIntegrity: integrity, stateCore: state });
  context.after(() => { compiler.closeAll(); integrity.closeAll(); });
  scan(integrity, projectA);
  scan(integrity, projectB);
  const selectedA = await state.selectConversation("conversation-a", { load: async () => ({ id: "working-a" }) });
  const scopeA = { conversationId: "conversation-a", generation: selectedA.state.active.generation };
  const packA = compiler.build(projectA, { query: "a", requestedFiles: ["a.js"], scope: scopeA });
  const selectedB = await state.selectConversation("conversation-b", { load: async () => ({ id: "working-b" }) });
  assert.throws(() => compiler.build(projectA, { query: "a", requestedFiles: ["a.js"], scope: scopeA }), /scope activo|proyecto no pertenece/);
  const packB = compiler.build(projectB, { query: "b", requestedFiles: ["b.js"], scope: { conversationId: "conversation-b", generation: selectedB.state.active.generation } });
  assert.equal(packA.projectId, projectA.id);
  assert.equal(packB.projectId, projectB.id);
  assert.throws(() => compiler.get(projectB, packA.contextPackId), (error) => error.code === "CONTEXT_PACK_NOT_FOUND");
});

test("Context Compiler mantiene acotada la selección en un proyecto grande", (context) => {
  const { project, projectIntegrity, compiler } = harness(context, "context_scale");
  fs.mkdirSync(path.join(project.rootPath, "src"));
  for (let index = 0; index < 1_500; index += 1) {
    fs.writeFileSync(path.join(project.rootPath, "src", `module-${String(index).padStart(4, "0")}.js`), `export const module${index} = ${index};\n`);
  }
  const status = scan(projectIntegrity, project);
  assert.equal(status.files, 1_500);
  const pack = compiler.build(project, {
    query: "module-1499",
    requestedFiles: ["src/module-1499.js"],
    budget: { maxChars: 6_000, maxFiles: 3, maxEntries: 5, maxCharsPerFile: 2_000 }
  });
  assert.ok(pack.selection.candidateCount <= 200);
  assert.ok(pack.budget.usedFiles <= 3);
  assert.ok(pack.budget.usedEntries <= 5);
  assert.ok(pack.selection.entries.some((entry) => entry.path === "src/module-1499.js"));
  assert.ok(pack.sourceIndex.indexedFiles === 1_500);
});

test("Agent Session acepta sólo el ContextPack fresco del mismo Job y Work Unit", (context) => {
  const { project, projectCore, projectIntegrity, evidenceCore, compiler } = harness(context, "context_agent_link");
  fs.writeFileSync(path.join(project.rootPath, "task.js"), "export const task = 'bounded';\n");
  scan(projectIntegrity, project);
  const jobRuntime = new DurableJobRuntime({ projectCore, evidenceCore, maxConcurrency: 1 });
  const broker = new AgentSessionBroker({ projectCore, jobRuntime, evidenceCore, contextCompiler: compiler });
  context.after(() => { broker.closeAll(); jobRuntime.closeAll(); });
  const enqueue = (suffix) => jobRuntime.enqueue(project, {
    type: "agent.runtime.task", goal: `Ejecutar ${suffix}`,
    scope: { mutatesProject: false, expectedFiles: [] },
    successContract: { requiresVerifiedEvidence: true }, idempotencyKey: `context-agent-${suffix}`
  });
  const job = enqueue("principal");
  const pack = compiler.build(project, {
    query: "task bounded", requestedFiles: ["task.js"], jobId: job.id, workUnitId: "wu-context-main"
  });
  const session = broker.create(project, {
    jobId: job.id, workUnitId: "wu-context-main", runtimeId: "openai-codex",
    contextPackId: pack.contextPackId, objective: "Ejecutar sólo el Working Set"
  });
  assert.equal(session.contextPackId, pack.contextPackId);
  broker.start(project, session.sessionId);
  broker.markRunning(project, session.sessionId);
  broker.checkpoint(project, session.sessionId, "Contexto preparado", { phase: "context-ready" });
  const handoff = broker.createHandoff(project, session.sessionId, {
    toRuntimeId: "claude-code", findings: ["Working Set acotado y verificado."],
    suggestedNextAction: "Continuar usando exactamente el ContextPack transferido."
  });
  assert.equal(handoff.contextPackId, pack.contextPackId);
  assert.equal(handoff.contextPackHash, pack.packHash);
  assert.equal(broker.evaluateHandoff(project, handoff.handoffId).contextCurrent, true);
  const otherJob = enqueue("otro");
  assert.throws(
    () => broker.create(project, { jobId: otherJob.id, workUnitId: "wu-context-main", runtimeId: "openai-codex", contextPackId: pack.contextPackId, objective: "Scope incorrecto" }),
    (error) => error.code === "AGENT_SESSION_CONTEXT_SCOPE_MISMATCH"
  );
  compiler.invalidate(project, "task.js");
  const staleHandoff = broker.evaluateHandoff(project, handoff.handoffId);
  assert.equal(staleHandoff.continuityState, "NEEDS_RETEST");
  assert.equal(staleHandoff.contextCurrent, false);
  assert.throws(
    () => broker.create(project, { jobId: job.id, workUnitId: "wu-context-main", runtimeId: "openai-codex", contextPackId: pack.contextPackId, objective: "Contexto obsoleto" }),
    (error) => error.code === "AGENT_SESSION_CONTEXT_STALE"
  );
});

test("la aplicación integra Context Compiler internamente sin exponer un atajo en preload", () => {
  const main = fs.readFileSync(path.join(sourceRoot, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(sourceRoot, "out", "preload", "index.js"), "utf8");
  assert.match(main, /new ContextCompiler\(\{ projectCore, projectIntegrity, evidenceCore, stateCore, eventBus \}\)/);
  assert.match(main, /eventBus\.subscribe\("FILE_MODIFIED", "context-compiler-invalidator"/);
  assert.match(main, /new AgentSessionBroker\(\{ projectCore, jobRuntime, evidenceCore, eventBus, contextCompiler \}\)/);
  assert.match(main, /contextCompiler\?\.closeAll\(\)/);
  assert.doesNotMatch(preload, /contextPack|contextCompiler/i);
  assert.doesNotMatch(main, /PRE-IDE.*renderer|renderer.*4\.9/i);
});
