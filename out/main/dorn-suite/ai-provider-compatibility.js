"use strict";

const AUTH_PLACEHOLDER = /(?:\{\{\s*API_KEY\s*\}\}|\$\{\s*API_KEY\s*\}|<\s*API_KEY\s*>|\[\s*API_KEY\s*\])/i;
const ALLOWED_TEMPLATE_KEYS = new Set(["model", "messages", "prompt", "system"]);
const BLOCKED_PATH_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const NATIVE_PROTOCOLS = new Set(["openai-responses", "openai-chat", "anthropic-messages", "ollama-chat", "dorn-local", "dorn-guide"]);

function compatibilityError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateTemplate(template) {
  const queue = [{ value: template, depth: 0 }];
  let nodes = 0;
  while (queue.length) {
    const { value, depth } = queue.shift();
    nodes += 1;
    if (nodes > 5000 || depth > 32) throw compatibilityError("PROVIDER_TEMPLATE_TOO_COMPLEX", "La plantilla JSON es demasiado grande o profunda.");
    if (typeof value === "string") {
      if (value.length > 64 * 1024) throw compatibilityError("PROVIDER_TEMPLATE_VALUE_TOO_LARGE", "La plantilla JSON contiene un texto demasiado largo.");
      for (const match of value.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
        const key = match[1].toLowerCase();
        if (!ALLOWED_TEMPLATE_KEYS.has(key)) {
          throw compatibilityError("PROVIDER_TEMPLATE_PLACEHOLDER_UNKNOWN", `La plantilla usa {{${match[1]}}}, pero DORN sólo admite MODEL, MESSAGES, PROMPT y SYSTEM.`);
        }
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) queue.push({ value: entry, depth: depth + 1 });
      continue;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (BLOCKED_PATH_KEYS.has(key)) throw compatibilityError("PROVIDER_TEMPLATE_KEY_UNSAFE", "La plantilla JSON contiene una clave insegura.");
        queue.push({ value: entry, depth: depth + 1 });
      }
    }
  }
  return template;
}

function responsePathSegments(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value) return [];
  if (value.length > 300) throw compatibilityError("PROVIDER_RESPONSE_PATH_TOO_LONG", "La ruta de respuesta es demasiado larga.");
  const normalized = value.replace(/\[\s*(\d+)\s*\]/g, ".$1");
  if (/\[|\]/.test(normalized)) throw compatibilityError("PROVIDER_RESPONSE_PATH_INVALID", "La ruta de respuesta usa corchetes no compatibles.");
  const segments = normalized.split(".");
  if (segments.some((part) => !part || (!/^\d+$/.test(part) && !/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(part)) || BLOCKED_PATH_KEYS.has(part))) {
    throw compatibilityError("PROVIDER_RESPONSE_PATH_INVALID", "La ruta de respuesta no es segura. Usa, por ejemplo, choices[0].message.content.");
  }
  return segments;
}

function getResponsePath(value, rawPath) {
  let current = value;
  for (const segment of responsePathSegments(rawPath)) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

function renderProviderTemplate(value, context) {
  if (Array.isArray(value)) return value.map((entry) => renderProviderTemplate(entry, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, renderProviderTemplate(entry, context)]));
  }
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/);
  if (exact) {
    const key = exact[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(context, key)) return context[key];
  }
  return value.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, rawKey) => {
    const key = rawKey.toLowerCase();
    return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key] ?? "") : _match;
  });
}

function normalizeProviderDraft(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw compatibilityError("PROVIDER_DRAFT_INVALID", "La conexión debe ser un objeto.");
  const draft = { ...input };
  draft.headers = input.headers && typeof input.headers === "object" && !Array.isArray(input.headers) ? { ...input.headers } : input.headers;
  draft.requestTemplate = validateTemplate(input.requestTemplate && typeof input.requestTemplate === "object" && !Array.isArray(input.requestTemplate) ? input.requestTemplate : input.requestTemplate || {});
  responsePathSegments(input.responsePath || "");
  if (draft.authType === "api-key") {
    draft.authType = "custom-header";
    draft.authHeader = String(draft.authHeader || "api-key").trim() || "api-key";
  }
  if (!draft.headers || typeof draft.headers !== "object" || Array.isArray(draft.headers)) return draft;
  for (const [header, rawValue] of Object.entries(draft.headers)) {
    const lower = header.toLowerCase();
    if (!["authorization", "x-api-key", "api-key"].includes(lower)) continue;
    const value = String(rawValue || "");
    if (!AUTH_PLACEHOLDER.test(value)) {
      throw compatibilityError("PROVIDER_SECRET_IN_HEADERS", `DORN no guardó ${header} dentro del JSON. Escribe la credencial sólo en “Clave API”.`);
    }
    if (lower === "authorization" && /^\s*bearer\s+/i.test(value)) {
      draft.authType = "bearer";
      draft.authHeader = "Authorization";
    } else if (lower === "x-api-key") {
      draft.authType = "x-api-key";
      draft.authHeader = header;
    } else {
      draft.authType = "custom-header";
      draft.authHeader = header;
    }
    delete draft.headers[header];
  }
  if (draft.authType === "bearer") draft.authHeader = String(draft.authHeader || "Authorization").trim() || "Authorization";
  if (draft.authType === "x-api-key") draft.authHeader = String(draft.authHeader || "x-api-key").trim() || "x-api-key";
  if (draft.authType === "custom-header") draft.authHeader = String(draft.authHeader || "api-key").trim() || "api-key";
  if (Array.isArray(draft.capabilities)) {
    draft.capabilities = [...new Set(draft.capabilities.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))];
  }
  return draft;
}

