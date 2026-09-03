"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  connectionChanged,
  providerConnectionFingerprint,
  runProviderEditTransaction
} = require("../out/main/dorn-suite/provider-edit-transaction.js");

const existing = Object.freeze({
  id: "kimi-existing",
  name: "Kimi personal",
  protocol: "openai-chat",
  authType: "bearer",
  authHeader: "Authorization",
  baseUrl: "https://api.moonshot.ai/v1",
  endpoint: "/chat/completions",
  model: "kimi-k3",
  headers: {},
  requestTemplate: {},
  responsePath: "",
  enabled: true,
  priority: 58,
  capabilities: ["text", "reasoning"],
  local: false,
  encryptedKey: "enc:v1:old-key"
});

test("el fingerprint técnico es estable ante el orden de cabeceras", () => {
  const left = { ...existing, headers: { "x-two": "2", "x-one": "1" } };
  const right = { ...existing, headers: { "x-one": "1", "x-two": "2" } };
  assert.equal(providerConnectionFingerprint(left), providerConnectionFingerprint(right));
  assert.equal(connectionChanged(left, right), false);
});

test("cambiar sólo nombre o prioridad guarda sin una llamada innecesaria", async () => {
  let verifyCalls = 0;
  const draft = { ...existing, name: "Kimi trabajo", priority: 25 };
  delete draft.encryptedKey;
  const result = await runProviderEditTransaction({
    draft,
    existing,
    saveDraft: async (value) => ({ ...value, hasApiKey: true }),
    verifyConnection: async () => { verifyCalls += 1; return { ok: true, message: "OK" }; }
  });
  assert.equal(result.provider.name, "Kimi trabajo");
  assert.equal(result.connectionReverified, false);
  assert.equal(verifyCalls, 0);
});

test("cambiar modelo, URL, plantilla o clave exige prueba antes de reactivar", async () => {
  for (const mutation of [
    { model: "kimi-k2.7-code-highspeed" },
    { baseUrl: "https://example.invalid/v1" },
    { requestTemplate: { model: "{{MODEL}}" } },
    { apiKey: "new-key" }
  ]) {
    const saves = [];
    const draft = { ...existing, ...mutation };
    delete draft.encryptedKey;
    const result = await runProviderEditTransaction({
      draft,
      existing,
      saveDraft: async (value) => { saves.push(structuredClone(value)); return { ...value, hasApiKey: true }; },
      restoreDraft: async () => { throw new Error("no debe restaurar"); },
      verifyConnection: async () => ({ ok: true, message: "OK" })
    });
    assert.equal(result.connectionReverified, true);
    assert.deepEqual(saves.map((entry) => entry.enabled), [false, true]);
  }
});

test("si la nueva configuración activa falla, se restaura exactamente la anterior", async () => {
  const restored = [];
  const draft = { ...existing, model: "modelo-inexistente" };
  delete draft.encryptedKey;
  await assert.rejects(
    runProviderEditTransaction({
      draft,
      existing,
      saveDraft: async (value) => ({ ...value, hasApiKey: true }),
      restoreDraft: async (value) => { restored.push(structuredClone(value)); },
      verifyConnection: async () => ({ ok: false, message: "" })
    }),
    (error) => error.code === "PROVIDER_EDIT_TRANSACTION_FAILED" && error.rollbackSucceeded === true
  );
  assert.deepEqual(restored, [existing]);
  assert.equal(restored[0].encryptedKey, "enc:v1:old-key");
});

test("una conexión nueva que no supera la prueba se elimina sin dejar duplicados", async () => {
  const removed = [];
  const draft = { ...existing, id: "kimi-new" };
  delete draft.encryptedKey;
  await assert.rejects(
    runProviderEditTransaction({
      draft,
      existing: null,
      saveDraft: async (value) => value,
      removeDraft: async (id) => { removed.push(id); },
      verifyConnection: async () => ({ ok: true, message: "" })
    }),
    (error) => error.causeCode === "PROVIDER_EMPTY_TEST_RESPONSE" && error.rollbackSucceeded === true
  );
  assert.deepEqual(removed, ["kimi-new"]);
});

test("una conexión desactivada se puede editar y guardar sin conectarse a internet", async () => {
  let verified = false;
  const draft = { ...existing, enabled: false, model: "kimi-k2.7-code-highspeed" };
  delete draft.encryptedKey;
  const result = await runProviderEditTransaction({
    draft,
    existing,
    saveDraft: async (value) => value,
    verifyConnection: async () => { verified = true; return { ok: true, message: "OK" }; }
  });
  assert.equal(result.provider.enabled, false);
  assert.equal(result.connectionReverified, false);
  assert.equal(verified, false);
});
