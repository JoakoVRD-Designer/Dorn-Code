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

function fixture(context, id = "agent_session_project") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-${id}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const evidenceCore = new EvidenceCore();
  const jobRuntime = new DurableJobRuntime({ projectCore, evidenceCore, maxConcurrency: 1 });
  let broker = new AgentSessionBroker({ projectCore, jobRuntime, evidenceCore });
  context.after(() => { broker?.closeAll(); jobRuntime.closeAll(); evidenceCore.closeAll(); });
  const enqueue = (suffix = "one") => jobRuntime.enqueue(project, {
    type: "agent.runtime.task",
    goal: `Misión durable ${suffix}`,
    scope: { mutatesProject: false, expectedFiles: [] },
    successContract: { requiresVerifiedEvidence: true },
    idempotencyKey: `${id}:${suffix}`
  });
  return { root, project, projectCore, evidenceCore, jobRuntime, enqueue, get broker() { return broker; }, set broker(value) { broker = value; } };
}

test("Agent Session administra ciclo, attach/detach, stream, salud, uso y cuota sin secretos", (context) => {
  const item = fixture(context, "agent_session_lifecycle");
  const job = item.enqueue();
  const created = item.broker.create(item.project, { jobId: job.id, runtimeId: "openai-codex", objective: "Continuar una Work Unit" });
  assert.equal(created.state, "CREATED");
  assert.equal(created.workUnitId, job.id);
  assert.throws(
    () => item.broker.create(item.project, { jobId: job.id, runtimeId: "openai-codex", objective: "x", metadata: { apiToken: "secret-value-123456" } }),
    (error) => error.code === "AGENT_SESSION_SECRET_INLINE"
  );

  item.broker.start(item.project, created.sessionId, { externalSessionId: "codex-session-1" });
  item.broker.markRunning(item.project, created.sessionId);
  const attachment = item.broker.attach(item.project, created.sessionId, { consumerId: "work-ui", consumerKind: "observer" });
  assert.equal(item.broker.attachments(item.project, created.sessionId).length, 1);
  assert.throws(
    () => item.broker.attach(item.project, created.sessionId, { consumerId: "work-ui", consumerKind: "observer" }),
    (error) => error.code === "AGENT_SESSION_ALREADY_ATTACHED"
  );
  item.broker.appendEvent(item.project, created.sessionId, { type: "STATUS", payload: { phase: "inspection" } });
  const measured = item.broker.recordUsage(item.project, created.sessionId, {
    usage: { inputTokens: 120, outputTokens: 45, toolCalls: 2, costUsd: 0.02, latencyMs: 900 },
    quota: { state: "AVAILABLE", remaining: 800, limit: 1000, resetsAt: "2026-08-22T00:00:00Z" }
  });
  assert.equal(measured.usage.outputTokens, 45);
  assert.equal(measured.quota.state, "AVAILABLE");
  assert.throws(
    () => item.broker.recordUsage(item.project, created.sessionId, { usage: { inputTokens: 119 } }),
    (error) => error.code === "AGENT_SESSION_USAGE_REGRESSION"
  );
  assert.equal(item.broker.recordHealth(item.project, created.sessionId, { state: "HEALTHY", reason: "heartbeat" }).health.state, "HEALTHY");

  const paused = item.broker.pause(item.project, created.sessionId, "Pausa segura", { cursor: 17, pending: ["verify"] });
  assert.match(paused.stateHash, /^[a-f0-9]{64}$/);
  assert.equal(item.broker.get(item.project, created.sessionId).state, "PAUSED");
  item.broker.resume(item.project, created.sessionId);
  item.broker.markRunning(item.project, created.sessionId, { externalSessionId: "codex-session-2" });
  const checkpoint = item.broker.checkpoint(item.project, created.sessionId, "Ruta alternativa", { cursor: 21 });
  assert.equal(checkpoint.sequence, 2);
  assert.equal(item.broker.get(item.project, created.sessionId).state, "CHECKPOINTED");
  item.broker.cancel(item.project, created.sessionId);
  assert.equal(item.broker.get(item.project, created.sessionId).state, "CANCELLING");
  item.broker.confirmCancelled(item.project, created.sessionId);
  assert.equal(item.broker.get(item.project, created.sessionId).state, "CANCELLED");
  assert.throws(() => item.broker.appendEvent(item.project, created.sessionId, { type: "STATUS" }), (error) => error.code === "AGENT_SESSION_STREAM_FINAL");
  assert.equal(item.broker.detach(item.project, created.sessionId, attachment.consumerId).consumerId, "work-ui");
  assert.equal(item.broker.attachments(item.project, created.sessionId).length, 0);
  assert.equal(item.broker.attachments(item.project, created.sessionId, { includeDetached: true }).length, 1);
  assert.deepEqual(item.broker.stream(item.project, created.sessionId).map((event) => event.type), ["STATUS", "USAGE"]);
});

