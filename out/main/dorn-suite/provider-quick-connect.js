"use strict";

function connectionError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, ...detail });
}

function assertVerifiedConnection(verification) {
  if (!verification || verification.ok !== true) {
    throw connectionError("PROVIDER_VERIFICATION_REJECTED", "La prueba independiente no confirmó la conexión.");
  }
  const message = String(verification.message || "").trim();
  if (!message) {
    throw connectionError("PROVIDER_EMPTY_TEST_RESPONSE", "La IA respondió sin contenido utilizable. DORN no activó la conexión.");
  }
  return { ...verification, message };
}

async function runAutomaticProviderConnection(options = {}) {
  const {
    draft,
    discoverModels,
    removeDraft,
    saveDraft,
    selectModel,
    verifyConnection
  } = options;
  if (!draft || typeof draft !== "object") throw connectionError("PROVIDER_AUTOMATIC_DRAFT_INVALID", "Falta la configuración automática del proveedor.");
  if (typeof saveDraft !== "function" || typeof removeDraft !== "function" || typeof verifyConnection !== "function") {
    throw connectionError("PROVIDER_AUTOMATIC_ADAPTER_MISSING", "DORN no pudo iniciar la transacción segura de conexión.");
  }

  let saved = null;
  let availableModels = [];
  let modelDiscoveryWarning = null;
  try {
    saved = await saveDraft({ ...structuredClone(draft), enabled: false });
    if (!saved?.id) throw connectionError("PROVIDER_TEMPORARY_SAVE_INVALID", "DORN no pudo crear la conexión temporal.");

    if (typeof discoverModels === "function") {
      try {
        const discovered = await discoverModels(saved.id);
        availableModels = Array.isArray(discovered) ? discovered : [];
        const selectedModel = typeof selectModel === "function" ? selectModel(availableModels, saved.model) : null;
        if (selectedModel && selectedModel !== saved.model) {
          saved = await saveDraft({ ...saved, model: selectedModel, enabled: false });
        }
      } catch (error) {
        modelDiscoveryWarning = String(error?.message || error || "No se pudo consultar el catálogo de modelos.").slice(0, 500);
      }
    }

    const verification = assertVerifiedConnection(await verifyConnection(saved.id));
    saved = await saveDraft({ ...saved, enabled: true });
    return {
      provider: saved,
      selectedModel: saved.model,
      discoveredModels: availableModels.length,
      modelDiscoveryWarning,
      verification
    };
  } catch (error) {
    let cleanupError = null;
    if (saved?.id) {
      try {
        await removeDraft(saved.id);
      } catch (cleanupFailure) {
        cleanupError = String(cleanupFailure?.message || cleanupFailure || "No se pudo retirar la conexión temporal.").slice(0, 500);
      }
    }
    throw connectionError(
      "PROVIDER_AUTOMATIC_CONNECTION_FAILED",
      String(error?.message || error || "La conexión automática no pudo verificarse."),
      {
        causeCode: error?.code || null,
        cleanupError,
        cleanupSucceeded: Boolean(saved?.id) && !cleanupError,
        modelDiscoveryWarning,
        temporaryProviderId: saved?.id || null
      }
    );
  }
}

module.exports = {
  assertVerifiedConnection,
  runAutomaticProviderConnection
};
