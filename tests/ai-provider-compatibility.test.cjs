"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const {
  getResponsePath,
  normalizeProviderDraft,
  quickConnectPolicy,
  renderProviderTemplate,
  responsePathSegments,
  selectPresetModel,
  validateProviderPreset
} = require(path.join(root, "out", "main", "dorn-suite", "ai-provider-compatibility.js"));

function readPresets() {
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const match = main.match(/const PRESETS = (\[[\s\S]*?\n\]);\nfunction encryptSecret/);
  assert.ok(match, "No se encontró el catálogo de presets en un bloque aislable.");
  return vm.runInNewContext(match[1], Object.create(null), { timeout: 1000 });
}

function screenshotDraft(overrides = {}) {
  return {
    name: "API compatible de razonamiento",
    protocol: "generic-json",
    authType: "bearer",
    authHeader: "Authorization",
    baseUrl: "https://api.example.com",
    endpoint: "/v1/chat/completions",
    model: "reasoning-model",
    headers: {
      Authorization: "Bearer {{API_KEY}}",
      "Content-Type": "application/json"
    },
    requestTemplate: {
      model: "{{MODEL}}",
      messages: [{ role: "user", content: "{{PROMPT}}" }],
      reasoning_effort: "max"
    },
    responsePath: "choices[0].message.reasoning_content",
    capabilities: ["text", "reasoning", "CODE", "vision", "tools", "long-context", "code"],
    ...overrides
  };
}

test("la configuración mostrada por el usuario se normaliza sin guardar la credencial en JSON", () => {
  const draft = normalizeProviderDraft(screenshotDraft());
  assert.equal(draft.authType, "bearer");
  assert.equal(draft.authHeader, "Authorization");
  assert.deepEqual(draft.headers, { "Content-Type": "application/json" });
  assert.deepEqual(draft.capabilities, ["text", "reasoning", "code", "vision", "tools", "long-context"]);
  assert.deepEqual(responsePathSegments(draft.responsePath), ["choices", "0", "message", "reasoning_content"]);
});

test("las variables JSON admiten mayúsculas y preservan mensajes estructurados", () => {
  const messages = [{ role: "user", content: "Construye DORN" }];
  const rendered = renderProviderTemplate({
    model: "{{MODEL}}",
    messages: "{{MESSAGES}}",
    prompt: "Solicitud: {{PROMPT}}",
    system: "{{SYSTEM}}"
  }, {
    model: "gpt-compatible",
    messages,
    prompt: "Repara y verifica",
    system: "Trabaja con evidencia"
  });
  assert.equal(rendered.model, "gpt-compatible");
  assert.strictEqual(rendered.messages, messages);
  assert.equal(rendered.prompt, "Solicitud: Repara y verifica");
  assert.equal(rendered.system, "Trabaja con evidencia");
});

test("la ruta de respuesta admite índices y bloquea accesos al prototipo", () => {
  const response = { choices: [{ message: { reasoning_content: "Resultado verificable" } }] };
  assert.equal(getResponsePath(response, "choices[0].message.reasoning_content"), "Resultado verificable");
  assert.throws(() => getResponsePath(response, "choices[0].__proto__.polluted"), (error) => error.code === "PROVIDER_RESPONSE_PATH_INVALID");
  assert.throws(() => getResponsePath(response, "choices[foo].message"), (error) => error.code === "PROVIDER_RESPONSE_PATH_INVALID");
});

test("DORN migra api-key antiguo pero rechaza secretos literales dentro de cabeceras", () => {
  const migrated = normalizeProviderDraft(screenshotDraft({
    authType: "api-key",
    authHeader: "",
    headers: { "Content-Type": "application/json" }
  }));
  assert.equal(migrated.authType, "custom-header");
  assert.equal(migrated.authHeader, "api-key");

  assert.throws(() => normalizeProviderDraft(screenshotDraft({
    headers: { Authorization: "Bearer sk-secret-real", "Content-Type": "application/json" }
  })), (error) => error.code === "PROVIDER_SECRET_IN_HEADERS" && /Clave API/.test(error.message));
});

test("todos los presets tienen un contrato válido y la conexión de una clave excluye casos que necesitan más datos", () => {
  const presets = readPresets();
  assert.ok(presets.length >= 25, `Catálogo inesperadamente reducido: ${presets.length}`);
  assert.equal(new Set(presets.map((preset) => preset.key)).size, presets.length, "Hay claves de preset duplicadas.");
  for (const preset of presets) {
    const validated = validateProviderPreset(preset);
    assert.equal(validated.key, preset.key);
    assert.deepEqual(validated.policy, quickConnectPolicy(preset));
  }

  const byKey = new Map(presets.map((preset) => [preset.key, preset]));
  assert.deepEqual(quickConnectPolicy(byKey.get("openai-images")), { ready: false, requiresApiKey: true, reason: "SPECIALIZED_IMAGE_FLOW" });
  assert.deepEqual(quickConnectPolicy(byKey.get("generic-json")), { ready: false, requiresApiKey: true, reason: "CUSTOM_TEMPLATE_REQUIRED" });
  assert.deepEqual(quickConnectPolicy(byKey.get("cloudflare-workers-ai")), { ready: false, requiresApiKey: true, reason: "ACCOUNT_FIELD_REQUIRED" });
  assert.equal(quickConnectPolicy(byKey.get("openai-responses")).ready, true);
  assert.equal(quickConnectPolicy(byKey.get("anthropic-messages")).ready, true);
  assert.equal(quickConnectPolicy(byKey.get("ollama")).requiresApiKey, false);
  assert.equal(byKey.get("google-gemini").draft.model, "gemini-3.7-flash");
  assert.equal(byKey.get("anthropic-messages").draft.model, "claude-sonnet-5");
});