test("las sesiones son por proyecto y un reinicio sólo recupera efectos desde checkpoint", (context) => {
  const first = fixture(context, "agent_session_restart_a");
  const second = fixture(context, "agent_session_restart_b");
  const firstJob = first.enqueue("restart");
  const secondJob = second.enqueue("isolated");
  const resumable = first.broker.create(first.project, { jobId: firstJob.id, runtimeId: "openai-codex", objective: "Resumible" });
  first.broker.start(first.project, resumable.sessionId);
  first.broker.markRunning(first.project, resumable.sessionId);
  first.broker.checkpoint(first.project, resumable.sessionId, "Estado durable", { step: 4 });
  first.broker.resume(first.project, resumable.sessionId);
  const isolated = second.broker.create(second.project, { jobId: secondJob.id, runtimeId: "claude-code", objective: "Proyecto B" });
  assert.throws(() => second.broker.get(second.project, resumable.sessionId), (error) => error.code === "AGENT_SESSION_NOT_FOUND");
  assert.equal(second.broker.get(second.project, isolated.sessionId).projectId, second.project.id);
  assert.notEqual(
    path.join(first.root, ".dorn", "tasks", "agent-sessions.db"),
    path.join(second.root, ".dorn", "tasks", "agent-sessions.db")
  );

  first.broker.closeAll();
  first.broker = new AgentSessionBroker({ projectCore: first.projectCore, jobRuntime: first.jobRuntime, evidenceCore: first.evidenceCore });
  const recovered = first.broker.get(first.project, resumable.sessionId, { withCheckpoints: true });
  assert.equal(recovered.state, "RECOVERING");
  assert.equal(recovered.externalSessionId, null);
  assert.equal(recovered.checkpoints[0].state.step, 4);
  assert.equal(first.broker.recover(first.project, resumable.sessionId).state, "STARTING");

  const noCheckpoint = first.broker.create(first.project, { jobId: firstJob.id, workUnitId: "unsafe-restart", runtimeId: "openai-codex", objective: "Sin checkpoint" });
  first.broker.start(first.project, noCheckpoint.sessionId);
  first.broker.markRunning(first.project, noCheckpoint.sessionId);
  first.broker.closeAll();
  first.broker = new AgentSessionBroker({ projectCore: first.projectCore, jobRuntime: first.jobRuntime, evidenceCore: first.evidenceCore });
  assert.equal(first.broker.get(first.project, noCheckpoint.sessionId).state, "RECOVERING");
  assert.throws(() => first.broker.recover(first.project, noCheckpoint.sessionId), (error) => error.code === "AGENT_SESSION_CHECKPOINT_REQUIRED");
});

