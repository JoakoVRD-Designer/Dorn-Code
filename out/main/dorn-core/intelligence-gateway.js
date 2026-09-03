"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { containsSecret } = require("./policy-engine");

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HARD_BLOCKED = new Set(["AUTH_FAILED", "AUTH_EXPIRED", "BLOCKED", "DISABLED", "QUOTA_EXHAUSTED"]);

function gatewayError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function digest(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function nowIso(now = Date.now()) { return new Date(now).toISOString(); }
function checkedId(value, label) {
  const result = String(value || "").trim();
  if (!SAFE_ID.test(result)) throw gatewayError("GATEWAY_ID_INVALID", `${label} inválido.`);
  return result;
}
function boundedNumber(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}
function optionalNumber(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : null;
}
function stringList(value, maximum = 50) {
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))]
    .sort().slice(0, maximum);
}
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return structuredClone(fallback); } }
function safeDetail(value, depth = 0) {
  if (depth > 6) return "[DEPTH_LIMIT]";
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => safeDetail(entry, depth + 1));
  if (!value || typeof value !== "object") {
    const text = typeof value === "string" ? value.slice(0, 2_000) : value;
    return containsSecret(text) ? "[REDACTED]" : text;
  }
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, entry]) =>
    /(?:api.?key|authorization|password|secret|token)/i.test(key) ? [key, "[REDACTED]"] : [key, safeDetail(entry, depth + 1)]
  ));
}

function normalizedProtocol(protocol) {
  const value = String(protocol || "").trim().toLowerCase();
  if (["openai-chat", "anthropic-messages", "ollama-chat", "generic-json", "dorn-local", "dorn-guide", "openai-responses"].includes(value)) return value;
  return value || "unknown";
}

function hostIdentity(provider) {
  if (provider.local || ["dorn-local", "dorn-guide", "ollama-chat"].includes(provider.protocol)) return `local:${normalizedProtocol(provider.protocol)}`;
  try { return new URL(String(provider.baseUrl || "")).hostname.toLowerCase(); }
  catch { return `unresolved:${normalizedProtocol(provider.protocol)}`; }
}

function normalizedBaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch { return String(value || "").trim().replace(/\/+$/, "").toLowerCase(); }
}

function connectionEntities(provider = {}) {
  if (provider.apiKey || provider.encryptedKey || provider.secret || provider.authorization) {
    throw gatewayError("GATEWAY_SECRET_REJECTED", "Intelligence Gateway sólo admite CredentialRef, nunca credenciales.");
  }
  const connectionId = checkedId(provider.id, "connectionId");
  const protocol = normalizedProtocol(provider.protocol);
  const host = hostIdentity(provider);
  const providerId = `provider:${digest(`${host}`).slice(0, 24)}`;
  const modelId = String(provider.model || "runtime-managed").trim().slice(0, 300) || "runtime-managed";
  const modelKey = `model:${digest(`${providerId}\0${modelId.toLowerCase()}`).slice(0, 24)}`;
  const routeMaterial = `${providerId}\0${protocol}\0${normalizedBaseUrl(provider.baseUrl)}\0${String(provider.endpoint || "").trim().toLowerCase()}`;
  const routeId = `route:${digest(routeMaterial).slice(0, 24)}`;
  const compatibilityKey = digest(`${protocol}\0${normalizedBaseUrl(provider.baseUrl)}\0${String(provider.endpoint || "").trim().toLowerCase()}\0${modelId.toLowerCase()}`);
  const authType = String(provider.authType || "").trim().toLowerCase();
  const requiresCredential = Boolean(provider.hasApiKey) || (authType !== "" && authType !== "none");
  const credentialRef = requiresCredential ? `credential:${connectionId}` : null;
  const capabilities = stringList(provider.capabilities);
  return {
    provider: { providerId, name: String(provider.name || host).slice(0, 300), host },
    model: { modelKey, providerId, modelId, capabilities },
    route: {
      routeId, providerId, protocol, host, endpoint: String(provider.endpoint || "").trim().slice(0, 500),
      local: Boolean(provider.local), capabilities
    },
    credential: credentialRef ? { credentialRef, providerId, available: Boolean(provider.hasApiKey) } : null,
    connection: {
      connectionId, providerId, modelKey, routeId, credentialRef,
      label: String(provider.name || connectionId).slice(0, 300), enabled: provider.enabled !== false,
      priority: Math.round(boundedNumber(provider.priority, 100, 0, 100_000)), compatibilityKey, capabilities
    }
  };
}

