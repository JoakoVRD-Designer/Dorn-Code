"use strict";

const { assertVerifiedConnection } = require("./provider-quick-connect");

const CONNECTION_FIELDS = Object.freeze([
  "protocol",
  "authType",
  "authHeader",
  "baseUrl",
  "endpoint",
  "model",
  "headers",
  "requestTemplate",
  "responsePath",
  "local"
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value ?? null;
}

function providerConnectionFingerprint(provider = {}) {
  return JSON.stringify(Object.fromEntries(CONNECTION_FIELDS.map((field) => [field, stableValue(provider[field])])));
}

function connectionChanged(existing, draft) {
  if (!existing) return true;
  if (draft.apiKey || draft.clearApiKey) return true;
  return providerConnectionFingerprint(existing) !== providerConnectionFingerprint(draft);
}

function editError(message, detail = {}) {
  return Object.assign(new Error(message), { code: "PROVIDER_EDIT_TRANSACTION_FAILED", ...detail });
}

async function runProviderEditTransaction(options = {}) {
  const { draft, existing = null, removeDraft, restoreDraft, saveDraft, verifyConnection } = options;
  if (!draft || typeof draft !== "object" || typeof saveDraft !== "function") {
    throw editError("DORN no pudo iniciar el guardado seguro de la conexión.");
  }
  const requestedEnabled = draft.enabled !== false;
  const requiresVerification = requestedEnabled && (existing?.enabled !== true || connectionChanged(existing, draft));
  let saved = null;
  try {
    saved = await saveDraft({ ...structuredClone(draft), enabled: requiresVerification ? false : requestedEnabled }, "candidate");
    if (!saved?.id) throw editError("DORN no recibió la identidad de la conexión guardada.");
    if (!requiresVerification) {
      return { provider: saved, connectionReverified: false, verification: null };
    }
    if (typeof verifyConnection !== "function") throw editError("No está disponible la prueba independiente de la conexión.");
    const verification = assertVerifiedConnection(await verifyConnection(saved.id));
    saved = await saveDraft({ ...saved, enabled: true }, "activate");
    return { provider: saved, connectionReverified: true, verification };
  } catch (error) {
    let rollbackError = null;
    try {
      if (existing) {
        if (typeof restoreDraft !== "function") throw new Error("No está disponible la restauración del estado anterior.");
        await restoreDraft(existing);
      } else if (saved?.id) {
        if (typeof removeDraft !== "function") throw new Error("No está disponible la limpieza de la conexión nueva.");
        await removeDraft(saved.id);
      }
    } catch (rollbackFailure) {
      rollbackError = String(rollbackFailure?.message || rollbackFailure || "Falló la restauración.").slice(0, 500);
    }
    throw editError(
      rollbackError
        ? `${String(error?.message || error)} Además, DORN no pudo restaurar el estado anterior: ${rollbackError}`
        : `${String(error?.message || error)} DORN restauró la conexión anterior sin aplicar el cambio.`,
      {
        causeCode: error?.code || null,
        rollbackError,
        rollbackSucceeded: !rollbackError
      }
    );
  }
}

module.exports = {
  CONNECTION_FIELDS,
  connectionChanged,
  providerConnectionFingerprint,
  runProviderEditTransaction
};
