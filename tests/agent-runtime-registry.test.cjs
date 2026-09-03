"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { EvidenceCore } = require("../out/main/dorn-core/evidence-core");
const { DurableJobRuntime } = require("../out/main/dorn-core/job-runtime");
const { AgentSessionBroker } = require("../out/main/dorn-core/agent-session-broker");
const {
  AgentRuntimeRegistry, CodexAgentRuntimeAdapter, AGENT_RUNTIME_CONTRACT_VERSION, ADAPTER_METHODS,
  findExecutable, executableFingerprint, sameFingerprint
} = require("../out/main/dorn-core/agent-runtime-registry");

function temporary(context, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function executable(context, body, name = "codex") {
  const bin = temporary(context, "dorn-agent-runtime-bin-");
  const filePath = path.join(bin, name);
  fs.writeFileSync(filePath, body, { mode: 0o755 });
  return { bin, filePath };
}

function projectFixture(context, id = "agent_runtime_project") {
  const root = temporary(context, `dorn-${id}-`);
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const evidenceCore = new EvidenceCore();
  const jobRuntime = new DurableJobRuntime({ projectCore, evidenceCore, maxConcurrency: 1 });
  const sessionBroker = new AgentSessionBroker({ projectCore, jobRuntime, evidenceCore });
  context.after(() => { sessionBroker.closeAll(); jobRuntime.closeAll(); evidenceCore.closeAll(); });
  return { root, project, projectCore, evidenceCore, jobRuntime, sessionBroker };
}

function manifest(runtimeId, extra = {}) {
  return {
    schema: "dorn.agent-runtime-adapter/1", runtimeId, label: runtimeId, vendor: "test",
    operations: Object.fromEntries(ADAPTER_METHODS.map((method) => [method, "NOT_IMPLEMENTED"])),
    ...extra
  };
}

function fakeAdapter(id, overrides = {}) {
  const adapter = {
    runtimeId: id,
    contractVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    manifest: manifest(id),
    discover: () => ({ runtimeId: id, state: "DISCOVERED_UNVERIFIED", installed: true }),
    healthCheck: () => ({ runtimeId: id, health: "HEALTHY", version: "test 1.0" }),
    discoverCapabilities: () => ({ runtimeId: id, state: "OBSERVED", capabilities: [] }),
    discoverModelsOrRoutes: () => ({ runtimeId: id, state: "OBSERVED", routes: [] }),
    startSession() {}, resumeSession() {}, runTask() {}, streamEvents() {}, collectArtifacts() {}, collectUsage() {},
    cancel() {}, checkpoint() {}, benchmark() {}
  };
  return Object.assign(adapter, overrides);
}

test("Codex ausente queda NOT_INSTALLED y ninguna operación se finge", (context) => {
  const item = projectFixture(context, "agent_runtime_absent");
  const emptyPath = temporary(context, "dorn-agent-runtime-empty-");
  let spawned = 0;
  const adapter = new CodexAgentRuntimeAdapter({ environmentPath: emptyPath, spawnSync: () => { spawned += 1; throw new Error("no debe ejecutarse"); } });
  const registry = new AgentRuntimeRegistry({ sessionBroker: item.sessionBroker, codexAdapter: adapter });
  const status = registry.status("openai-codex");
  assert.equal(status.observation.state, "NOT_INSTALLED");
  assert.equal(status.taskReady, false);
  assert.equal(registry.healthCheck("openai-codex").health, "NOT_INSTALLED");
  assert.equal(registry.discoverCapabilities("openai-codex").state, "NOT_EXECUTED");
  assert.equal(registry.discoverModelsOrRoutes("openai-codex").routes.length, 0);
  assert.equal(spawned, 0);
  assert.throws(() => adapter.runTask(), (error) => error.code === "AGENT_RUNTIME_OPERATION_UNAVAILABLE");
  const job = item.jobRuntime.enqueue(item.project, {
    type: "agent.runtime.task", goal: "No inventar Codex", scope: { mutatesProject: false, expectedFiles: [] },
    successContract: { requiresVerifiedEvidence: true }
  });
  assert.throws(
    () => registry.prepareSession(item.project, { jobId: job.id, runtimeId: "openai-codex", objective: "No crear sesión falsa" }),
    (error) => error.code === "AGENT_RUNTIME_NOT_AVAILABLE"
  );
  assert.equal(item.sessionBroker.list(item.project).length, 0);
});

test("Codex detectable se hashea, prueba sin shell y descubre sólo capacidades observadas", (context) => {
  const script = executable(context, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo 'codex-cli 9.9.9'; exit 0; fi",
    "if [ \"$1\" = \"--help\" ]; then echo 'exec resume --json --sandbox --model MCP skills'; exit 0; fi",
    "exit 3",
    ""
  ].join("\n"));
  const adapter = new CodexAgentRuntimeAdapter({ environmentPath: script.bin });
  const observed = adapter.discover();
  assert.equal(observed.installed, true);
  assert.match(observed.executable.sha256, /^[a-f0-9]{64}$/);
  assert.equal(observed.executable.wrapperRequiresShell, false);
  const health = adapter.healthCheck();
  assert.equal(health.health, "HEALTHY");
  assert.equal(health.version, "codex-cli 9.9.9");
  const capabilities = adapter.discoverCapabilities();
  assert.equal(capabilities.state, "OBSERVED");
  assert.deepEqual(capabilities.capabilities, ["mcp", "model.select", "sandbox", "session.resume", "skills", "structured-output", "task.run"]);
  assert.match(capabilities.helpHash, /^[a-f0-9]{64}$/);
  const routes = adapter.discoverModelsOrRoutes();
  assert.equal(routes.state, "OBSERVED_LOCAL_ROUTE");
  assert.equal(routes.models.length, 0);
  assert.equal(routes.modelDiscovery, "NOT_IMPLEMENTED");

  const before = observed.executable;
  fs.appendFileSync(script.filePath, "# changed after discovery\n");
  const after = executableFingerprint(script.filePath);
  assert.equal(sameFingerprint(before, after), false);
  assert.throws(() => adapter.probe(observed, ["--version"]), (error) => error.code === "AGENT_RUNTIME_EXECUTABLE_CHANGED");
});