function classifyGatewayFailure(error) {
  const code = String(error?.code || "").toUpperCase();
  const status = Number(error?.status || String(error?.code || "").match(/HTTP[_-]?(\d{3})/i)?.[1] || 0);
  const text = `${error?.code || ""} ${error?.message || error || ""}`;
  if (code === "GATEWAY_QUOTA_RESERVATION_REJECTED") return { category: "QUOTA_RESERVATION", family: "QUOTA", failover: true, retryable: false };
  if (code === "GATEWAY_CONNECTION_UNAVAILABLE") return { category: "ROUTE_BUSY", family: "ROUTING", failover: true, retryable: true };
  if (status === 401 || status === 403 || /unauthori|forbidden|api.?key.*invalid|credencial.*invalid|auth.*failed/i.test(text)) return { category: "AUTH_FAILED", family: "AUTH", failover: true, retryable: false };
  if (/quota|cuota.*agot|billing|insufficient.*credit|sin cr[eé]dito/i.test(text)) return { category: "QUOTA_EXHAUSTED", family: "QUOTA", failover: true, retryable: false };
  if (status === 429 || /rate.?limit|demasiadas solicitudes/i.test(text)) return { category: "RATE_LIMITED", family: "RATE_LIMIT", failover: true, retryable: true };
  if (status === 404 || /model.*not.?found|modelo.*no existe|deprecated|retirad/i.test(text)) return { category: "ROUTE_LIFECYCLE", family: "LIFECYCLE", failover: true, retryable: false };
  if ([408, 409, 500, 502, 503, 504].includes(status) || /timeout|timed out|fetch failed|econn|enotfound|socket|network|temporar|overload|unavailable|conexi[oó]n/i.test(text)) return { category: "TRANSIENT_PROVIDER", family: status >= 500 ? "PROVIDER" : "NETWORK", failover: true, retryable: true };
  if (status === 400 || /payload.*invalid|request.*schema|malformed|validation/i.test(text)) return { category: "REQUEST_INVALID", family: "VALIDATION", failover: false, retryable: false };
  return { category: "UNKNOWN", family: "UNKNOWN", failover: false, retryable: false };
}

function usageUnits(usage = {}) {
  const inputTokens = Math.max(0, Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? 0) || 0);
  const outputTokens = Math.max(0, Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? 0) || 0);
  return { inputTokens, outputTokens, total: inputTokens + outputTokens };
}

function estimateInputUnits(settings, messages) {
  const characters = String(settings?.systemPrompt || "").length + (Array.isArray(messages) ? messages : []).reduce((sum, message) => sum + String(message?.content || "").length, 0);
  return Math.max(1, Math.min(10_000_000, Math.ceil(characters / 4)));
}

