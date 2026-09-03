"use strict";

const path = require("node:path");
const {
  DornSuiteError,
  atomicJson,
  readJson,
  similarity,
  now
} = require("./common");

const PROVIDER_GUIDES = [
  {
    id: "openai",
    aliases: ["openai", "chatgpt", "gpt"],
    name: "OpenAI",
    purpose: "Modelos generales, programación, visión y herramientas.",
    officialUrl: "https://platform.openai.com/api-keys",
    privacyUrl: "https://openai.com/policies/api-data-usage-policies/",
    quickFields: { baseUrl: "https://api.openai.com/v1", endpoint: "/responses", authType: "bearer" },
    steps: ["Crea o abre tu cuenta de plataforma.", "Abre la sección de claves API.", "Crea una clave nueva.", "Pégala en DORN y prueba la conexión."],
    notes: ["La facturación de API es independiente de una suscripción de ChatGPT.", "DORN conserva la clave en el almacén seguro del sistema."]
  },
  {
    id: "gemini",
    aliases: ["gemini", "google ai", "google"],
    name: "Google Gemini",
    purpose: "Modelos multimodales de Google con texto, visión y herramientas.",
    officialUrl: "https://aistudio.google.com/app/apikey",
    privacyUrl: "https://ai.google.dev/gemini-api/terms",
    quickFields: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre Google AI Studio.", "Inicia sesión y crea una clave API.", "Copia la clave sin espacios al inicio o al final.", "Pégala en DORN y consulta los modelos disponibles."],
    notes: ["La disponibilidad y los límites dependen de la región y la cuenta."]
  },
  {
    id: "anthropic",
    aliases: ["anthropic", "claude"],
    name: "Anthropic",
    purpose: "Modelos Claude para razonamiento, redacción y programación.",
    officialUrl: "https://console.anthropic.com/settings/keys",
    privacyUrl: "https://www.anthropic.com/legal/privacy",
    quickFields: { baseUrl: "https://api.anthropic.com/v1", endpoint: "/messages", authType: "x-api-key" },
    steps: ["Abre Anthropic Console.", "Crea una clave en API Keys.", "Pega la clave en DORN.", "Selecciona un modelo disponible y prueba."],
    notes: ["Anthropic usa un protocolo propio; DORN adapta mensajes y streaming."]
  },
  {
    id: "groq",
    aliases: ["groq"],
    name: "Groq",
    purpose: "Inferencia rápida de modelos compatibles.",
    officialUrl: "https://console.groq.com/keys",
    privacyUrl: "https://groq.com/privacy-policy/",
    quickFields: { baseUrl: "https://api.groq.com/openai/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre GroqCloud Console.", "Crea una clave API.", "Pégala en DORN.", "Carga la lista de modelos y prueba el elegido."],
    notes: ["Los modelos y límites gratuitos pueden cambiar."]
  },
  {
    id: "openrouter",
    aliases: ["openrouter"],
    name: "OpenRouter",
    purpose: "Acceso unificado a modelos de distintos proveedores.",
    officialUrl: "https://openrouter.ai/settings/keys",
    privacyUrl: "https://openrouter.ai/privacy",
    quickFields: { baseUrl: "https://openrouter.ai/api/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Crea una cuenta en OpenRouter.", "Genera una clave.", "Pégala en DORN.", "Elige un identificador de modelo y revisa su política de datos."],
    notes: ["Cada modelo puede tener precio, límites y proveedor de ejecución distintos."]
  },
  {
    id: "mistral",
    aliases: ["mistral"],
    name: "Mistral AI",
    purpose: "Modelos generales y de programación de Mistral.",
    officialUrl: "https://console.mistral.ai/api-keys",
    privacyUrl: "https://mistral.ai/terms/#privacy-policy",
    quickFields: { baseUrl: "https://api.mistral.ai/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre La Plateforme.", "Crea una clave API.", "Pégala en DORN.", "Consulta modelos y prueba la conexión."],
    notes: []
  },
  {
    id: "cohere",
    aliases: ["cohere", "command"],
    name: "Cohere",
    purpose: "Modelos empresariales, recuperación y generación.",
    officialUrl: "https://dashboard.cohere.com/api-keys",
    privacyUrl: "https://cohere.com/privacy",
    quickFields: { baseUrl: "https://api.cohere.ai/compatibility/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre Cohere Dashboard.", "Crea una clave API.", "Pégala en DORN.", "Selecciona un modelo habilitado en tu cuenta."],
    notes: ["DORN utiliza la interfaz de compatibilidad cuando corresponde."]
  },
  {
    id: "deepseek",
    aliases: ["deepseek"],
    name: "DeepSeek",
    purpose: "Modelos generales y orientados a razonamiento.",
    officialUrl: "https://platform.deepseek.com/api_keys",
    privacyUrl: "https://www.deepseek.com/en/privacy-policy/",
    quickFields: { baseUrl: "https://api.deepseek.com", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre DeepSeek Platform.", "Crea una clave.", "Pégala en DORN.", "Prueba el modelo disponible para tu cuenta."],
    notes: ["Revisa la política de datos aplicable antes de enviar archivos sensibles."]
  },
  {
    id: "xai",
    aliases: ["xai", "x.ai", "grok"],
    name: "xAI",
    purpose: "Modelos Grok para texto, herramientas y otras capacidades según modelo.",
    officialUrl: "https://console.x.ai/",
    privacyUrl: "https://x.ai/legal/privacy-policy",
    quickFields: { baseUrl: "https://api.x.ai/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre xAI Console.", "Crea una clave API.", "Pégala en DORN.", "Carga los modelos habilitados y prueba."],
    notes: []
  },
  {
    id: "huggingface",
    aliases: ["hugging face", "huggingface", "hf"],
    name: "Hugging Face",
    purpose: "Modelos alojados a través de proveedores de inferencia.",
    officialUrl: "https://huggingface.co/settings/tokens",
    privacyUrl: "https://huggingface.co/privacy",
    quickFields: { baseUrl: "https://router.huggingface.co/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Crea un token de acceso con el alcance mínimo necesario.", "Pégalo en DORN.", "Escribe el identificador exacto del modelo.", "Prueba y revisa el proveedor de inferencia elegido."],
    notes: ["No todos los modelos admiten chat o herramientas."]
  },
  {
    id: "together",
    aliases: ["together", "together ai"],
    name: "Together AI",
    purpose: "Catálogo de modelos abiertos, visión, herramientas y generación mediante una interfaz compatible con OpenAI.",
    officialUrl: "https://api.together.ai/settings/api-keys",
    privacyUrl: "https://www.together.ai/privacy",
    quickFields: { baseUrl: "https://api.together.ai/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre la configuración oficial de Together AI.", "Crea una clave API.", "Pégala en DORN; la dirección y el protocolo ya estarán completos.", "Carga los modelos de tu cuenta, elige uno y prueba la conexión."],
    notes: ["Los identificadores de modelo incluyen el proveedor y pueden cambiar con el catálogo."]
  },
  {
    id: "fireworks",
    aliases: ["fireworks", "fireworks ai"],
    name: "Fireworks AI",
    purpose: "Inferencia de modelos abiertos mediante Chat Completions compatible con OpenAI.",
    officialUrl: "https://app.fireworks.ai/settings/users/api-keys",
    privacyUrl: "https://fireworks.ai/privacy-policy",
    quickFields: { baseUrl: "https://api.fireworks.ai/inference/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre Fireworks y crea una clave.", "Pégala en DORN.", "Carga los modelos realmente disponibles para tu cuenta.", "Selecciona uno y prueba la conexión antes de guardarla para trabajo automático."],
    notes: ["Los modelos suelen utilizar identificadores completos como accounts/fireworks/models/…"]
  },
  {
    id: "cerebras",
    aliases: ["cerebras", "cerebras inference"],
    name: "Cerebras Inference",
    purpose: "Inferencia acelerada compatible con clientes OpenAI.",
    officialUrl: "https://cloud.cerebras.ai/",
    privacyUrl: "https://www.cerebras.ai/privacy-policy",
    quickFields: { baseUrl: "https://api.cerebras.ai/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre Cerebras Cloud y genera una clave.", "Pégala en DORN.", "Carga la lista de modelos de tu cuenta.", "Prueba el modelo seleccionado."],
    notes: ["DORN no supone que una cuota promocional sea permanente."]
  },
  {
    id: "perplexity",
    aliases: ["perplexity", "sonar"],
    name: "Perplexity API",
    purpose: "Modelos Sonar y búsqueda fundamentada mediante compatibilidad Chat Completions.",
    officialUrl: "https://www.perplexity.ai/settings/api",
    privacyUrl: "https://www.perplexity.ai/hub/legal/privacy-policy",
    quickFields: { baseUrl: "https://api.perplexity.ai", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre la configuración de API de Perplexity.", "Crea y copia una clave.", "Pégala en DORN.", "Carga los modelos, selecciona el disponible y prueba."],
    notes: ["El acceso a búsqueda, fuentes y modelos depende de la API y plan vigentes."]
  },
  {
    id: "nvidia-nim",
    aliases: ["nvidia", "nvidia nim", "nim"],
    name: "NVIDIA NIM",
    purpose: "Modelos ofrecidos por NVIDIA mediante una interfaz compatible con OpenAI.",
    officialUrl: "https://build.nvidia.com/",
    privacyUrl: "https://www.nvidia.com/en-us/about-nvidia/privacy-policy/",
    quickFields: { baseUrl: "https://integrate.api.nvidia.com/v1", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre NVIDIA Build y elige un modelo.", "Genera una clave con los permisos necesarios.", "Pégala en DORN.", "Carga los modelos disponibles, selecciona uno y prueba."],
    notes: ["Los NIM descargables pueden requerir hardware, contenedores y licencias adicionales."]
  },
  {
    id: "zai",
    aliases: ["z.ai", "zai", "zhipu", "glm"],
    name: "Z.AI · GLM",
    purpose: "Modelos GLM para razonamiento, programación y capacidades multimodales.",
    officialUrl: "https://z.ai/manage-apikey/apikey-list",
    privacyUrl: "https://z.ai/legal/privacy-policy",
    quickFields: { baseUrl: "https://api.z.ai/api/paas/v4", endpoint: "/chat/completions", authType: "bearer" },
    steps: ["Abre la plataforma Z.AI.", "Crea una clave API.", "Pégala en DORN.", "Carga los modelos habilitados y prueba el elegido."],
    notes: ["El endpoint del plan de programación puede diferir del endpoint general."]
  },
  {
    id: "ollama",
    aliases: ["ollama", "local"],
    name: "Ollama",
    purpose: "Ejecución local de modelos sin enviar conversaciones a una API externa.",
    officialUrl: "https://ollama.com/download",
    privacyUrl: "https://ollama.com/privacy",
    quickFields: { baseUrl: "http://127.0.0.1:11434", endpoint: "/api/chat", authType: "none" },
    steps: ["Instala Ollama desde su sitio oficial.", "Descarga un modelo compatible.", "Verifica que el servicio local esté activo.", "En DORN, carga la lista local y prueba."],
    notes: ["El consumo de RAM y almacenamiento depende del modelo.", "La conversación permanece local salvo que otra herramienta externa sea autorizada."]
  },
  {
    id: "lmstudio",
    aliases: ["lm studio", "lmstudio"],
    name: "LM Studio",
    purpose: "Servidor local compatible con OpenAI para modelos descargados por el usuario.",
    officialUrl: "https://lmstudio.ai/download",
    privacyUrl: "https://lmstudio.ai/privacy",
    quickFields: { baseUrl: "http://127.0.0.1:1234/v1", endpoint: "/chat/completions", authType: "none" },
    steps: ["Instala LM Studio desde su sitio oficial.", "Descarga un modelo compatible con tu equipo.", "Inicia el servidor local desde Developer.", "En DORN crea una conexión compatible con OpenAI, carga los modelos y prueba."],
    notes: ["El servidor debe estar iniciado para usar el modelo.", "DORN no administra ni actualiza los archivos descargados por LM Studio."]
  }
];

const HELP_TOPICS = [
  {
    id: "primeros-pasos",
    title: "Primeros pasos",
    keywords: "comenzar iniciar configurar dorn carpeta proyecto",
    body: "Conecta una carpeta, describe el resultado que buscas y revisa la recomendación de motor. DORN no escribirá ni ejecutará nada sin mostrar una vista previa cuando el proyecto requiere aprobación."
  },
  {
    id: "proveedores",
    title: "Configurar APIs",
    keywords: "api proveedor clave endpoint 401 403 429 modelo",
    body: "Abre Configuración → Modelos y APIs. Puedes usar un proveedor preconfigurado o una conexión compatible con OpenAI. La clave se conserva mediante el sistema seguro local y no se incluye en exportaciones."
  },
  {
    id: "ia-local",
    title: "IA local",
    keywords: "local offline ram qwen modelo descargar privacidad",
    body: "DORN Local elige un nivel según la memoria disponible. Los modelos se descargan de su origen, se verifican y se ejecutan mediante el motor local configurado. Usa el modo privado para bloquear proveedores externos."
  },
  {
    id: "proyectos-permisos",
    title: "Proyectos y permisos",
    keywords: "proyecto carpeta permiso operador control total aprobar cambios",
    body: "Una carpeta conectada define el límite de trabajo. El modo Operador permite preparar cambios, pero exige aprobación. Control total mantiene los bloqueos de comandos destructivos y nunca concede privilegios permanentes de administrador."
  },
  {
    id: "plugins",
    title: "Plugins",
    keywords: "plugin extensión instalar permiso sandbox worker firma hash",
    body: "DORN inspecciona el manifiesto, muestra permisos y deja el plugin desactivado al instalarlo. Los comandos se ejecutan en un worker aislado sin acceso directo a process ni require."
  },
  {
    id: "studio-3d",
    title: "Studio 3D y conectores",
    keywords: "3d obj stl gltf glb cinema 4d cad step puente bridge",
    body: "El inspector integrado analiza OBJ, STL, PLY, glTF y GLB. Formatos o aplicaciones adicionales se incorporan mediante adaptadores DORN Bridge autorizados. El adaptador trabaja con copias aisladas y devuelve artefactos verificados."
  },
  {
    id: "instaladores",
    title: "DORN Installer",
    keywords: "instalador paquete multipartes reparar desinstalar actualización",
    body: "Crea dorn-installer.json desde el chat. El motor empaqueta con SHA-256 por archivo, instala mediante transacciones reversibles, conserva archivos modificados al desinstalar y puede dividir o reconstruir distribuciones."
  },
  {
    id: "seguridad",
    title: "Seguridad y datos",
    keywords: "seguridad secreto clave token cifrado sincronizar privacidad",
    body: "DORN no sincroniza claves, tokens, cookies ni credenciales en texto plano. La memoria rechaza secretos detectables y el modo privado bloquea proveedores externos."
  },
  {
    id: "recuperacion",
    title: "Recuperación",
    keywords: "restaurar deshacer recuperar checkpoint error archivo",
    body: "Antes de modificar archivos, DORN conserva el estado anterior. Puedes abrir los puntos de recuperación del proyecto o restaurar una operación concreta desde el historial."
  },
  {
    id: "diagnostico",
    title: "DORN Doctor",
    keywords: "doctor diagnóstico error ram almacenamiento servicio dependencia",
    body: "Escribe /doctor para revisar sistema, memoria, almacenamiento, motores, proveedores y herramientas instaladas. El informe no modifica el equipo."
  }
];

function guideFor(query) {
  const normalized = String(query || "").toLowerCase();
  return PROVIDER_GUIDES.find((guide) => guide.aliases.some((alias) => normalized.includes(alias))) || null;
}

function diagnoseProviderError(value) {
  const text = String(value || "");
  if (/\b401\b|unauthorized|invalid api key/i.test(text)) {
    return { code: "AUTHENTICATION", explanation: "La clave fue rechazada.", actions: ["Comprueba espacios al inicio o final.", "Confirma que la clave siga activa.", "Verifica que corresponda al proveedor elegido."] };
  }
  if (/\b403\b|forbidden/i.test(text)) {
    return { code: "AUTHORIZATION", explanation: "La cuenta no tiene permiso para esa operación o modelo.", actions: ["Revisa permisos y región.", "Elige un modelo habilitado.", "Comprueba el estado de facturación si corresponde."] };
  }
  if (/\b404\b|model.+not found/i.test(text)) {
    return { code: "MODEL_NOT_FOUND", explanation: "El endpoint o modelo no existe para esa cuenta.", actions: ["Carga nuevamente la lista de modelos.", "Copia el identificador exacto.", "Comprueba Base URL y ruta."] };
  }
  if (/\b429\b|rate limit|quota/i.test(text)) {
    return { code: "RATE_LIMIT", explanation: "Se alcanzó un límite temporal o de cuota.", actions: ["Espera y reintenta.", "Reduce solicitudes paralelas.", "Comprueba la cuota de la cuenta."] };
  }
  if (/timeout|timed out|econnreset|enotfound/i.test(text)) {
    return { code: "NETWORK", explanation: "No fue posible completar la conexión.", actions: ["Comprueba internet y la URL.", "Revisa proxy o firewall.", "Aumenta el tiempo máximo solo si el servidor responde lentamente."] };
  }
  return { code: "UNKNOWN", explanation: "El mensaje no coincide con un problema conocido.", actions: ["Copia el diagnóstico.", "Ejecuta /doctor.", "Revisa la guía del proveedor."] };
}

class HelpCenter {
  topics() {
    return HELP_TOPICS.map(({ body, ...topic }) => topic);
  }

  search(query, limit = 5) {
    const value = String(query || "").trim();
    return HELP_TOPICS
      .map((topic) => ({ ...topic, score: similarity(value, `${topic.title} ${topic.keywords} ${topic.body}`) }))
      .filter((topic) => topic.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(Number(limit) || 5, 10)));
  }

  providerGuide(query) {
    return guideFor(query);
  }

  diagnoseProviderError(value) {
    return diagnoseProviderError(value);
  }
}

function inferModelProfile(providerId, modelName) {
  const name = String(modelName || "").toLowerCase();
  const local = /ollama|dorn-local|local/.test(String(providerId || ""));
  const programming = /coder|code|dev|starcoder|codestral/.test(name);
  const reasoning = /reason|deepseek-r|o\d|thinking/.test(name);
  const vision = /vision|vl|multimodal|gpt-4o|gemini|claude/.test(name);
  const audio = /audio|whisper|speech|tts/.test(name);
  const embedding = /embed|embedding/.test(name);
  return {
    providerId: String(providerId || ""),
    model: String(modelName || ""),
    specialty: embedding ? "embeddings" : audio ? "audio" : programming ? "programación" : reasoning ? "razonamiento" : vision ? "multimodal" : "general",
    capabilities: {
      text: !embedding,
      programming,
      reasoning,
      vision,
      audio,
      embeddings: embedding,
      tools: !embedding && !audio
    },
    contextTokens: null,
    recommendedRamGb: local ? null : 0,
    speed: "desconocida",
    privacy: local ? "local" : "proveedor externo",
    source: "inferred",
    updatedAt: now()
  };
}

class ModelProfileManager {
  constructor(stateRoot) {
    this.filePath = path.join(stateRoot, "model-profiles.json");
    this.state = readJson(this.filePath, { profiles: [] });
  }

  list() {
    return this.state.profiles.map((profile) => structuredClone(profile));
  }

  get(providerId, modelName) {
    const existing = this.state.profiles.find((profile) => profile.providerId === providerId && profile.model === modelName);
    return existing ? structuredClone(existing) : inferModelProfile(providerId, modelName);
  }

  save(providerId, modelName, patch = {}) {
    if (!providerId || !modelName) throw new DornSuiteError("DORN-MODEL-001", "models", "Falta identificar proveedor y modelo.");
    const base = this.get(String(providerId), String(modelName));
    const profile = {
      ...base,
      ...patch,
      providerId: String(providerId),
      model: String(modelName),
      capabilities: { ...base.capabilities, ...(patch.capabilities || {}) },
      source: "user",
      updatedAt: now()
    };
    const index = this.state.profiles.findIndex((entry) => entry.providerId === profile.providerId && entry.model === profile.model);
    if (index >= 0) this.state.profiles[index] = profile;
    else this.state.profiles.push(profile);
    atomicJson(this.filePath, this.state);
    return structuredClone(profile);
  }
}

module.exports = {
  PROVIDER_GUIDES,
  HELP_TOPICS,
  HelpCenter,
  ModelProfileManager,
  inferModelProfile,
  diagnoseProviderError
};