test("el Registry rechaza adapters incompletos, incompatibles, duplicados o con secretos", (context) => {
  const item = projectFixture(context, "agent_runtime_contract");
  const emptyPath = temporary(context, "dorn-agent-runtime-contract-empty-");
  const registry = new AgentRuntimeRegistry({ sessionBroker: item.sessionBroker, environmentPath: emptyPath });
  const incomplete = fakeAdapter("incomplete");
  delete incomplete.runTask;
  assert.throws(() => registry.register(incomplete), (error) => error.code === "AGENT_RUNTIME_ADAPTER_INVALID");
  assert.throws(
    () => registry.register(fakeAdapter("future-contract", { contractVersion: "999" })),
    (error) => error.code === "AGENT_RUNTIME_CONTRACT_INCOMPATIBLE"
  );
  assert.throws(
    () => registry.register(fakeAdapter("secret-adapter", { manifest: manifest("secret-adapter", { apiToken: "never-persist-this" }) })),
    (error) => error.code === "AGENT_RUNTIME_SECRET_INLINE"
  );
  assert.throws(() => registry.register(fakeAdapter("openai-codex")), (error) => error.code === "AGENT_RUNTIME_DUPLICATE");
});

test("sólo un adapter saludable con startSession disponible prepara una sesión ligada al Job", (context) => {
  const item = projectFixture(context, "agent_runtime_session");
  item.sessionBroker.contextCompiler = {
    validate: (_project, contextPackId) => ({ state: contextPackId === "context-pack-fresh" ? "FRESH" : "STALE" }),
    get: () => ({ contextPackId: "context-pack-fresh", projectId: item.project.id, jobId: null, workUnitId: null, packHash: "a".repeat(64) })
  };
  const codex = fakeAdapter("openai-codex", {
    manifest: manifest("openai-codex", { operations: { ...manifest("x").operations, healthCheck: "AVAILABLE", startSession: "AVAILABLE" } }),
    discover: () => ({ runtimeId: "openai-codex", state: "VERIFIED_TASK_READY", installed: true }),
    healthCheck: () => ({ runtimeId: "openai-codex", health: "HEALTHY", version: "codex-test 1.0" })
  });
  const registry = new AgentRuntimeRegistry({
    sessionBroker: item.sessionBroker,
    codexAdapter: codex
  });
  const job = item.jobRuntime.enqueue(item.project, {
    type: "agent.runtime.task", goal: "Preparar una sesión real", scope: { mutatesProject: false, expectedFiles: [] },
    successContract: { requiresVerifiedEvidence: true }
  });
  assert.throws(
    () => registry.prepareSession(item.project, { jobId: job.id, runtimeId: "openai-codex", objective: "Sin contexto" }),
    (error) => error.code === "AGENT_RUNTIME_CONTEXT_REQUIRED"
  );
  const prepared = registry.prepareSession(item.project, { jobId: job.id, runtimeId: "openai-codex", contextPackId: "context-pack-fresh", objective: "Preparar, no ejecutar" });
  assert.equal(prepared.session.state, "CREATED");
  assert.equal(prepared.session.jobId, job.id);
  assert.equal(prepared.session.contextPackId, "context-pack-fresh");
  assert.equal(prepared.session.health.state, "HEALTHY");
  assert.equal(prepared.runtime.health, "HEALTHY");
  assert.equal(registry.status("openai-codex").taskReady, true);
});

test("Agent Runtime Registry permanece en main y no entrega procesos ni adapters al renderer", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(main, /const \{ AgentRuntimeRegistry \} = require\("\.\/dorn-core\/agent-runtime-registry"\)/);
  assert.match(main, /agentRuntimeRegistry = new AgentRuntimeRegistry\(\{ sessionBroker: agentSessionBroker \}\)/);
  assert.doesNotMatch(preload, /AgentRuntimeRegistry|CodexAgentRuntimeAdapter|agent-runtime-registry|runTask\(|spawnSync/);
});

test("findExecutable ignora archivos no ejecutables y conserva el hash exacto del binario real", (context) => {
  const bin = temporary(context, "dorn-agent-runtime-find-");
  const blocked = path.join(bin, "blocked");
  fs.writeFileSync(blocked, "not executable\n", { mode: 0o600 });
  assert.equal(findExecutable("blocked", { environmentPath: bin }), null);
  const allowed = path.join(bin, "allowed");
  fs.writeFileSync(allowed, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const found = findExecutable("allowed", { environmentPath: bin });
  assert.equal(found.path, fs.realpathSync(allowed));
  assert.match(found.sha256, /^[a-f0-9]{64}$/);
});