test("CrossAgentHandoff conserva provenance, Evidence y bytes; cualquier mutación exige retest", (context) => {
  const item = fixture(context, "agent_session_handoff");
  fs.mkdirSync(path.join(item.root, "src"));
  fs.writeFileSync(path.join(item.root, "src", "feature.js"), "module.exports = 'verified';\n");
  const job = item.enqueue("handoff");
  const evidence = item.evidenceCore.record(item.project, {
    evidenceType: "COMMAND", command: "node --test", scenario: "Prueba de bytes para handoff",
    result: "PASSED", exitCode: 0, truthState: "VERIFIED", files: ["src/feature.js"],
    environment: { independent: true }, tasks: [job.id], tests: ["feature.test.cjs"]
  });
  const session = item.broker.create(item.project, { jobId: job.id, workUnitId: "agent-handoff-unit", runtimeId: "openai-codex", objective: "Reparar feature" });
  item.broker.start(item.project, session.sessionId);
  item.broker.markRunning(item.project, session.sessionId);
  item.broker.checkpoint(item.project, session.sessionId, "Cuota agotada", { phase: "verified", cursor: 8 });
  const handoff = item.broker.createHandoff(item.project, session.sessionId, {
    toRuntimeId: "claude-code",
    findings: ["La implementación compila."], decisions: ["Conservar el contrato público."],
    filesChanged: ["src/feature.js"], patchRefs: ["patch-agent-handoff-1"],
    testsRun: [{ id: "feature-test", command: ["node", "--test", "feature.test.cjs"], passed: true, exitCode: 0, evidenceId: evidence.evidenceId }],
    evidence: [evidence.evidenceId], warnings: ["Falta runtime visual."], unresolved: ["Ejecutar captura real."],
    suggestedNextAction: "Reanudar desde el checkpoint y ejecutar la verificación visual."
  });
  assert.match(handoff.handoffHash, /^[a-f0-9]{64}$/);
  assert.equal(handoff.previousHandoffHash, null);
  assert.equal(handoff.evidence[0].truthState, "VERIFIED");
  const transferred = item.broker.get(item.project, session.sessionId);
  assert.equal(transferred.state, "RECOVERING");
  assert.equal(transferred.runtimeId, "claude-code");
  assert.equal(transferred.externalSessionId, null);
  assert.equal(item.broker.evaluateHandoff(item.project, handoff.handoffId).continuityState, "CURRENT");

  fs.writeFileSync(path.join(item.root, "src", "feature.js"), "module.exports = 'mutated-after-handoff';\n");
  const stale = item.broker.evaluateHandoff(item.project, handoff.handoffId);
  assert.equal(stale.continuityState, "NEEDS_RETEST");
  assert.equal(stale.sourceCurrent, false);
  assert.equal(stale.evidenceCurrent, false);

  const currentEvidence = item.evidenceCore.record(item.project, {
    evidenceType: "COMMAND", command: "node --test", scenario: "Retest posterior al handoff",
    result: "PASSED", exitCode: 0, truthState: "VERIFIED", files: ["src/feature.js"],
    environment: { independent: true }, tasks: [job.id], tests: ["feature-retest.test.cjs"]
  });
  item.broker.recover(item.project, session.sessionId);
  item.broker.markRunning(item.project, session.sessionId, { externalSessionId: "claude-session-2" });
  item.broker.checkpoint(item.project, session.sessionId, "Retest concluido", { phase: "retested" });
  const secondHandoff = item.broker.createHandoff(item.project, session.sessionId, {
    toRuntimeId: "gemini-cli", filesChanged: ["src/feature.js"], evidence: [currentEvidence.evidenceId],
    testsRun: [{ id: "feature-retest", command: ["node", "--test", "feature-retest.test.cjs"], passed: true, exitCode: 0, evidenceId: currentEvidence.evidenceId }],
    findings: ["Los bytes mutados fueron retesteados."], suggestedNextAction: "Continuar la siguiente acción desde el nuevo checkpoint."
  });
  assert.equal(secondHandoff.previousHandoffHash, handoff.handoffHash);
  const current = item.broker.evaluateHandoff(item.project, secondHandoff.handoffId);
  assert.equal(current.continuityState, "CURRENT");
  assert.equal(current.chainValid, true);
});

