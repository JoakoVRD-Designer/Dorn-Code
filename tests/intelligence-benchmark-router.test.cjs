"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  IntelligenceBenchmarkRouter,
  normalizeCombination,
  observationMetrics
} = require("../out/main/dorn-core/intelligence-benchmark-router");

function sha(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function combo(name, overrides = {}) {
  return {
    model: `model-${name}`, harness: `harness-${name}`, accessRoute: `route-${name}`,
    skills: ["review", "code"], tools: ["tests"], contextStrategy: "working-set-v2", ...overrides
  };
}
function fixture(context, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-benchmark-router-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidence = new Map();
  const units = new Map();
  const instance = new IntelligenceBenchmarkRouter({
    filePath: path.join(root, "router.sqlite"), ownerId: options.ownerId || "dorn-test",
    resolveEvidence: options.withoutEvidence ? null : ({ evidenceId }) => evidence.get(evidenceId),
    resolveIsolation: options.withoutIsolation ? null : ({ workUnitId }) => units.get(workUnitId)
  });
  context.after(() => { try { instance.close(); } catch {} });
  return { root, instance, evidence, units };
}
function verifiedObservation(instance, evidence, name, input = {}) {
  const sourceHash = sha(`source-${name}`);
  const evidenceId = `evidence-${name}`;
  const taskFingerprint = sha(`task-${name}`);
  const outputHash = sha(`output-${name}`);
  const quality = input.quality ?? 0.8;
  const latencyMs = input.latencyMs ?? 100;
  const costUsd = input.costUsd ?? null;
  const evaluatorId = `independent-${name}`;
  const started = instance.beginObservation({
    projectId: input.projectId || "project-a", taskKind: input.taskKind || "programacion",
    combo: input.combo || combo(name), mode: input.mode || "OFFICIAL", workUnitId: input.workUnitId || `work-${name}`,
    taskFingerprint, sourceHash, isolationId: input.mode && input.mode !== "OFFICIAL" ? `isolation-${name}` : null
  });
  evidence.set(evidenceId, {
    schema: "dorn.evidence/2", evidenceId, projectId: input.projectId || "project-a",
    truthState: "VERIFIED", result: "PASSED", sourceHash, linkedToWorkUnit: true, independent: true,
    verifier: { id: evaluatorId, independent: true },
    details: { benchmark: { taskFingerprint, comboKey: started.comboKey, outputHash, success: input.success !== false, quality, latencyMs, costUsd } }
  });
  return instance.finishObservation(started.observationId, {
    success: input.success !== false, quality, latencyMs,
    costUsd, outputHash, verified: true,
    evidenceId, evaluatorId, revisionHash: sourceHash,
    failureFamily: input.success === false ? "VALIDATION" : undefined
  });
}

test("la combinación exacta es estable y separa modelo, harness, ruta, skills, tools y contexto", () => {
  const first = normalizeCombination(combo("a", { skills: ["review", "code", "review"], tools: ["tests", "lint"] }));
  const second = normalizeCombination(combo("a", { skills: ["code", "review"], tools: ["lint", "tests"] }));
  assert.equal(first.comboKey, second.comboKey);
  assert.deepEqual(first.normalized.skills, ["code", "review"]);
  assert.notEqual(first.comboKey, normalizeCombination(combo("a", { contextStrategy: "full-repo" })).comboKey);
  assert.throws(() => normalizeCombination(combo("bad", { model: "sk-live-secret-value-123456789" })), (error) => error.code === "BENCHMARK_SECRET_REJECTED");
});

test("Router explica cold start y cambia sólo por historial oficial con Evidence independiente", (context) => {
  const { instance, evidence } = fixture(context);
  const candidates = [
    { candidateId: "route-a", available: true, priority: 10, capabilities: ["text", "code"], combo: combo("a") },
    { candidateId: "route-b", available: true, priority: 20, capabilities: ["text", "code"], combo: combo("b") }
  ];
  const cold = instance.plan({ projectId: "project-a", taskKind: "programacion", requiredCapabilities: ["code"], candidates });
  assert.equal(cold.state, "SELECTED_COLD_START");
  assert.equal(cold.selected.candidateId, "route-a");
  assert.match(cold.reasons.join(" "), /sin historial oficial verificado/);

  verifiedObservation(instance, evidence, "a", { combo: combo("a"), quality: 0.55, latencyMs: 900 });
  verifiedObservation(instance, evidence, "b", { combo: combo("b"), quality: 0.98, latencyMs: 80 });
  const learned = instance.plan({ projectId: "project-a", taskKind: "programacion", requiredCapabilities: ["code"], candidates });
  assert.equal(learned.state, "SELECTED");
  assert.equal(learned.selected.candidateId, "route-b");
  assert.equal(learned.basis, "HISTORICAL_INDEPENDENT_EVIDENCE");
  assert.match(learned.reasons.join(" "), /Evidence independiente/);
});

test("fallos verificados reducen éxito y observaciones no verificadas nunca manipulan el ranking", (context) => {
  const { instance, evidence } = fixture(context);
  verifiedObservation(instance, evidence, "stable", { combo: combo("stable"), quality: 0.8 });
  verifiedObservation(instance, evidence, "failing", { combo: combo("failing"), success: false, quality: 0 });
  const unverified = instance.beginObservation({
    projectId: "project-a", taskKind: "programacion", combo: combo("failing"), mode: "OFFICIAL",
    workUnitId: "work-unverified", taskFingerprint: sha("unverified"), sourceHash: sha("source-unverified")
  });
  instance.finishObservation(unverified.observationId, { success: true, quality: 1, latencyMs: 1, outputHash: sha("unverified-output") });
  const plan = instance.plan({ projectId: "project-a", taskKind: "programacion", candidates: [
    { candidateId: "stable", available: true, priority: 50, capabilities: ["text"], combo: combo("stable") },
    { candidateId: "failing", available: true, priority: 1, capabilities: ["text"], combo: combo("failing") }
  ] });
  assert.equal(plan.selected.candidateId, "stable");
  assert.equal(instance.metrics("project-a", "programacion", normalizeCombination(combo("failing")).comboKey).successRate, 0);
  assert.equal(observationMetrics([{ mode: "SHADOW", state: "SUCCEEDED", verified: 1, independent: 1, success: 1, quality: 1, latency_ms: 1, cost_usd: 0 }]).verifiedSamples, 0);
});

test("Evidence falsa, de otro proyecto, otros bytes o autoevaluada se rechaza", (context) => {
  const { instance, evidence } = fixture(context);
  const sourceHash = sha("source-hostile");
  const started = instance.beginObservation({ projectId: "project-a", taskKind: "code", combo: combo("hostile"), mode: "OFFICIAL", workUnitId: "work-hostile", taskFingerprint: sha("task-hostile"), sourceHash });
  const attestation = { taskFingerprint: sha("task-hostile"), comboKey: started.comboKey, outputHash: sha("out"), success: true, quality: 1, latencyMs: 0, costUsd: null };
  evidence.set("evidence-hostile", { evidenceId: "evidence-hostile", projectId: "project-b", truthState: "VERIFIED", result: "PASSED", sourceHash, linkedToWorkUnit: true, independent: true, verifier: { id: "reviewer" }, details: { benchmark: attestation } });
  assert.throws(() => instance.finishObservation(started.observationId, { success: true, quality: 1, outputHash: sha("out"), verified: true, evidenceId: "evidence-hostile", evaluatorId: "reviewer", revisionHash: sourceHash }), (error) => error.code === "BENCHMARK_EVIDENCE_INVALID");

  evidence.set("evidence-hostile", { evidenceId: "evidence-hostile", projectId: "project-a", truthState: "VERIFIED", result: "PASSED", sourceHash: sha("other"), linkedToWorkUnit: true, independent: true, verifier: { id: "reviewer" }, details: { benchmark: attestation } });
  assert.throws(() => instance.finishObservation(started.observationId, { success: true, quality: 1, outputHash: sha("out"), verified: true, evidenceId: "evidence-hostile", evaluatorId: "reviewer", revisionHash: sourceHash }), (error) => error.code === "BENCHMARK_EVIDENCE_SOURCE_MISMATCH");

  evidence.set("evidence-hostile", { evidenceId: "evidence-hostile", projectId: "project-a", truthState: "VERIFIED", result: "PASSED", sourceHash, linkedToWorkUnit: true, independent: true, verifier: { id: "harness-hostile" }, details: { benchmark: attestation } });
  assert.throws(() => instance.finishObservation(started.observationId, { success: true, quality: 1, outputHash: sha("out"), verified: true, evidenceId: "evidence-hostile", evaluatorId: "harness-hostile", revisionHash: sourceHash }), (error) => error.code === "BENCHMARK_SELF_EVALUATION_BLOCKED");

  evidence.set("evidence-hostile", { evidenceId: "evidence-hostile", projectId: "project-a", truthState: "VERIFIED", result: "PASSED", sourceHash, linkedToWorkUnit: true, independent: true, verifier: { id: "reviewer" }, details: { benchmark: { ...attestation, quality: 0.25 } } });
  assert.throws(() => instance.finishObservation(started.observationId, { success: true, quality: 1, outputHash: sha("out"), verified: true, evidenceId: "evidence-hostile", evaluatorId: "reviewer", revisionHash: sourceHash }), (error) => error.code === "BENCHMARK_ATTESTATION_MISMATCH");

  evidence.set("evidence-hostile", { evidenceId: "evidence-hostile", projectId: "project-a", truthState: "VERIFIED", result: "PASSED", sourceHash, linkedToWorkUnit: true, independent: true, verifier: { id: "reviewer" }, details: { benchmark: attestation } });
  instance.finishObservation(started.observationId, { success: true, quality: 1, outputHash: sha("out"), verified: true, evidenceId: "evidence-hostile", evaluatorId: "reviewer", revisionHash: sourceHash });
  const duplicate = instance.beginObservation({ projectId: "project-a", taskKind: "code", combo: combo("hostile"), mode: "OFFICIAL", workUnitId: "work-hostile", taskFingerprint: sha("task-hostile"), sourceHash });
  assert.throws(() => instance.finishObservation(duplicate.observationId, { success: true, quality: 1, outputHash: sha("out"), verified: true, evidenceId: "evidence-hostile", evaluatorId: "reviewer", revisionHash: sourceHash }), (error) => error.code === "BENCHMARK_EVIDENCE_REUSED");
});

test("Shadow y Candidate exigen Worktree real, comparan resultados y no alteran la salida oficial", (context) => {
  const { instance, evidence, units } = fixture(context);
  verifiedObservation(instance, evidence, "baseline", { combo: combo("baseline"), quality: 0.7, latencyMs: 300, workUnitId: "work-baseline" });
  units.set("work-shadow", { projectId: "project-a", workUnitId: "work-shadow", executionRootAvailable: true, state: "ISOLATED" });
  const sourceHash = sha("source-shadow");
  const experiment = instance.createExperiment({
    projectId: "project-a", workUnitId: "work-shadow", mode: "SHADOW", isolationId: "work-shadow",
    baselineCombo: combo("baseline"), candidateCombo: combo("candidate"), taskKind: "programacion",
    taskFingerprint: sha("task-shadow"), sourceHash
  });
  assert.equal(experiment.state, "PLANNED");
  const running = instance.beginExperiment(experiment.experimentId);
  const shadowOutputHash = sha("shadow-output");
  evidence.set("evidence-shadow", {
    evidenceId: "evidence-shadow", projectId: "project-a", truthState: "VERIFIED", result: "PASSED", sourceHash,
    linkedToWorkUnit: true, independent: true, verifier: { id: "independent-shadow" },
    details: { benchmark: { taskFingerprint: sha("task-shadow"), comboKey: running.candidate.comboKey, outputHash: shadowOutputHash, success: true, quality: 0.95, latencyMs: 100, costUsd: null } }
  });
  const finished = instance.finishExperiment(experiment.experimentId, {
    success: true, quality: 0.95, latencyMs: 100, outputHash: shadowOutputHash, verified: true,
    evidenceId: "evidence-shadow", evaluatorId: "independent-shadow", revisionHash: sourceHash
  });
  assert.equal(running.state, "RUNNING");
  assert.equal(finished.state, "COMPARABLE");
  assert.equal(finished.comparison.comparable, true);
  assert.ok(finished.comparison.qualityDelta > 0);
  const plan = instance.plan({ projectId: "project-a", taskKind: "programacion", candidates: [
    { candidateId: "baseline", available: true, priority: 20, capabilities: ["text"], combo: combo("baseline") },
    { candidateId: "candidate", available: true, priority: 1, capabilities: ["text"], combo: combo("candidate") }
  ] });
  assert.equal(plan.selected.candidateId, "baseline", "Una salida Shadow jamás se vuelve oficial por sí sola.");
});

test("reinicio abandona mediciones activas y respeta identidad y almacenamiento seguro", { skip: process.platform === "win32" }, (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-benchmark-recovery-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, "router.sqlite");
  const first = new IntelligenceBenchmarkRouter({ filePath, ownerId: "owner-a" });
  const started = first.beginObservation({ projectId: "project-a", taskKind: "code", combo: combo("recovery"), taskFingerprint: sha("recovery") });
  first.close();
  const restored = new IntelligenceBenchmarkRouter({ filePath, ownerId: "owner-a" });
  assert.equal(restored.observation(started.observationId).state, "ABANDONED");
  restored.close();
  assert.throws(() => new IntelligenceBenchmarkRouter({ filePath, ownerId: "owner-b" }), (error) => error.code === "BENCHMARK_OWNER_MISMATCH");
  const linked = path.join(root, "linked.sqlite");
  fs.symlinkSync(filePath, linked);
  assert.throws(() => new IntelligenceBenchmarkRouter({ filePath: linked, ownerId: "owner-a" }), (error) => error.code === "BENCHMARK_STORAGE_UNSAFE");
});

test("la aplicación conecta el Router al Gateway, Work Units y recomendación sin exponerlo al renderer", () => {
  const root = path.join(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out/main/index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out/preload/index.js"), "utf8");
  assert.match(main, /new IntelligenceBenchmarkRouter\(\{/);
  assert.match(main, /new ProviderService\(database, intelligenceGateway, intelligenceBenchmarkRouter\)/);
  assert.match(main, /benchmarkRouter\.plan\(\{/);
  assert.match(main, /projectScope: options\.projectScope \|\| "global"/);
  assert.match(main, /taskKind: options\.taskKind \|\| classified\.task/);
  assert.match(main, /harnessId: `dorn-agent-team-v1:\$\{agentRequest\.role\}`/);
  assert.match(main, /linkedToWorkUnit:[\s\S]{0,240}independent:/);
  assert.match(main, /intelligenceBenchmarkRouter\?\.close\(\)/);
  assert.doesNotMatch(preload, /intelligenceBenchmark|benchmarkRouter|shadowExperiment/i);
});