class IntelligenceGateway {
  constructor(options = {}) {
    this.filePath = options.filePath || ":memory:";
    this.ownerId = checkedId(options.ownerId || "dorn-ai", "ownerId");
    this.failureThreshold = Math.max(1, Math.min(20, Number(options.failureThreshold) || 3));
    this.defaultCooldownMs = Math.max(1_000, Math.min(3_600_000, Number(options.defaultCooldownMs) || 30_000));
    this.clock = typeof options.clock === "function" ? options.clock : Date.now;
    if (this.filePath !== ":memory:") {
      const parent = path.dirname(path.resolve(this.filePath));
      const stat = fs.lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw gatewayError("GATEWAY_STORAGE_UNSAFE", "La carpeta de Intelligence Gateway no es segura.");
      if (fs.existsSync(this.filePath)) {
        const fileStat = fs.lstatSync(this.filePath);
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw gatewayError("GATEWAY_STORAGE_UNSAFE", "El registro de Intelligence Gateway no puede ser un enlace.");
      }
    }
    this.db = new DatabaseSync(this.filePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;");
    this.migrate();
    this.assertOwner();
    this.recover();
  }

  filePath; ownerId; failureThreshold; defaultCooldownMs; clock; db;

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gateway_providers(
        provider_id TEXT PRIMARY KEY,name TEXT NOT NULL,host TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_models(
        model_key TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES gateway_providers(provider_id),
        model_id TEXT NOT NULL,capabilities_json TEXT NOT NULL,lifecycle TEXT NOT NULL DEFAULT 'KNOWN',updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_routes(
        route_id TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES gateway_providers(provider_id),
        protocol TEXT NOT NULL,host TEXT NOT NULL,endpoint TEXT NOT NULL,local INTEGER NOT NULL,
        capabilities_json TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_credentials(
        credential_ref TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES gateway_providers(provider_id),
        available INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_connections(
        connection_id TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES gateway_providers(provider_id),
        model_key TEXT NOT NULL REFERENCES gateway_models(model_key),route_id TEXT NOT NULL REFERENCES gateway_routes(route_id),
        credential_ref TEXT REFERENCES gateway_credentials(credential_ref),label TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 100,compatibility_key TEXT NOT NULL,capabilities_json TEXT NOT NULL,
        health TEXT NOT NULL DEFAULT 'UNKNOWN',circuit_state TEXT NOT NULL DEFAULT 'CLOSED',failure_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,average_latency_ms REAL NOT NULL DEFAULT 0,cooldown_until INTEGER NOT NULL DEFAULT 0,
        quota_limit REAL,quota_remaining REAL,quota_reset_at INTEGER,input_cost_per_million REAL,output_cost_per_million REAL,
        last_checked_at TEXT,updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gateway_compatibility ON gateway_connections(compatibility_key,enabled,priority);
      CREATE TABLE IF NOT EXISTS gateway_attempts(
        attempt_id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES gateway_connections(connection_id) ON DELETE CASCADE,
        work_unit_id TEXT,request_fingerprint TEXT NOT NULL,estimated_units REAL NOT NULL DEFAULT 0,input_tokens REAL,
        output_tokens REAL,actual_units REAL,cost_usd REAL,state TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,error_family TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gateway_attempts_active ON gateway_attempts(connection_id,state,started_at);
      CREATE TABLE IF NOT EXISTS gateway_failover_checkpoints(
        checkpoint_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL REFERENCES gateway_attempts(attempt_id),
        from_connection_id TEXT NOT NULL,to_connection_id TEXT NOT NULL,work_unit_id TEXT,conversation_id TEXT,
        request_fingerprint TEXT NOT NULL,state TEXT NOT NULL,checkpoint_hash TEXT NOT NULL,created_at TEXT NOT NULL,consumed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS gateway_events(
        event_id TEXT PRIMARY KEY,connection_id TEXT,type TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gateway_events_created ON gateway_events(created_at DESC,event_id DESC);
    `);
  }

  assertOwner() {
    const stored = this.db.prepare("SELECT value FROM gateway_metadata WHERE key='owner_id'").get()?.value || null;
    if (stored && stored !== this.ownerId) throw gatewayError("GATEWAY_OWNER_MISMATCH", "El registro de Intelligence Gateway pertenece a otra identidad.");
    if (!stored) this.db.prepare("INSERT INTO gateway_metadata(key,value) VALUES('owner_id',?)").run(this.ownerId);
  }

  recover() {
    const interrupted = this.db.prepare("SELECT attempt_id,connection_id FROM gateway_attempts WHERE state='RUNNING'").all();
    if (!interrupted.length) return { recovered: 0 };
    const timestamp = nowIso(this.clock());
    this.db.prepare("UPDATE gateway_attempts SET state='ABANDONED',finished_at=?,error_family='PROCESS_INTERRUPTED' WHERE state='RUNNING'").run(timestamp);
    for (const row of interrupted) this.event(row.connection_id, "ATTEMPT_RECOVERED", { attemptId: row.attempt_id });
    return { recovered: interrupted.length };
  }

  event(connectionId, type, detail = {}) {
    this.db.prepare("INSERT INTO gateway_events(event_id,connection_id,type,detail_json,created_at) VALUES(?,?,?,?,?)")
      .run(crypto.randomUUID(), connectionId || null, String(type).slice(0, 100), JSON.stringify(safeDetail(detail)), nowIso(this.clock()));
    this.db.prepare("DELETE FROM gateway_events WHERE event_id IN (SELECT event_id FROM gateway_events ORDER BY created_at DESC,event_id DESC LIMIT -1 OFFSET 10000)").run();
  }

  syncConnection(provider) {
    const entities = connectionEntities(provider);
    const timestamp = nowIso(this.clock());
    assertNoSecretEntity(entities);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO gateway_providers(provider_id,name,host,updated_at) VALUES(?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET name=excluded.name,host=excluded.host,updated_at=excluded.updated_at")
        .run(entities.provider.providerId, entities.provider.name, entities.provider.host, timestamp);
      this.db.prepare("INSERT INTO gateway_models(model_key,provider_id,model_id,capabilities_json,lifecycle,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(model_key) DO UPDATE SET model_id=excluded.model_id,capabilities_json=excluded.capabilities_json,updated_at=excluded.updated_at")
        .run(entities.model.modelKey, entities.model.providerId, entities.model.modelId, JSON.stringify(entities.model.capabilities), "KNOWN", timestamp);
      this.db.prepare("INSERT INTO gateway_routes(route_id,provider_id,protocol,host,endpoint,local,capabilities_json,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(route_id) DO UPDATE SET protocol=excluded.protocol,host=excluded.host,endpoint=excluded.endpoint,local=excluded.local,capabilities_json=excluded.capabilities_json,enabled=excluded.enabled,updated_at=excluded.updated_at")
        .run(entities.route.routeId, entities.route.providerId, entities.route.protocol, entities.route.host, entities.route.endpoint, Number(entities.route.local), JSON.stringify(entities.route.capabilities), 1, timestamp);
      if (entities.credential) {
        this.db.prepare("INSERT INTO gateway_credentials(credential_ref,provider_id,available,updated_at) VALUES(?,?,?,?) ON CONFLICT(credential_ref) DO UPDATE SET provider_id=excluded.provider_id,available=excluded.available,updated_at=excluded.updated_at")
          .run(entities.credential.credentialRef, entities.credential.providerId, Number(entities.credential.available), timestamp);
      }
      this.db.prepare(`INSERT INTO gateway_connections(
        connection_id,provider_id,model_key,route_id,credential_ref,label,enabled,priority,compatibility_key,capabilities_json,health,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET
        provider_id=excluded.provider_id,model_key=excluded.model_key,route_id=excluded.route_id,credential_ref=excluded.credential_ref,
        label=excluded.label,enabled=excluded.enabled,priority=excluded.priority,compatibility_key=excluded.compatibility_key,
        capabilities_json=excluded.capabilities_json,updated_at=excluded.updated_at`)
        .run(
          entities.connection.connectionId, entities.connection.providerId, entities.connection.modelKey, entities.connection.routeId,
          entities.connection.credentialRef, entities.connection.label, Number(entities.connection.enabled), entities.connection.priority,
          entities.connection.compatibilityKey, JSON.stringify(entities.connection.capabilities), provider.enabled === false ? "DISABLED" : "UNKNOWN", timestamp
        );
      if (provider.enabled === false) {
        this.db.prepare("UPDATE gateway_connections SET health='DISABLED',circuit_state='OPEN',cooldown_until=0 WHERE connection_id=?")
          .run(entities.connection.connectionId);
      } else {
        this.db.prepare("UPDATE gateway_connections SET circuit_state=CASE WHEN health='DISABLED' THEN 'CLOSED' ELSE circuit_state END,health=CASE WHEN health='DISABLED' THEN 'UNKNOWN' ELSE health END WHERE connection_id=?")
          .run(entities.connection.connectionId);
      }
      this.pruneOrphans();
      this.db.exec("COMMIT");
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
    return this.state(entities.connection.connectionId);
  }

  removeConnection(connectionId) {
    const id = checkedId(connectionId, "connectionId");
    const current = this.db.prepare("SELECT connection_id FROM gateway_connections WHERE connection_id=?").get(id);
    if (!current) return false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE gateway_connections SET enabled=0,health='DISABLED',circuit_state='OPEN',cooldown_until=0,credential_ref=NULL,updated_at=? WHERE connection_id=?")
        .run(nowIso(this.clock()), id);
      this.pruneOrphans();
      this.db.exec("COMMIT");
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
    this.event(id, "CONNECTION_REMOVED", { retainedAsTombstone: true });
    return true;
  }

  pruneOrphans() {
    this.db.prepare("DELETE FROM gateway_credentials WHERE NOT EXISTS(SELECT 1 FROM gateway_connections WHERE gateway_connections.credential_ref=gateway_credentials.credential_ref)").run();
    this.db.prepare("DELETE FROM gateway_models WHERE NOT EXISTS(SELECT 1 FROM gateway_connections WHERE gateway_connections.model_key=gateway_models.model_key)").run();
    this.db.prepare("DELETE FROM gateway_routes WHERE NOT EXISTS(SELECT 1 FROM gateway_connections WHERE gateway_connections.route_id=gateway_routes.route_id)").run();
    this.db.prepare(`DELETE FROM gateway_providers WHERE
      NOT EXISTS(SELECT 1 FROM gateway_connections WHERE gateway_connections.provider_id=gateway_providers.provider_id) AND
      NOT EXISTS(SELECT 1 FROM gateway_models WHERE gateway_models.provider_id=gateway_providers.provider_id) AND
      NOT EXISTS(SELECT 1 FROM gateway_routes WHERE gateway_routes.provider_id=gateway_providers.provider_id) AND
      NOT EXISTS(SELECT 1 FROM gateway_credentials WHERE gateway_credentials.provider_id=gateway_providers.provider_id)`).run();
  }

  configureQuota(connectionId, input = {}) {
    const id = checkedId(connectionId, "connectionId");
    const limit = optionalNumber(input.limit);
    const remaining = optionalNumber(input.remaining);
    const resetAt = optionalNumber(input.resetAt, 0, this.clock() + 370 * 86_400_000);
    if (limit !== null && remaining !== null && remaining > limit) throw gatewayError("GATEWAY_QUOTA_INVALID", "La cuota restante supera el límite declarado.");
    const changed = this.db.prepare("UPDATE gateway_connections SET quota_limit=?,quota_remaining=?,quota_reset_at=?,updated_at=? WHERE connection_id=?")
      .run(limit, remaining, resetAt, nowIso(this.clock()), id).changes;
    if (!changed) throw gatewayError("GATEWAY_CONNECTION_UNKNOWN", "Conexión desconocida.");
    return this.state(id);
  }

  configurePricing(connectionId, input = {}) {
    const id = checkedId(connectionId, "connectionId");
    const inputCost = optionalNumber(input.inputCostPerMillion, 0, 1_000_000);
    const outputCost = optionalNumber(input.outputCostPerMillion, 0, 1_000_000);
    const changed = this.db.prepare("UPDATE gateway_connections SET input_cost_per_million=?,output_cost_per_million=?,updated_at=? WHERE connection_id=?")
      .run(inputCost, outputCost, nowIso(this.clock()), id).changes;
    if (!changed) throw gatewayError("GATEWAY_CONNECTION_UNKNOWN", "Conexión desconocida.");
    return this.state(id);
  }

  resetConnectionHealth(connectionId, input = {}) {
    const id = checkedId(connectionId, "connectionId");
    const current = this.db.prepare("SELECT enabled FROM gateway_connections WHERE connection_id=?").get(id);
    if (!current) throw gatewayError("GATEWAY_CONNECTION_UNKNOWN", "Conexión desconocida.");
    const clearQuota = input.clearQuota === true;
    this.db.prepare(`UPDATE gateway_connections SET health=?,circuit_state='CLOSED',failure_count=0,cooldown_until=0,
      quota_limit=CASE WHEN ? THEN NULL ELSE quota_limit END,
      quota_remaining=CASE WHEN ? THEN NULL ELSE quota_remaining END,
      quota_reset_at=CASE WHEN ? THEN NULL ELSE quota_reset_at END,updated_at=? WHERE connection_id=?`)
      .run(current.enabled ? "UNKNOWN" : "DISABLED", Number(clearQuota), Number(clearQuota), Number(clearQuota), nowIso(this.clock()), id);
    this.event(id, "CONNECTION_HEALTH_RESET", { reason: String(input.reason || "EXPLICIT_RESET").slice(0, 200), clearQuota });
    return this.state(id);
  }

  refresh(row, currentTime = this.clock()) {
    if (!row) return null;
    if (row.quota_reset_at && currentTime >= row.quota_reset_at && row.health !== "AUTH_FAILED" && row.health !== "AUTH_EXPIRED") {
      this.db.prepare(`UPDATE gateway_connections SET quota_remaining=quota_limit,quota_reset_at=NULL,
        health=CASE WHEN health IN ('QUOTA_EXHAUSTED','RATE_LIMITED') THEN 'AVAILABLE' ELSE health END,
        circuit_state=CASE WHEN health IN ('QUOTA_EXHAUSTED','RATE_LIMITED') THEN 'CLOSED' ELSE circuit_state END,
        cooldown_until=0,updated_at=? WHERE connection_id=?`).run(nowIso(currentTime), row.connection_id);
      return this.db.prepare("SELECT * FROM gateway_connections WHERE connection_id=?").get(row.connection_id);
    }
    if (row.circuit_state === "OPEN" && row.cooldown_until > 0 && currentTime >= row.cooldown_until && !HARD_BLOCKED.has(row.health)) {
      this.db.prepare("UPDATE gateway_connections SET circuit_state='HALF_OPEN',updated_at=? WHERE connection_id=?").run(nowIso(currentTime), row.connection_id);
      return this.db.prepare("SELECT * FROM gateway_connections WHERE connection_id=?").get(row.connection_id);
    }
    return row;
  }

  normalize(row) {
    if (!row) return null;
    const active = Number(this.db.prepare("SELECT COALESCE(SUM(estimated_units),0) AS value FROM gateway_attempts WHERE connection_id=? AND state='RUNNING'").get(row.connection_id).value);
    const activeAttempts = Number(this.db.prepare("SELECT COUNT(*) AS count FROM gateway_attempts WHERE connection_id=? AND state='RUNNING'").get(row.connection_id).count);
    const route = this.db.prepare("SELECT protocol,host,endpoint,local FROM gateway_routes WHERE route_id=?").get(row.route_id);
    const model = this.db.prepare("SELECT model_id,lifecycle FROM gateway_models WHERE model_key=?").get(row.model_key);
    const credentialReady = !row.credential_ref || Boolean(this.db.prepare("SELECT available FROM gateway_credentials WHERE credential_ref=?").get(row.credential_ref)?.available);
    const availableQuota = row.quota_remaining === null ? null : Math.max(0, Number(row.quota_remaining) - active);
    const available = Boolean(row.enabled) && credentialReady && !HARD_BLOCKED.has(row.health) && row.circuit_state !== "OPEN" && (availableQuota === null || availableQuota > 0) && !(row.circuit_state === "HALF_OPEN" && activeAttempts > 0);
    const pricingKnown = row.input_cost_per_million !== null && row.output_cost_per_million !== null;
    return {
      schema: "dorn.gateway-connection/2", connectionId: row.connection_id, providerId: row.provider_id,
      modelKey: row.model_key, modelId: model?.model_id || null, modelLifecycle: model?.lifecycle || "UNKNOWN",
      routeId: row.route_id, route: route ? { protocol: route.protocol, host: route.host, endpoint: route.endpoint, local: Boolean(route.local) } : null,
      credentialRef: row.credential_ref || null, credentialReady, label: row.label, enabled: Boolean(row.enabled), priority: row.priority,
      compatibilityKey: row.compatibility_key, capabilities: stringList(parseJson(row.capabilities_json, [])), health: row.health,
      circuitState: row.circuit_state, failureCount: row.failure_count, successCount: row.success_count,
      averageLatencyMs: row.average_latency_ms, cooldownUntil: row.cooldown_until || null,
      quota: row.quota_limit === null && row.quota_remaining === null ? null : { limit: row.quota_limit, remaining: row.quota_remaining, resetAt: row.quota_reset_at, available: availableQuota },
      activeReservedUnits: active, activeAttempts, pricing: pricingKnown ? { inputCostPerMillion: row.input_cost_per_million, outputCostPerMillion: row.output_cost_per_million } : { state: "UNKNOWN" },
      available, lastCheckedAt: row.last_checked_at, updatedAt: row.updated_at
    };
  }

  state(connectionId) {
    const id = checkedId(connectionId, "connectionId");
    return this.normalize(this.refresh(this.db.prepare("SELECT * FROM gateway_connections WHERE connection_id=?").get(id)));
  }

  attempt(attemptId) {
    const row = this.db.prepare(`SELECT attempt_id,connection_id,work_unit_id,request_fingerprint,estimated_units,
      input_tokens,output_tokens,actual_units,cost_usd,state,started_at,finished_at,error_family
      FROM gateway_attempts WHERE attempt_id=?`).get(checkedId(attemptId, "attemptId"));
    if (!row) return null;
    return {
      attemptId: row.attempt_id, connectionId: row.connection_id, workUnitId: row.work_unit_id,
      requestFingerprint: row.request_fingerprint, estimatedUnits: row.estimated_units,
      inputTokens: row.input_tokens, outputTokens: row.output_tokens, actualUnits: row.actual_units,
      costUsd: row.cost_usd, state: row.state, startedAt: row.started_at, finishedAt: row.finished_at,
      errorFamily: row.error_family
    };
  }

  candidates(input = {}) {
    const excluded = new Set((input.excludeConnectionIds || []).map(String));
    const allowed = input.allowConnectionIds ? new Set(input.allowConnectionIds.map(String)) : null;
    const required = new Set(stringList(input.requiredCapabilities));
    let compatibilityKey = input.compatibilityKey ? String(input.compatibilityKey) : null;
    if (!compatibilityKey && input.preferredConnectionId) compatibilityKey = this.state(input.preferredConnectionId)?.compatibilityKey || null;
    return this.db.prepare("SELECT * FROM gateway_connections ORDER BY priority,connection_id").all()
      .map((row) => this.normalize(this.refresh(row)))
      .filter((entry) => entry && entry.available && !excluded.has(entry.connectionId) && (!allowed || allowed.has(entry.connectionId)) && (!compatibilityKey || entry.compatibilityKey === compatibilityKey) && [...required].every((capability) => entry.capabilities.includes(capability)))
      .sort((left, right) => {
        const leftCost = left.pricing.state === "UNKNOWN" ? 1_000_000 : left.pricing.inputCostPerMillion + left.pricing.outputCostPerMillion;
        const rightCost = right.pricing.state === "UNKNOWN" ? 1_000_000 : right.pricing.inputCostPerMillion + right.pricing.outputCostPerMillion;
        return left.priority - right.priority || left.activeAttempts - right.activeAttempts || left.failureCount - right.failureCount || left.averageLatencyMs - right.averageLatencyMs || leftCost - rightCost || left.connectionId.localeCompare(right.connectionId);
      });
  }

  begin(connectionId, input = {}) {
    const id = checkedId(connectionId, "connectionId");
    const fingerprint = String(input.requestFingerprint || "").toLowerCase();
    if (!SHA256.test(fingerprint)) throw gatewayError("GATEWAY_REQUEST_FINGERPRINT_REQUIRED", "Cada intento necesita el hash exacto de su contexto.");
    const estimated = boundedNumber(input.estimatedUnits, 0, 0, 10_000_000);
    const attemptId = crypto.randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.refresh(this.db.prepare("SELECT * FROM gateway_connections WHERE connection_id=?").get(id));
      if (!row) throw gatewayError("GATEWAY_CONNECTION_UNKNOWN", "Conexión desconocida.");
      const normalized = this.normalize(row);
      const disabledProbe = input.probe === true && !normalized.enabled && normalized.credentialReady;
      if (!normalized.available && !disabledProbe) throw gatewayError("GATEWAY_CONNECTION_UNAVAILABLE", "La conexión no está disponible.", { state: normalized });
      if (normalized.quota && normalized.quota.available < estimated) throw gatewayError("GATEWAY_QUOTA_RESERVATION_REJECTED", "La cuota restante no permite reservar la solicitud.");
      if (input.resumeCheckpointId) {
        const checkpointId = checkedId(input.resumeCheckpointId, "checkpointId");
        const checkpoint = this.db.prepare("SELECT * FROM gateway_failover_checkpoints WHERE checkpoint_id=?").get(checkpointId);
        if (!checkpoint || checkpoint.state !== "READY" || checkpoint.to_connection_id !== id || checkpoint.request_fingerprint !== fingerprint) throw gatewayError("GATEWAY_FAILOVER_CHECKPOINT_INVALID", "El checkpoint no corresponde a esta ruta y contexto.");
        this.db.prepare("UPDATE gateway_failover_checkpoints SET state='CONSUMED',consumed_at=? WHERE checkpoint_id=?").run(nowIso(this.clock()), checkpointId);
      }
      this.db.prepare(`INSERT INTO gateway_attempts(
        attempt_id,connection_id,work_unit_id,request_fingerprint,estimated_units,state,started_at
      ) VALUES(?,?,?,?,?,'RUNNING',?)`).run(attemptId, id, input.workUnitId ? String(input.workUnitId).slice(0, 256) : null, fingerprint, estimated, nowIso(this.clock()));
      this.db.exec("COMMIT");
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
    this.event(id, "ATTEMPT_STARTED", { attemptId, estimatedUnits: estimated, resumed: Boolean(input.resumeCheckpointId) });
    return { attemptId, connectionId: id, requestFingerprint: fingerprint, estimatedUnits: estimated, startedAt: this.clock() };
  }

  finish(attemptId, input = {}) {
    const id = checkedId(attemptId, "attemptId");
    let connectionId = null;
    let classification = null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const attempt = this.db.prepare("SELECT * FROM gateway_attempts WHERE attempt_id=?").get(id);
      if (!attempt) throw gatewayError("GATEWAY_ATTEMPT_UNKNOWN", "Intento desconocido.");
      connectionId = attempt.connection_id;
      if (attempt.state !== "RUNNING") { this.db.exec("COMMIT"); return this.state(connectionId); }
      const current = this.db.prepare("SELECT * FROM gateway_connections WHERE connection_id=?").get(connectionId);
      const success = input.success === true;
      const usage = usageUnits(input.usage);
      const actualUnits = usage.total || boundedNumber(input.actualUnits, attempt.estimated_units, 0, 100_000_000);
      const latencyMs = boundedNumber(input.latencyMs, 0, 0, 86_400_000);
      const rateLimit = input.rateLimit && typeof input.rateLimit === "object" ? input.rateLimit : {};
      classification = success ? null : classifyGatewayFailure(input.error || input);
      let health = current.health;
      let circuitState = current.circuit_state;
      let failures = current.failure_count;
      let cooldownUntil = current.cooldown_until;
      if (success) {
        failures = 0;
        circuitState = "CLOSED";
        cooldownUntil = 0;
        if (!new Set(["AUTH_FAILED", "AUTH_EXPIRED", "DISABLED"]).has(health)) health = "AVAILABLE";
      } else if (classification.family === "AUTH") {
        failures += 1; health = "AUTH_FAILED"; circuitState = "OPEN"; cooldownUntil = 0;
      } else if (classification.family === "QUOTA") {
        failures += 1; health = "QUOTA_EXHAUSTED"; circuitState = "OPEN";
        cooldownUntil = boundedNumber(rateLimit.quotaResetAt, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
      } else if (classification.family === "RATE_LIMIT") {
        failures += 1; health = "RATE_LIMITED"; circuitState = "OPEN";
        cooldownUntil = boundedNumber(rateLimit.quotaResetAt, this.clock() + boundedNumber(rateLimit.retryAfterMs, this.defaultCooldownMs, 1_000, 7 * 86_400_000), 0, Number.MAX_SAFE_INTEGER);
      } else if (classification.retryable) {
        failures += 1;
        if (failures >= this.failureThreshold) { health = "DEGRADED"; circuitState = "OPEN"; cooldownUntil = this.clock() + this.defaultCooldownMs; }
      }
      const quotaLimit = optionalNumber(rateLimit.quotaLimit) ?? current.quota_limit;
      let quotaRemaining = optionalNumber(rateLimit.quotaRemaining);
      if (quotaRemaining === null) quotaRemaining = current.quota_remaining === null ? null : Math.max(0, Number(current.quota_remaining) - actualUnits);
      const quotaResetAt = optionalNumber(rateLimit.quotaResetAt, 0, this.clock() + 370 * 86_400_000) ?? current.quota_reset_at;
      if (success && quotaRemaining === 0) { health = "QUOTA_EXHAUSTED"; circuitState = "OPEN"; cooldownUntil = quotaResetAt || Number.MAX_SAFE_INTEGER; }
      if (!current.enabled) { health = "DISABLED"; circuitState = "OPEN"; cooldownUntil = 0; }
      const successCount = current.success_count + (success ? 1 : 0);
      const averageLatency = success ? (current.success_count ? ((current.average_latency_ms * current.success_count) + latencyMs) / successCount : latencyMs) : current.average_latency_ms;
      const pricingKnown = current.input_cost_per_million !== null && current.output_cost_per_million !== null;
      const costUsd = pricingKnown ? (usage.inputTokens * current.input_cost_per_million + usage.outputTokens * current.output_cost_per_million) / 1_000_000 : null;
      this.db.prepare(`UPDATE gateway_attempts SET state=?,input_tokens=?,output_tokens=?,actual_units=?,cost_usd=?,finished_at=?,error_family=? WHERE attempt_id=?`)
        .run(success ? "SUCCEEDED" : "FAILED", usage.inputTokens, usage.outputTokens, actualUnits, costUsd, nowIso(this.clock()), classification?.family || null, id);
      this.db.prepare(`UPDATE gateway_connections SET health=?,circuit_state=?,failure_count=?,success_count=?,average_latency_ms=?,cooldown_until=?,
        quota_limit=?,quota_remaining=?,quota_reset_at=?,last_checked_at=?,updated_at=? WHERE connection_id=?`)
        .run(health, circuitState, failures, successCount, averageLatency, cooldownUntil, quotaLimit, quotaRemaining, quotaResetAt, nowIso(this.clock()), nowIso(this.clock()), connectionId);
      this.db.exec("COMMIT");
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
    this.event(connectionId, input.success === true ? "ATTEMPT_SUCCEEDED" : "ATTEMPT_FAILED", { attemptId: id, failure: classification, rateLimitObserved: Boolean(input.rateLimit?.observed) });
    return this.state(connectionId);
  }

  checkpointFailover(attemptId, input = {}) {
    const id = checkedId(attemptId, "attemptId");
    const targetId = checkedId(input.toConnectionId, "toConnectionId");
    if (input.streamed === true) throw gatewayError("GATEWAY_FAILOVER_AFTER_OUTPUT_BLOCKED", "DORN no cambia de IA después de emitir una respuesta parcial.");
    const attempt = this.db.prepare("SELECT * FROM gateway_attempts WHERE attempt_id=?").get(id);
    if (!attempt || attempt.state !== "FAILED") throw gatewayError("GATEWAY_FAILOVER_SOURCE_INVALID", "El failover exige un intento fallido cerrado.");
    const source = this.state(attempt.connection_id);
    const target = this.state(targetId);
    if (!target?.available || source.compatibilityKey !== target.compatibilityKey) throw gatewayError("GATEWAY_FAILOVER_ROUTE_INCOMPATIBLE", "La ruta de reemplazo no conserva el mismo contrato técnico.");
    if (attempt.request_fingerprint !== String(input.requestFingerprint || "").toLowerCase()) throw gatewayError("GATEWAY_FAILOVER_CONTEXT_MISMATCH", "El contexto cambió antes del failover.");
    const checkpointId = crypto.randomUUID();
    const record = {
      checkpointId, attemptId: id, fromConnectionId: attempt.connection_id, toConnectionId: targetId,
      workUnitId: input.workUnitId ? String(input.workUnitId).slice(0, 256) : attempt.work_unit_id,
      conversationId: input.conversationId ? String(input.conversationId).slice(0, 256) : null,
      requestFingerprint: attempt.request_fingerprint, createdAt: nowIso(this.clock())
    };
    const checkpointHash = digest(JSON.stringify(record));
    this.db.prepare(`INSERT INTO gateway_failover_checkpoints(
      checkpoint_id,attempt_id,from_connection_id,to_connection_id,work_unit_id,conversation_id,request_fingerprint,state,checkpoint_hash,created_at
    ) VALUES(?,?,?,?,?,?,?,'READY',?,?)`).run(checkpointId, id, record.fromConnectionId, targetId, record.workUnitId, record.conversationId, record.requestFingerprint, checkpointHash, record.createdAt);
    this.event(attempt.connection_id, "FAILOVER_CHECKPOINT_CREATED", { checkpointId, toConnectionId: targetId, checkpointHash });
    return { schema: "dorn.gateway-failover-checkpoint/1", ...record, checkpointHash, state: "READY" };
  }

  shouldFailover(error) { return classifyGatewayFailure(error).failover; }

  report(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    const entries = this.db.prepare("SELECT * FROM gateway_connections ORDER BY priority,connection_id").all().map((row) => this.normalize(this.refresh(row)));
    const events = this.db.prepare("SELECT * FROM gateway_events ORDER BY created_at DESC,event_id DESC LIMIT ?").all(limit).map((row) => ({
      eventId: row.event_id, connectionId: row.connection_id, type: row.type, detail: parseJson(row.detail_json, {}), createdAt: row.created_at
    }));
    const checkpoints = this.db.prepare("SELECT checkpoint_id,from_connection_id,to_connection_id,state,checkpoint_hash,created_at,consumed_at FROM gateway_failover_checkpoints ORDER BY created_at DESC LIMIT ?").all(limit).map((row) => ({
      checkpointId: row.checkpoint_id, fromConnectionId: row.from_connection_id, toConnectionId: row.to_connection_id,
      state: row.state, checkpointHash: row.checkpoint_hash, createdAt: row.created_at, consumedAt: row.consumed_at
    }));
    const entityCounts = Object.fromEntries(["providers", "models", "routes", "credentials", "connections"].map((name) => [name, Number(this.db.prepare(`SELECT COUNT(*) AS count FROM gateway_${name}`).get().count)]));
    const telemetry = this.db.prepare(`SELECT COUNT(*) AS attempts,
      COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(cost_usd),0) AS known_cost_usd,
      SUM(CASE WHEN state='SUCCEEDED' THEN 1 ELSE 0 END) AS succeeded,
      SUM(CASE WHEN state='FAILED' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN state='SUCCEEDED' AND cost_usd IS NULL THEN 1 ELSE 0 END) AS cost_unknown
      FROM gateway_attempts WHERE state<>'RUNNING'`).get();
    return {
      schema: "dorn.intelligence-gateway/2", ownerId: this.ownerId, state: "FOUNDATION", entities: entityCounts,
      entries, events, checkpoints,
      telemetry: {
        attempts: Number(telemetry.attempts), succeeded: Number(telemetry.succeeded), failed: Number(telemetry.failed),
        inputTokens: Number(telemetry.input_tokens), outputTokens: Number(telemetry.output_tokens),
        knownCostUsd: Number(telemetry.known_cost_usd), costUnknown: Number(telemetry.cost_unknown)
      },
      activeAttempts: Number(this.db.prepare("SELECT COUNT(*) AS count FROM gateway_attempts WHERE state='RUNNING'").get().count)
    };
  }

  close() { this.db.close(); }
}

function assertNoSecretEntity(entities) {
  const serialized = JSON.stringify(entities);
  if (containsSecret(serialized)) throw gatewayError("GATEWAY_SECRET_REJECTED", "El registro normalizado contiene material sensible.");
}

module.exports = {
  IntelligenceGateway,
  classifyGatewayFailure,
  connectionEntities,
  estimateInputUnits,
  usageUnits
};