test("handoffs hostiles, sin checkpoint, con rutas externas o secretos se bloquean", (context) => {
  const item = fixture(context, "agent_session_hostile");
  fs.writeFileSync(path.join(item.root, "safe.js"), "safe\n");
  const job = item.enqueue("hostile");
  const session = item.broker.create(item.project, { jobId: job.id, runtimeId: "openai-codex", objective: "Hostile test" });
  item.broker.start(item.project, session.sessionId);
  item.broker.markRunning(item.project, session.sessionId);
  assert.throws(
    () => item.broker.createHandoff(item.project, session.sessionId, { toRuntimeId: "claude-code", suggestedNextAction: "seguir" }),
    (error) => error.code === "AGENT_HANDOFF_CHECKPOINT_REQUIRED"
  );
  item.broker.checkpoint(item.project, session.sessionId, "Seguro", { cursor: 1 });
  assert.throws(
    () => item.broker.createHandoff(item.project, session.sessionId, { toRuntimeId: "claude-code", filesChanged: ["../escape.js"], suggestedNextAction: "seguir" }),
    (error) => error.code === "AGENT_HANDOFF_PATH_UNSAFE"
  );
  assert.throws(
    () => item.broker.createHandoff(item.project, session.sessionId, { toRuntimeId: "openai-codex", filesChanged: ["safe.js"], suggestedNextAction: "seguir" }),
    (error) => error.code === "AGENT_HANDOFF_RUNTIME_UNCHANGED"
  );
  assert.throws(
    () => item.broker.createHandoff(item.project, session.sessionId, { toRuntimeId: "claude-code", filesChanged: ["safe.js"], findings: ["Authorization: Bearer abcdefghijklmnop"], suggestedNextAction: "seguir" }),
    (error) => error.code === "AGENT_SESSION_SECRET_INLINE"
  );
  assert.throws(
    () => item.broker.createHandoff(item.project, session.sessionId, {
      toRuntimeId: "claude-code", filesChanged: ["safe.js"],
      testsRun: [{ id: "false-pass", command: ["node", "--test"], passed: true, exitCode: 1 }],
      suggestedNextAction: "seguir"
    }),
    (error) => error.code === "AGENT_HANDOFF_TEST_INCONSISTENT"
  );
  assert.throws(
    () => item.broker.createHandoff(item.project, session.sessionId, {
      toRuntimeId: "claude-code", filesChanged: ["safe.js"],
      testsRun: [{ id: "unlinked-evidence", command: ["node", "--test"], passed: true, exitCode: 0, evidenceId: "evidence-not-declared" }],
      suggestedNextAction: "seguir"
    }),
    (error) => error.code === "AGENT_HANDOFF_TEST_EVIDENCE_UNLINKED"
  );
  const incomplete = item.broker.createHandoff(item.project, session.sessionId, {
    toRuntimeId: "claude-code", filesChanged: ["missing-after-delete.js"],
    warnings: ["El archivo fue declarado pero no existe en la fuente observable."], suggestedNextAction: "Reconstruir o evidenciar la eliminación antes de continuar."
  });
  assert.equal(item.broker.evaluateHandoff(item.project, incomplete.handoffId).continuityState, "NEEDS_RETEST");
});

test("Agent Session Broker queda en main y no expone SQLite, sesiones ni handoffs al renderer", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(main, /const \{ AgentSessionBroker \} = require\("\.\/dorn-core\/agent-session-broker"\)/);
  assert.match(main, /agentSessionBroker = new AgentSessionBroker\(\{ projectCore, jobRuntime, evidenceCore, eventBus, contextCompiler \}\)/);
  assert.match(main, /agentSessionBroker\?\.closeAll\(\)/);
  assert.doesNotMatch(preload, /agentSessionBroker|cross-agent-handoff|agent-sessions\.db|createHandoff/);
});
