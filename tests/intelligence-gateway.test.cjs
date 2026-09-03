"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  IntelligenceGateway,
  classifyGatewayFailure,
  connectionEntities,
  estimateInputUnits
} = require("../out/main/dorn-core/intelligence-gateway");
const { durationMs, readRateLimitHeaders, resetAt } = require("../out/main/dorn-core/rate-limit-headers");

function temporary(context, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fingerprint(value = "request") { return crypto.createHash("sha256").update(value).digest("hex"); }

function provider(id, overrides = {}) {
  return {
    id,
    name: `Kimi ${id}`,
    protocol: "openai-chat",
    authType: "bearer",
    baseUrl: "https://api.moonshot.ai/v1",
    endpoint: "/chat/completions",
    model: "kimi-k3",
    hasApiKey: true,
    enabled: true,
    priority: 20,
    capabilities: ["text", "reasoning", "code", "vision", "tools"],
    local: false,
    ...overrides
  };
}

function gateway(context, options = {}) {
  const root = temporary(context, "dorn-gateway-");
  const filePath = path.join(root, "gateway.sqlite");
  const instance = new IntelligenceGateway({ filePath, ownerId: options.ownerId || "dorn-test", failureThreshold: options.failureThreshold, defaultCooldownMs: options.defaultCooldownMs, clock: options.clock });
  context.after(() => { try { instance.close(); } catch {} });
  return { root, filePath, instance };
}

test("Provider, Model, AccessRoute, Connection y CredentialRef quedan separados sin guardar la API", (context) => {
  const { instance } = gateway(context);
  instance.syncConnection(provider("kimi-a"));
  instance.syncConnection(provider("kimi-b", { name: "Kimi respaldo", priority: 30 }));
  const report = instance.report();
  assert.deepEqual(report.entities, { providers: 1, models: 1, routes: 1, credentials: 2, connections: 2 });
  assert.equal(report.entries[0].modelId, "kimi-k3");
  assert.equal(report.entries[0].route.host, "api.moonshot.ai");
  assert.equal(report.entries[0].credentialRef, "credential:kimi-a");
  assert.doesNotMatch(JSON.stringify(report), /sk-live-secret|Bearer\s+/i);
  assert.throws(() => instance.syncConnection({ ...provider("unsafe"), apiKey: "sk-live-secret-123456789" }), (error) => error.code === "GATEWAY_SECRET_REJECTED");

  const entities = connectionEntities(provider("kimi-c"));
  assert.equal(entities.connection.compatibilityKey, report.entries[0].compatibilityKey);
  assert.notEqual(entities.connection.connectionId, report.entries[0].connectionId);
});

test("cuota se reserva de forma transaccional y el costo sólo existe con tarifa explícita", (context) => {
  const { instance } = gateway(context);
  instance.syncConnection(provider("kimi-quota"));
  instance.configureQuota("kimi-quota", { limit: 100, remaining: 100, resetAt: Date.now() + 60_000 });
  const first = instance.begin("kimi-quota", { requestFingerprint: fingerprint("quota-1"), estimatedUnits: 60 });
  assert.equal(instance.state("kimi-quota").quota.available, 40);
  assert.throws(() => instance.begin("kimi-quota", { requestFingerprint: fingerprint("quota-2"), estimatedUnits: 50 }), (error) => error.code === "GATEWAY_QUOTA_RESERVATION_REJECTED");
  instance.finish(first.attemptId, { success: true, usage: { input_tokens: 30, output_tokens: 10 }, latencyMs: 200 });
  assert.equal(instance.state("kimi-quota").quota.remaining, 60);
  assert.equal(instance.report().telemetry.costUnknown, 1);

  instance.configurePricing("kimi-quota", { inputCostPerMillion: 1, outputCostPerMillion: 2 });
  const second = instance.begin("kimi-quota", { requestFingerprint: fingerprint("quota-3"), estimatedUnits: 10 });
  instance.finish(second.attemptId, { success: true, usage: { prompt_tokens: 4, completion_tokens: 6 }, latencyMs: 100 });
  const telemetry = instance.report().telemetry;
  assert.equal(telemetry.inputTokens, 34);
  assert.equal(telemetry.outputTokens, 16);
  assert.equal(telemetry.knownCostUsd, 0.000016);
  assert.equal(telemetry.costUnknown, 1);
});

test("fallo de autenticación abre circuito y failover consume un checkpoint del mismo contexto", (context) => {
  const { instance } = gateway(context);
  instance.syncConnection(provider("kimi-primary", { priority: 10 }));
  instance.syncConnection(provider("kimi-secondary", { priority: 20 }));
  const requestFingerprint = fingerprint("same-context");
  const attempt = instance.begin("kimi-primary", { requestFingerprint, estimatedUnits: 20, workUnitId: "work-1" });
  instance.finish(attempt.attemptId, { success: false, error: Object.assign(new Error("invalid API key"), { status: 401 }) });
  assert.equal(instance.state("kimi-primary").circuitState, "OPEN");
  assert.equal(instance.state("kimi-primary").health, "AUTH_FAILED");
  assert.deepEqual(instance.candidates({ preferredConnectionId: "kimi-primary" }).map((entry) => entry.connectionId), ["kimi-secondary"]);

  assert.throws(() => instance.checkpointFailover(attempt.attemptId, { toConnectionId: "kimi-secondary", requestFingerprint, streamed: true }), (error) => error.code === "GATEWAY_FAILOVER_AFTER_OUTPUT_BLOCKED");
  assert.throws(() => instance.checkpointFailover(attempt.attemptId, { toConnectionId: "kimi-secondary", requestFingerprint: fingerprint("changed") }), (error) => error.code === "GATEWAY_FAILOVER_CONTEXT_MISMATCH");
  const checkpoint = instance.checkpointFailover(attempt.attemptId, { toConnectionId: "kimi-secondary", requestFingerprint, workUnitId: "work-1", conversationId: "conversation-1" });
  assert.match(checkpoint.checkpointHash, /^[0-9a-f]{64}$/);
  const resumed = instance.begin("kimi-secondary", { requestFingerprint, estimatedUnits: 20, workUnitId: "work-1", resumeCheckpointId: checkpoint.checkpointId });
  instance.finish(resumed.attemptId, { success: true, usage: { input_tokens: 10, output_tokens: 5 }, latencyMs: 50 });
  assert.equal(instance.report().checkpoints[0].state, "CONSUMED");
});

test("cambiar o retirar una API restablece salud sin dejar credenciales o rutas huérfanas", (context) => {
  const { instance } = gateway(context);
  instance.syncConnection(provider("kimi-edit"));
  const attempt = instance.begin("kimi-edit", { requestFingerprint: fingerprint("bad-key"), estimatedUnits: 1 });
  instance.finish(attempt.attemptId, { success: false, error: Object.assign(new Error("invalid API key"), { status: 401 }) });
  assert.equal(instance.state("kimi-edit").health, "AUTH_FAILED");

  instance.syncConnection(provider("kimi-edit", { hasApiKey: false }));
  instance.resetConnectionHealth("kimi-edit", { reason: "CREDENTIAL_CLEARED", clearQuota: true });
  assert.equal(instance.state("kimi-edit").credentialReady, false);
  assert.equal(instance.state("kimi-edit").available, false);
  assert.equal(instance.report().entities.credentials, 1, "Una API requerida conserva sólo una referencia indisponible.");

  instance.syncConnection(provider("kimi-edit", { model: "kimi-k2.7", baseUrl: "https://api.moonshot.cn/v1" }));
  instance.resetConnectionHealth("kimi-edit", { reason: "CREDENTIAL_CHANGED" });
  assert.equal(instance.state("kimi-edit").health, "UNKNOWN");
  assert.equal(instance.state("kimi-edit").available, true);
  assert.deepEqual(instance.report().entities, { providers: 1, models: 1, routes: 1, credentials: 1, connections: 1 });

  instance.syncConnection(provider("kimi-edit", { enabled: false, model: "kimi-k2.7", baseUrl: "https://api.moonshot.cn/v1" }));
  assert.equal(instance.state("kimi-edit").health, "DISABLED");
  assert.equal(instance.state("kimi-edit").available, false);
  instance.syncConnection(provider("kimi-edit", { enabled: true, model: "kimi-k2.7", baseUrl: "https://api.moonshot.cn/v1" }));
  assert.equal(instance.state("kimi-edit").circuitState, "CLOSED");

  assert.equal(instance.removeConnection("kimi-edit"), true);
  assert.equal(instance.state("kimi-edit").enabled, false);
  assert.equal(instance.report().entities.credentials, 0);
  assert.ok(instance.report().events.some((event) => event.type === "CONNECTION_REMOVED" && event.detail.retainedAsTombstone));
});

test("una conexión desactivada admite health check explícito sin entrar al Router", (context) => {
  const { instance } = gateway(context);
  instance.syncConnection(provider("kimi-probe", { enabled: false }));
  assert.throws(() => instance.begin("kimi-probe", { requestFingerprint: fingerprint("normal-route"), estimatedUnits: 1 }), (error) => error.code === "GATEWAY_CONNECTION_UNAVAILABLE");
  const probe = instance.begin("kimi-probe", { requestFingerprint: fingerprint("explicit-probe"), estimatedUnits: 1, probe: true });
  instance.finish(probe.attemptId, { success: true, usage: { input_tokens: 1, output_tokens: 1 }, latencyMs: 15 });
  assert.equal(instance.state("kimi-probe").health, "DISABLED");
  assert.equal(instance.state("kimi-probe").circuitState, "OPEN");
  assert.equal(instance.state("kimi-probe").available, false);
});

test("una ruta incompatible nunca recibe el checkpoint ni el contexto", (context) => {
  const { instance } = gateway(context);
  instance.syncConnection(provider("kimi-source"));
  instance.syncConnection(provider("other-model", { model: "moonshot-v1-128k" }));
  const requestFingerprint = fingerprint("compatible-only");
  const attempt = instance.begin("kimi-source", { requestFingerprint, estimatedUnits: 1 });
  instance.finish(attempt.attemptId, { success: false, error: Object.assign(new Error("HTTP 503"), { status: 503 }) });
  assert.throws(() => instance.checkpointFailover(attempt.attemptId, { toConnectionId: "other-model", requestFingerprint }), (error) => error.code === "GATEWAY_FAILOVER_ROUTE_INCOMPATIBLE");
});

test("un error transitorio puede reanudar una sola vez la misma ruta desde checkpoint", (context) => {
  const { instance } = gateway(context);
  instance.syncConnection(provider("kimi-retry"));
  const requestFingerprint = fingerprint("same-route-retry");
  const failed = instance.begin("kimi-retry", { requestFingerprint, estimatedUnits: 2, workUnitId: "work-retry" });
  instance.finish(failed.attemptId, { success: false, error: Object.assign(new Error("temporary provider failure"), { status: 503 }) });
  const checkpoint = instance.checkpointFailover(failed.attemptId, {
    toConnectionId: "kimi-retry", requestFingerprint, workUnitId: "work-retry", streamed: false
  });
  const retried = instance.begin("kimi-retry", {
    requestFingerprint, estimatedUnits: 2, workUnitId: "work-retry", resumeCheckpointId: checkpoint.checkpointId
  });
  instance.finish(retried.attemptId, { success: true, usage: { input_tokens: 1, output_tokens: 1 }, latencyMs: 20 });
  assert.equal(instance.report().checkpoints[0].state, "CONSUMED");
  assert.equal(instance.state("kimi-retry").health, "AVAILABLE");
});

test("circuit breaker pasa a HALF_OPEN y admite una sola sonda", (context) => {
  let now = 1_800_000_000_000;
  const { instance } = gateway(context, { failureThreshold: 2, defaultCooldownMs: 1_000, clock: () => now });
  instance.syncConnection(provider("kimi-circuit"));
  for (let index = 0; index < 2; index += 1) {
    const attempt = instance.begin("kimi-circuit", { requestFingerprint: fingerprint(`circuit-${index}`), estimatedUnits: 1 });
    instance.finish(attempt.attemptId, { success: false, error: Object.assign(new Error("temporarily unavailable"), { status: 503 }) });
  }
  assert.equal(instance.state("kimi-circuit").circuitState, "OPEN");
  assert.equal(instance.state("kimi-circuit").available, false);
  now += 1_001;
  assert.equal(instance.state("kimi-circuit").circuitState, "HALF_OPEN");
  const probe = instance.begin("kimi-circuit", { requestFingerprint: fingerprint("half-open"), estimatedUnits: 1 });
  assert.throws(() => instance.begin("kimi-circuit", { requestFingerprint: fingerprint("parallel-half-open"), estimatedUnits: 1 }), (error) => error.code === "GATEWAY_CONNECTION_UNAVAILABLE");
  instance.finish(probe.attemptId, { success: true, usage: {}, latencyMs: 12 });
  assert.equal(instance.state("kimi-circuit").circuitState, "CLOSED");
  assert.equal(instance.state("kimi-circuit").failureCount, 0);
});

test("reinicio abandona intentos incompletos y libera reservas sin fingir éxito", (context) => {
  const root = temporary(context, "dorn-gateway-recovery-");
  const filePath = path.join(root, "gateway.sqlite");
  const first = new IntelligenceGateway({ filePath, ownerId: "dorn-recovery" });
  first.syncConnection(provider("kimi-recovery"));
  first.configureQuota("kimi-recovery", { limit: 100, remaining: 100 });
  first.begin("kimi-recovery", { requestFingerprint: fingerprint("interrupted"), estimatedUnits: 80 });
  assert.equal(first.state("kimi-recovery").quota.available, 20);
  first.close();
  const restored = new IntelligenceGateway({ filePath, ownerId: "dorn-recovery" });
  context.after(() => restored.close());
  assert.equal(restored.report().activeAttempts, 0);
  assert.equal(restored.state("kimi-recovery").quota.available, 100);
  assert.ok(restored.report().events.some((event) => event.type === "ATTEMPT_RECOVERED"));
});

test("cabeceras de cuota, Retry-After y clasificación se interpretan sin valores imposibles", () => {
  const now = Date.parse("2026-08-21T12:00:00Z");
  const parsed = readRateLimitHeaders({
    "Retry-After": "2.5",
    "x-ratelimit-limit-tokens": "1000",
    "x-ratelimit-remaining-tokens": "125",
    "x-ratelimit-reset-tokens": "30s"
  }, now);
  assert.deepEqual(parsed, { retryAfterMs: 2_500, quotaLimit: 1_000, quotaRemaining: 125, quotaResetAt: now + 30_000, observed: true });
  assert.equal(durationMs("1h", now), 3_600_000);
  assert.equal(resetAt("30s", now), now + 30_000);
  assert.equal(resetAt("999999999999999999", now), null);
  assert.equal(classifyGatewayFailure(Object.assign(new Error("custom message"), { status: 429 })).family, "RATE_LIMIT");
  assert.equal(classifyGatewayFailure(Object.assign(new Error("invalid payload"), { status: 400 })).failover, false);
  assert.equal(classifyGatewayFailure(Object.assign(new Error("race"), { code: "GATEWAY_CONNECTION_UNAVAILABLE" })).family, "ROUTING");
  assert.equal(classifyGatewayFailure(Object.assign(new Error("quota"), { code: "GATEWAY_QUOTA_RESERVATION_REJECTED" })).retryable, false);
  assert.ok(estimateInputUnits({ systemPrompt: "12345678" }, [{ content: "12345678" }]) >= 4);
});

test("propietario distinto y archivo enlazado se rechazan sin sobrescribir", { skip: process.platform === "win32" }, (context) => {
  const root = temporary(context, "dorn-gateway-owner-");
  const filePath = path.join(root, "gateway.sqlite");
  const first = new IntelligenceGateway({ filePath, ownerId: "owner-a" });
  first.syncConnection(provider("kimi-owner"));
  first.close();
  assert.throws(() => new IntelligenceGateway({ filePath, ownerId: "owner-b" }), (error) => error.code === "GATEWAY_OWNER_MISMATCH");
  const originalHash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"), originalHash);

  const target = path.join(root, "target.sqlite");
  fs.copyFileSync(filePath, target);
  const linked = path.join(root, "linked.sqlite");
  fs.symlinkSync(target, linked);
  assert.throws(() => new IntelligenceGateway({ filePath: linked, ownerId: "owner-a" }), (error) => error.code === "GATEWAY_STORAGE_UNSAFE");
});

test("el proceso principal integra Gateway, checkpoints por Work Unit y cuotas de errores SSE", () => {
  const source = fs.readFileSync(path.join(__dirname, "../out/main/index.js"), "utf8");
  assert.match(source, /new IntelligenceGateway\(\{/);
  assert.match(source, /gatewayScope: `agent:\$\{agentRequest\.role\}`/);
  assert.match(source, /workUnitId: task\.taskId/);
  assert.match(source, /checkpointFailover\(started, next\.id/);
  assert.match(source, /resumeCheckpointId/);
  assert.match(source, /retryingSameRoute/);
  assert.match(source, /Reintento recuperable/);
  assert.match(source, /modelCache\.set\(provider\.id/);
  assert.match(source, /purpose: "connection-health-check"/);
  assert.match(source, /Object\.assign\(new Error\([\s\S]{0,300}\{ rateLimit \}\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../out/preload/index.js"), "utf8"), /intelligenceGateway|gateway\.report/i);
});