test("la selección automática conserva el modelo válido o evita modelos especializados", () => {
  const models = [{ id: "embed-large" }, { id: "chat-general" }, { id: "speech-only" }];
  assert.equal(selectPresetModel(models, "chat-general"), "chat-general");
  assert.equal(selectPresetModel(models, "modelo-retirado"), "chat-general");
  assert.equal(selectPresetModel([], "modelo"), null);
});

test("Kimi se conecta desde su ficha del catálogo sin pedir al usuario editar JSON", () => {
  const kimi = readPresets().find((preset) => preset.key === "moonshot-kimi");
  assert.ok(kimi, "Falta el preset Kimi.");
  assert.equal(kimi.draft.protocol, "openai-chat");
  assert.equal(kimi.draft.baseUrl, "https://api.moonshot.ai/v1");
  assert.equal(kimi.draft.endpoint, "/chat/completions");
  assert.equal(kimi.draft.model, "kimi-k3");
  assert.deepEqual(Array.from(kimi.modelPrefixes), ["kimi-"]);
  assert.equal(Object.keys(kimi.draft.requestTemplate).length, 0);
  assert.equal(validateProviderPreset(kimi).policy.ready, true);
  assert.equal(validateProviderPreset(kimi).policy.requiresApiKey, true);

  const controlCenter = fs.readFileSync(path.join(root, "out", "renderer", "vendor", "dorn-control-center.js"), "utf8");
  assert.match(controlCenter, /moonshot:\s*"moonshot-kimi"/);
  assert.match(controlCenter, /data-ai-connector-key/);
  assert.match(controlCenter, /data-ai-connector-auto/);
  assert.match(controlCenter, /CONFIGURACIÓN AUTOMÁTICA/);
  assert.match(controlCenter, /Sólo pega la API key; DORN configura y prueba lo demás/);
  assert.match(controlCenter, /Conectar automáticamente/);
  assert.match(controlCenter, /window\.dorn\.providers\.quickConnect\(\{ presetKey, apiKey \}\)/);
  assert.match(controlCenter, /DORN aplicará la plantilla, cabeceras y ruta de respuesta del proveedor/);
  assert.match(controlCenter, /aliases: "kimi k1\.5 k2 k2\.5 k2\.6 k2\.7 k3 kimi code moonshot"/);
  assert.match(controlCenter, /const encyclopediaConnector = \(entry\) =>/);
  assert.match(controlCenter, /moonshot ai[\s\S]{0,160}connector\.id === "moonshot"/);
  assert.match(controlCenter, /if \(connector\) \{\s*void reviewConnector\(connector\.name\);\s*return;/);
  assert.match(controlCenter, /DORN reconoce esta familia y usará su conector oficial verificado\. Sólo tendrás que pegar la clave API\./);
  assert.match(controlCenter, /\$\{connector \? "Conectar automáticamente" : "Revisar ficha"\}/);
});

test("la integración usa acceso completo visible y el mismo contrato de proveedor en interfaz y núcleo", () => {
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const controlCenter = fs.readFileSync(path.join(root, "out", "renderer", "vendor", "dorn-control-center.js"), "utf8");
  const quickConnect = fs.readFileSync(path.join(root, "out", "main", "dorn-suite", "provider-quick-connect.js"), "utf8");

  assert.match(main, /permissionMode:\s*"full-control"/);
  assert.match(main, /providerDraftSchema\.parse\(normalizeProviderDraft\(input\)\)/);
  assert.match(main, /return getResponsePath\(value, dottedPath\)/);
  assert.match(main, /return renderProviderTemplate\(value, context\)/);
  assert.match(main, /async quickConnect\(rawInput, verifyConnection\)/);
  assert.match(main, /runAutomaticProviderConnection/);
  assert.match(main, /runProviderEditTransaction/);
  assert.match(main, /removeDraft: \(id\) => this\.remove\(id\)/);
  assert.match(main, /providers\.saveFromEditor\(draft, testProvider\)/);
  assert.match(quickConnect, /saveDraft\(\{ \.\.\.structuredClone\(draft\), enabled: false \}\)/);
  assert.match(quickConnect, /assertVerifiedConnection\(await verifyConnection\(saved\.id\)\)/);
  assert.match(quickConnect, /saved = await saveDraft\(\{ \.\.\.saved, enabled: true \}\)/);
  assert.match(quickConnect, /await removeDraft\(saved\.id\)/);
  assert.match(main, /dorn:provider_quick_connect/);

  assert.match(controlCenter, /data-permission-mode/);
  assert.match(controlCenter, /value="full-control"[\s\S]{0,120}Acceso completo/);
  assert.match(controlCenter, /permissionMode:\s*backdrop\.querySelector\("\[data-permission-mode\]"\)\.value/);
  assert.match(controlCenter, /option value="custom-header"/);
  assert.doesNotMatch(controlCenter, /option value="api-key"/);
  assert.match(controlCenter, /No se pudo guardar:/);
  assert.match(controlCenter, /data-provider-quick-key/);
  assert.match(controlCenter, /Conectar, probar y activar/);
  assert.match(controlCenter, /window\.dorn\.providers\.quickConnect/);

  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(preload, /quickConnect: \(input\) => electron\.ipcRenderer\.invoke\("dorn:provider_quick_connect", input\)/);
});