function quickConnectPolicy(preset) {
  if (!preset || typeof preset !== "object" || !preset.draft) {
    return { ready: false, requiresApiKey: false, reason: "PRESET_INVALID" };
  }
  const draft = preset.draft;
  if (preset.key === "openai-images") return { ready: false, requiresApiKey: true, reason: "SPECIALIZED_IMAGE_FLOW" };
  if (draft.protocol === "generic-json") return { ready: false, requiresApiKey: draft.authType !== "none", reason: "CUSTOM_TEMPLATE_REQUIRED" };
  if (/\b(?:ACCOUNT_ID|PROJECT_ID|YOUR_|EXAMPLE)\b/i.test(`${draft.baseUrl || ""} ${draft.endpoint || ""}`)) {
    return { ready: false, requiresApiKey: draft.authType !== "none", reason: "ACCOUNT_FIELD_REQUIRED" };
  }
  if (!NATIVE_PROTOCOLS.has(draft.protocol)) return { ready: false, requiresApiKey: draft.authType !== "none", reason: "PROTOCOL_NOT_NATIVE" };
  return { ready: true, requiresApiKey: draft.authType !== "none", reason: null };
}

function validateProviderPreset(preset) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) throw compatibilityError("PROVIDER_PRESET_INVALID", "El preset no es un objeto válido.");
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(String(preset.key || ""))) throw compatibilityError("PROVIDER_PRESET_KEY_INVALID", "El preset no tiene una clave estable.");
  if (!String(preset.name || "").trim()) throw compatibilityError("PROVIDER_PRESET_NAME_INVALID", `El preset ${preset.key} no tiene nombre.`);
  const draft = normalizeProviderDraft(preset.draft);
  const protocolRules = {
    "openai-responses": "/responses",
    "openai-chat": "/chat/completions",
    "anthropic-messages": "/v1/messages",
    "ollama-chat": "/api/chat"
  };
  if (protocolRules[draft.protocol] && preset.key !== "openai-images" && draft.endpoint !== protocolRules[draft.protocol]) {
    throw compatibilityError("PROVIDER_PRESET_ENDPOINT_INVALID", `${preset.name} no usa la ruta canónica ${protocolRules[draft.protocol]}.`);
  }
  if (draft.protocol === "anthropic-messages" && !String(draft.headers?.["anthropic-version"] || "").trim()) {
    throw compatibilityError("PROVIDER_PRESET_HEADER_MISSING", `${preset.name} no declara anthropic-version.`);
  }
  if (draft.protocol === "generic-json" && (!Object.keys(draft.requestTemplate || {}).length || !draft.responsePath)) {
    throw compatibilityError("PROVIDER_PRESET_TEMPLATE_MISSING", `${preset.name} necesita plantilla y ruta de respuesta.`);
  }
  if (!draft.local && draft.baseUrl && !String(draft.baseUrl).startsWith("https://")) {
    throw compatibilityError("PROVIDER_PRESET_TRANSPORT_UNSAFE", `${preset.name} debe usar HTTPS.`);
  }
  if (draft.authType !== "none" && !String(draft.authHeader || "").trim()) {
    throw compatibilityError("PROVIDER_PRESET_AUTH_INVALID", `${preset.name} no define su cabecera de autenticación.`);
  }
  return { key: preset.key, name: preset.name, draft, policy: quickConnectPolicy(preset) };
}

function selectPresetModel(models, preferredModel, allowedPrefixes = []) {
  const entries = (Array.isArray(models) ? models : []).filter((entry) => entry && String(entry.id || "").trim());
  const prefixes = (Array.isArray(allowedPrefixes) ? allowedPrefixes : [])
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
  const eligible = prefixes.length
    ? entries.filter((entry) => prefixes.some((prefix) => String(entry.id).toLowerCase().startsWith(prefix)))
    : entries;
  if (!eligible.length) return null;
  const preferred = String(preferredModel || "").trim().toLowerCase();
  const exact = eligible.find((entry) => String(entry.id).toLowerCase() === preferred);
  if (exact) return String(exact.id);
  const nonSpecialized = eligible.find((entry) => !/(embed|moderation|rerank|speech|audio|image|vision-only|transcri|whisper)/i.test(String(entry.id)));
  return String((nonSpecialized || eligible[0]).id);
}

module.exports = {
  getResponsePath,
  normalizeProviderDraft,
  quickConnectPolicy,
  renderProviderTemplate,
  responsePathSegments,
  selectPresetModel,
  validateProviderPreset,
  validateTemplate
};
