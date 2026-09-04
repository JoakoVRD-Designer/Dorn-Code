"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertVerifiedConnection,
  runAutomaticProviderConnection
} = require("../out/main/dorn-suite/provider-quick-connect.js");
const { selectPresetModel } = require("../out/main/dorn-suite/ai-provider-compatibility.js");

function memoryStore(options = {}) {
  const records = new Map();
  const saves = [];
  const removals = [];
  return {
    records,
    removals,
    saves,
    async saveDraft(draft) {
      if (options.failActivation && draft.enabled === true) throw new Error("falló la activación");
      const saved = { ...structuredClone(draft), id: draft.id || "provider-1", hasApiKey: Boolean(draft.apiKey) || records.get(draft.id)?.hasApiKey === true };
      delete saved.apiKey;
      records.set(saved.id, saved);
      saves.push(structuredClone(saved));
      return structuredClone(saved);
    },
    async removeDraft(id) {
      removals.push(id);
      if (options.failCleanup) throw new Error("falló la limpieza");
      records.delete(id);
      return true;
    }
  };
}

const kimiDraft = Object.freeze({
  id: "kimi-connection",
  name: "Moonshot AI · Kimi",
  protocol: "openai-chat",
  authType: "bearer",
  baseUrl: "https://api.moonshot.ai/v1",
  endpoint: "/chat/completions",
  model: "kimi-k3",
  apiKey: "secret-for-test"
});

test("la selección Kimi nunca cambia a un modelo ajeno aunque el catálogo lo liste primero", () => {
  const models = [
    { id: "moonshot-v1-128k" },
    { id: "embedding-large" },
    { id: "kimi-k2.7-code-highspeed" },
    { id: "kimi-k3" }
  ];
  assert.equal(selectPresetModel(models, "kimi-k3", ["kimi-"]), "kimi-k3");
  assert.equal(selectPresetModel(models, "modelo-retirado", ["kimi-"]), "kimi-k2.7-code-highspeed");
  assert.equal(selectPresetModel([{ id: "moonshot-v1-128k" }], "kimi-k3", ["kimi-"]), null);
});

test("Kimi se activa sólo después de descubrir su modelo y obtener una respuesta útil", async () => {
  const store = memoryStore();
  const result = await runAutomaticProviderConnection({
    draft: kimiDraft,
    ...store,
    discoverModels: async () => [{ id: "moonshot-v1-128k" }, { id: "kimi-k3" }],
    selectModel: (models, preferred) => selectPresetModel(models, preferred, ["kimi-"]),
    verifyConnection: async () => ({ ok: true, message: " OK ", latencyMs: 25 })
  });

  assert.equal(result.provider.enabled, true);
  assert.equal(result.provider.model, "kimi-k3");
  assert.equal(result.verification.message, "OK");
  assert.deepEqual(store.saves.map((entry) => entry.enabled), [false, true]);
  assert.deepEqual(store.removals, []);
  assert.equal(store.records.size, 1);
});

test("un fallo del catálogo no obliga a editar JSON si la prueba real con el fallback oficial pasa", async () => {
  const store = memoryStore();
  const result = await runAutomaticProviderConnection({
    draft: kimiDraft,
    ...store,
    discoverModels: async () => { throw new Error("endpoint de modelos temporalmente indisponible"); },
    selectModel: (models, preferred) => selectPresetModel(models, preferred, ["kimi-"]),
    verifyConnection: async () => ({ ok: true, message: "OK" })
  });
  assert.equal(result.provider.model, "kimi-k3");
  assert.match(result.modelDiscoveryWarning, /temporalmente indisponible/);
  assert.equal(store.records.size, 1);
});

test("una respuesta vacía no activa Kimi y elimina el intento con su clave", async () => {
  const store = memoryStore();
  await assert.rejects(
    runAutomaticProviderConnection({
      draft: kimiDraft,
      ...store,
      discoverModels: async () => [{ id: "kimi-k3" }],
      selectModel: (models, preferred) => selectPresetModel(models, preferred, ["kimi-"]),
      verifyConnection: async () => ({ ok: true, message: "   " })
    }),
    (error) => error.code === "PROVIDER_AUTOMATIC_CONNECTION_FAILED" && error.causeCode === "PROVIDER_EMPTY_TEST_RESPONSE" && error.cleanupSucceeded === true
  );
  assert.deepEqual(store.removals, ["kimi-connection"]);
  assert.equal(store.records.size, 0);
});

test("si falla el guardado final, DORN revierte la conexión temporal completa", async () => {
  const store = memoryStore({ failActivation: true });
  await assert.rejects(
    runAutomaticProviderConnection({
      draft: kimiDraft,
      ...store,
      discoverModels: async () => [{ id: "kimi-k3" }],
      selectModel: (models, preferred) => selectPresetModel(models, preferred, ["kimi-"]),
      verifyConnection: async () => ({ ok: true, message: "OK" })
    }),
    (error) => error.code === "PROVIDER_AUTOMATIC_CONNECTION_FAILED" && error.cleanupSucceeded === true
  );
  assert.equal(store.records.size, 0);
});

test("un fallo de limpieza nunca se oculta detrás del error original", async () => {
  const store = memoryStore({ failCleanup: true });
  await assert.rejects(
    runAutomaticProviderConnection({
      draft: kimiDraft,
      ...store,
      discoverModels: async () => [{ id: "kimi-k3" }],
      selectModel: (models, preferred) => selectPresetModel(models, preferred, ["kimi-"]),
      verifyConnection: async () => ({ ok: false, message: "" })
    }),
    (error) => error.cleanupSucceeded === false && /limpieza/.test(error.cleanupError)
  );
});

test("la evidencia de conexión exige estado positivo y texto utilizable", () => {
  assert.throws(() => assertVerifiedConnection(null), (error) => error.code === "PROVIDER_VERIFICATION_REJECTED");
  assert.throws(() => assertVerifiedConnection({ ok: true, message: "" }), (error) => error.code === "PROVIDER_EMPTY_TEST_RESPONSE");
});
