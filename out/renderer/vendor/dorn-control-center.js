(() => {
  let productPromptBound = false;
  let approvalPromptBound = false;
  let queuedProductPrompt = null;
  const appearanceApi = window.dornAppearance;
  const PALETTES = appearanceApi.PALETTES;
  const THEMES = [
    ["graphite", "DORN Graphite", "Negro técnico y aluminio"],
    ["titanium", "Titanium", "Gris claro industrial"],
    ["midnight", "Midnight Blue", "Azul profundo y sobrio"],
    ["amber", "Industrial Amber", "Contraste cálido de taller"],
    ["emerald", "Emerald", "Verde técnico y calmado"],
    ["violet", "Violet Circuit", "Violeta creativo y digital"],
    ["crimson", "Crimson Forge", "Rojo técnico de alto impacto"],
    ["arctic", "Arctic Glass", "Celeste frío de alta claridad"],
    ["cobalt", "Cobalt Drive", "Azul eléctrico profesional"],
    ["ocean", "Deep Ocean", "Azul oceánico equilibrado"],
    ["cyan", "Cyan Pulse", "Cian digital de precisión"],
    ["teal", "Teal Workshop", "Turquesa técnico sereno"],
    ["forest", "Forest Lab", "Verde natural de concentración"],
    ["lime", "Lime Signal", "Verde lima de señalización"],
    ["copper", "Copper Works", "Cobre cálido de fabricación"],
    ["bronze", "Bronze Foundry", "Bronce sobrio industrial"],
    ["rose", "Rose Interface", "Rosa moderno y elegante"],
    ["magenta", "Magenta Studio", "Magenta creativo para diseño"],
    ["indigo", "Indigo System", "Índigo profundo tecnológico"],
    ["sand", "Sandstone", "Arena cálida y discreta"]
  ];
  const DEFAULT_APPEARANCE = appearanceApi.DEFAULT_APPEARANCE;
  const MODE_COPY = {
    automatic: ["Automático", "DORN analiza la tarea, elige el motor disponible y comienza."],
    manual: ["Manual", "DORN recomienda y tú confirmas o cambias el motor."],
    economic: ["Económico", "Prioriza límites bajos, modelos locales y menor consumo."],
    private: ["Privado", "Bloquea proveedores externos y mantiene el trabajo local."],
    performance: ["Rendimiento", "Permite más agentes, herramientas y tiempo."],
    battery: ["Batería", "Reduce concurrencia y libera motores cuando corresponde."]
  };
  const AI_CONNECTORS = [
    { id: "openai", name: "OpenAI", kind: "API", task: "texto razonamiento programación herramientas imágenes", copy: "Modelos habilitados en tu cuenta mediante Responses o Chat Completions." },
    { id: "gemini", name: "Google Gemini", kind: "API", task: "texto visión programación documentos", copy: "Conexión oficial de Google AI Studio; la disponibilidad depende de cuenta y región." },
    { id: "claude", name: "Anthropic Claude", kind: "API", task: "texto análisis programación documentos", copy: "Mensajes de Anthropic con modelos cargados desde la cuenta configurada." },
    { id: "grok", name: "xAI Grok", kind: "API", task: "texto razonamiento programación herramientas", copy: "Conector de xAI con clave propia y modelos disponibles para la cuenta." },
    { id: "deepseek", name: "DeepSeek", kind: "API", task: "razonamiento programación texto", copy: "API externa para chat y razonamiento según la oferta vigente del proveedor." },
    { id: "mistral", name: "Mistral AI", kind: "API", task: "texto programación documentos razonamiento", copy: "Modelos de Mistral mediante la clave y los permisos de la cuenta." },
    { id: "cohere", name: "Cohere", kind: "API", task: "texto documentos búsqueda clasificación", copy: "Conector para modelos y capacidades disponibles en Cohere." },
    { id: "groq", name: "Groq", kind: "API", task: "velocidad texto programación razonamiento", copy: "Inferencia rápida de modelos compatibles; límites y catálogo pueden cambiar." },
    { id: "openrouter", name: "OpenRouter", kind: "Router API", task: "muchos modelos comparación texto programación", copy: "Unifica múltiples proveedores; cada modelo conserva precio y política propios." },
    { id: "alibaba-model-studio", name: "Alibaba Cloud Model Studio · Qwen", kind: "API / catálogo", task: "qwen texto visión audio video programación razonamiento", copy: "Catálogo Qwen y modelos asociados mediante endpoints regionales y compatibilidad OpenAI." },
    { id: "azure-openai", name: "Microsoft Azure OpenAI", kind: "API empresarial", task: "texto visión audio herramientas empresa seguridad", copy: "Despliegues administrados en Azure; requiere recurso, región, deployment y credenciales propios." },
    { id: "vertex-ai", name: "Google Vertex AI", kind: "API empresarial", task: "gemini modelos empresa datos visión programación", copy: "Plataforma de Google Cloud para Gemini y otros modelos con proyecto y región configurados." },
    { id: "bedrock", name: "Amazon Bedrock", kind: "Router empresarial", task: "muchos modelos agentes empresa aws conocimiento", copy: "Acceso administrado a familias de modelos habilitadas en la cuenta y región de AWS." },
    { id: "together", name: "Together AI", kind: "API / catálogo", task: "modelos abiertos texto visión programación inferencia", copy: "Inferencia y catálogo de modelos abiertos; disponibilidad y límites dependen de la cuenta." },
    { id: "fireworks", name: "Fireworks AI", kind: "API / catálogo", task: "modelos abiertos velocidad texto visión programación", copy: "Inferencia de modelos abiertos con interfaces compatibles y catálogo cambiante." },
    { id: "cerebras", name: "Cerebras Inference", kind: "API", task: "velocidad texto programación razonamiento modelos abiertos", copy: "Inferencia acelerada mediante API con autenticación Bearer y modelos disponibles en la cuenta." },
    { id: "nvidia-nim", name: "NVIDIA NIM", kind: "API / servidor", task: "empresa local nube modelos nvidia texto visión", copy: "Microservicios de inferencia NVIDIA desplegables según licencia e infraestructura." },
    { id: "perplexity", name: "Perplexity API", kind: "API", task: "búsqueda investigación web texto fuentes", copy: "Modelos y búsqueda con citas según la oferta y permisos vigentes del proveedor." },
    { id: "replicate", name: "Replicate", kind: "API / catálogo", task: "imagen video audio texto modelos comunidad", copy: "Ejecución de modelos publicados en Replicate; cada versión define entradas, costo y licencia." },
    { id: "cloudflare-workers-ai", name: "Cloudflare Workers AI", kind: "API / catálogo", task: "serverless modelos abiertos texto imagen embeddings", copy: "Modelos alojados en la red de Cloudflare mediante cuenta, token y catálogo oficial." },
    { id: "ibm-watsonx", name: "IBM watsonx.ai", kind: "API empresarial", task: "empresa gobierno datos texto modelos", copy: "Plataforma empresarial con proyectos, regiones, modelos y controles de gobierno propios." },
    { id: "ai21", name: "AI21", kind: "API", task: "texto documentos empresa razonamiento", copy: "Modelos y servicios de lenguaje de AI21 mediante cuenta y API key." },
    { id: "moonshot", name: "Moonshot AI · Kimi", kind: "API", task: "texto contexto largo visión programación agentes", aliases: "kimi k1.5 k2 k2.5 k2.6 k2.7 k3 kimi code moonshot", copy: "Modelos Kimi mediante plataforma y región disponibles; los identificadores cambian con el catálogo." },
    { id: "zhipu", name: "Zhipu AI · GLM", kind: "API", task: "texto razonamiento agentes programación visión", copy: "Familia GLM mediante API propia o plataformas compatibles, según región y cuenta." },
    { id: "minimax", name: "MiniMax", kind: "API", task: "texto razonamiento voz video agentes", copy: "Servicios multimodales de MiniMax; requiere revisar región, modelo y licencia antes de conectar." },
    { id: "sambanova", name: "SambaNova Cloud", kind: "API", task: "texto velocidad razonamiento programación modelos abiertos", copy: "API compatible con OpenAI para modelos disponibles en SambaNova Cloud." },
    { id: "deepinfra", name: "DeepInfra", kind: "API / catálogo", task: "texto razonamiento programación modelos abiertos inferencia", copy: "Catálogo de inferencia con endpoint compatible con OpenAI y clave propia." },
    { id: "nebius", name: "Nebius Token Factory", kind: "API / catálogo", task: "texto razonamiento programación visión modelos abiertos", copy: "Modelos alojados en Token Factory mediante una interfaz compatible con OpenAI." },
    { id: "aimlapi", name: "AI/ML API", kind: "Router API", task: "muchos modelos texto imagen audio video programación", copy: "Router de modelos con SDK y formato compatible con OpenAI; disponibilidad según la cuenta." },
    { id: "novita", name: "Novita AI", kind: "API / catálogo", task: "texto programación razonamiento imagen video modelos abiertos", copy: "Inferencia y catálogo con una ruta OpenAI compatible documentada por Novita." },
    { id: "siliconflow", name: "SiliconFlow", kind: "API / catálogo", task: "texto razonamiento programación modelos abiertos embeddings", copy: "Modelos de lenguaje y embeddings mediante API compatible con OpenAI." },
    { id: "litellm", name: "LiteLLM Gateway", kind: "Local / servidor", task: "router local empresa muchas apis openai compatible control costos", copy: "Gateway autohospedado para reunir proveedores, presupuestos y claves detrás de un solo endpoint." },
    { id: "open-webui", name: "Open WebUI Gateway", kind: "Local / servidor", task: "local servidor openai compatible modelos administración", copy: "Conecta un servidor Open WebUI propio cuando su API esté habilitada y configurada." },
    { id: "huggingface", name: "Hugging Face", kind: "API / catálogo", task: "modelos abiertos texto visión clasificación", copy: "Token y proveedor de inferencia para modelos compatibles del Hub." },
    { id: "ollama", name: "Ollama", kind: "Local", task: "local privacidad modelos abiertos programación", copy: "Conecta modelos instalados en Ollama sin enviar el chat a una API pública." },
    { id: "lmstudio", name: "LM Studio", kind: "Local", task: "local privacidad gguf modelos abiertos", copy: "Conecta el servidor local compatible con OpenAI de LM Studio." },
    { id: "vllm", name: "vLLM", kind: "Local / servidor", task: "local servidor gpu modelos abiertos openai compatible", copy: "Servidor de inferencia local o privado compatible con OpenAI; DORN no lo instala automáticamente." },
    { id: "localai", name: "LocalAI", kind: "Local / servidor", task: "local privacidad openai compatible texto imagen audio", copy: "Servidor local compatible con varias capacidades; requiere instalación y modelos administrados por el usuario." },
    { id: "jan", name: "Jan", kind: "Local", task: "local privacidad modelos abiertos escritorio", copy: "Aplicación local con servidor compatible cuando está habilitado por el usuario." },
    { id: "llamacpp", name: "llama.cpp server", kind: "Local / servidor", task: "local gguf cpu gpu privacidad openai compatible", copy: "Servidor local para modelos GGUF; DORN valida la dirección y no descarga modelos desconocidos." }
  ];
  const AI_OFFICIAL_URLS = Object.freeze({
    openai: "https://platform.openai.com/api-keys",
    gemini: "https://ai.google.dev/gemini-api/docs/api-key",
    claude: "https://console.anthropic.com/settings/keys",
    grok: "https://console.x.ai/",
    deepseek: "https://platform.deepseek.com/api_keys",
    mistral: "https://console.mistral.ai/api-keys/",
    cohere: "https://dashboard.cohere.com/api-keys",
    groq: "https://console.groq.com/keys",
    openrouter: "https://openrouter.ai/settings/keys",
    "alibaba-model-studio": "https://www.alibabacloud.com/help/en/model-studio/getting-started/first-api-call-to-qwen",
    "azure-openai": "https://portal.azure.com/",
    "vertex-ai": "https://console.cloud.google.com/vertex-ai",
    bedrock: "https://console.aws.amazon.com/bedrock/",
    together: "https://api.together.ai/settings/api-keys",
    fireworks: "https://app.fireworks.ai/settings/users/api-keys",
    cerebras: "https://cloud.cerebras.ai/",
    "nvidia-nim": "https://build.nvidia.com/",
    perplexity: "https://www.perplexity.ai/settings/api",
    replicate: "https://replicate.com/account/api-tokens",
    "cloudflare-workers-ai": "https://dash.cloudflare.com/",
    "ibm-watsonx": "https://cloud.ibm.com/catalog/services/watsonxai-studio",
    ai21: "https://studio.ai21.com/account/api-key",
    moonshot: "https://platform.moonshot.ai/console/api-keys",
    zhipu: "https://open.bigmodel.cn/usercenter/apikeys",
    minimax: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    sambanova: "https://cloud.sambanova.ai/apis",
    deepinfra: "https://deepinfra.com/dash/api_keys",
    nebius: "https://tokenfactory.nebius.com/",
    aimlapi: "https://aimlapi.com/app/keys",
    novita: "https://novita.ai/settings/key-management",
    siliconflow: "https://cloud.siliconflow.com/account/ak",
    litellm: "https://docs.litellm.ai/docs/providers/litellm_proxy",
    "open-webui": "https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/",
    huggingface: "https://huggingface.co/settings/tokens",
    ollama: "https://ollama.com/download",
    lmstudio: "https://lmstudio.ai/download",
    vllm: "https://docs.vllm.ai/en/latest/getting_started/installation.html",
    localai: "https://localai.io/",
    jan: "https://jan.ai/",
    llamacpp: "https://github.com/ggml-org/llama.cpp"
  });
  const AI_PROVIDER_RESOURCES = Object.freeze({
    openai: [{ label: "Obtener clave", url: "https://platform.openai.com/api-keys" }, { label: "Documentación", url: "https://platform.openai.com/docs/api-reference/introduction" }, { label: "Modelos", url: "https://platform.openai.com/docs/models" }],
    gemini: [{ label: "Obtener clave", url: "https://aistudio.google.com/app/apikey" }, { label: "Documentación", url: "https://ai.google.dev/gemini-api/docs" }, { label: "Modelos", url: "https://ai.google.dev/gemini-api/docs/models" }],
    claude: [{ label: "Obtener clave", url: "https://console.anthropic.com/settings/keys" }, { label: "Documentación", url: "https://docs.anthropic.com/en/api/getting-started" }, { label: "Modelos", url: "https://docs.anthropic.com/en/docs/about-claude/models/overview" }],
    openrouter: [{ label: "Obtener clave", url: "https://openrouter.ai/settings/keys" }, { label: "Documentación", url: "https://openrouter.ai/docs/quickstart" }, { label: "Modelos", url: "https://openrouter.ai/models" }],
    moonshot: [{ label: "Obtener clave", url: "https://platform.moonshot.ai/console/api-keys" }, { label: "Documentación", url: "https://platform.moonshot.ai/docs/guide/migrating-from-openai-to-kimi" }, { label: "Chat API", url: "https://platform.moonshot.ai/docs/api/chat" }],
    "cloudflare-workers-ai": [{ label: "Panel", url: "https://dash.cloudflare.com/" }, { label: "Documentación", url: "https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/" }, { label: "Modelos", url: "https://developers.cloudflare.com/workers-ai/models/" }],
    sambanova: [{ label: "Obtener clave", url: "https://cloud.sambanova.ai/apis" }, { label: "Documentación", url: "https://docs.sambanova.ai/docs/en/get-started/quickstart" }, { label: "Compatibilidad OpenAI", url: "https://docs.sambanova.ai/docs/en/features/openai-compatibility" }],
    deepinfra: [{ label: "Obtener clave", url: "https://deepinfra.com/dash/api_keys" }, { label: "Documentación", url: "https://docs.deepinfra.com/chat/overview" }, { label: "Modelos", url: "https://deepinfra.com/models" }],
    nebius: [{ label: "Obtener clave", url: "https://tokenfactory.nebius.com/" }, { label: "Inicio rápido", url: "https://docs.tokenfactory.nebius.com/quickstart" }, { label: "Compatibilidad OpenAI", url: "https://docs.tokenfactory.nebius.com/switch" }],
    aimlapi: [{ label: "Obtener clave", url: "https://aimlapi.com/app/keys" }, { label: "Inicio rápido", url: "https://docs.aimlapi.com/quickstart/supported-sdks" }, { label: "Modelos", url: "https://docs.aimlapi.com/api-references/service-endpoints/complete-model-list" }],
    novita: [{ label: "Obtener clave", url: "https://novita.ai/settings/key-management" }, { label: "Guía LLM", url: "https://novita.ai/docs/guides/llm-api" }, { label: "API", url: "https://novita.ai/docs/api-reference/api-reference-overview" }],
    siliconflow: [{ label: "Obtener clave", url: "https://cloud.siliconflow.com/account/ak" }, { label: "Inicio rápido", url: "https://docs.siliconflow.com/en/userguide/quickstart" }, { label: "Modelos", url: "https://cloud.siliconflow.com/models" }],
    litellm: [{ label: "Instalar gateway", url: "https://docs.litellm.ai/docs/proxy/quick_start" }, { label: "Documentación", url: "https://docs.litellm.ai/docs/providers/litellm_proxy" }],
    "open-webui": [{ label: "Conectar proveedor", url: "https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/" }, { label: "Referencia API", url: "https://docs.openwebui.com/reference/api-endpoints/" }]
  });
  const AI_PRESET_KEYS = Object.freeze({
    openai: "openai-responses", gemini: "google-gemini", claude: "anthropic-messages", grok: "xai",
    deepseek: "deepseek", mistral: "mistral", cohere: "cohere", groq: "groq", openrouter: "openrouter",
    together: "together", fireworks: "fireworks", cerebras: "cerebras", "nvidia-nim": "nvidia-nim", "cloudflare-workers-ai": "cloudflare-workers-ai",
    perplexity: "perplexity", moonshot: "moonshot-kimi", zhipu: "zai-glm", huggingface: "hugging-face",
    sambanova: "sambanova", deepinfra: "deepinfra", nebius: "nebius-token-factory", aimlapi: "aimlapi",
    novita: "novita", siliconflow: "siliconflow", litellm: "litellm-gateway", "open-webui": "open-webui-gateway",
    ollama: "ollama", lmstudio: "lm-studio"
  });
  const AI_ENCYCLOPEDIA = Array.isArray(window.DORN_AI_ENCYCLOPEDIA?.entries)
    ? window.DORN_AI_ENCYCLOPEDIA.entries
    : [];
  const AI_ENCYCLOPEDIA_STATS = window.DORN_AI_ENCYCLOPEDIA?.stats || { entries: 0, sections: 0 };
  const AI_BRAND_ASSETS = window.DORN_AI_BRAND_ASSETS?.aliases || {};
  const encyclopediaConnector = (entry) => {
    const identity = normalizeSearch([entry?.name, entry?.company, entry?.family].filter(Boolean).join(" "));
    if (/(?:^|\s)moonshot ai(?:\s|$)/.test(identity) || /(?:^|\s)kimi(?:\s|$)/.test(identity)) {
      return AI_CONNECTORS.find((connector) => connector.id === "moonshot") || null;
    }
    return null;
  };
  const AUTOMATION_TEMPLATES = [
    { id: "inventory", label: "Inventariar archivos del proyecto", shell: "powershell", command: "Get-ChildItem -File -Recurse | Select-Object FullName, Length, LastWriteTime" },
    { id: "large-files", label: "Encontrar los 30 archivos más grandes", shell: "powershell", command: "Get-ChildItem -File -Recurse | Sort-Object Length -Descending | Select-Object -First 30 FullName, Length" },
    { id: "hashes", label: "Calcular hashes SHA-256", shell: "powershell", command: "Get-ChildItem -File -Recurse | Get-FileHash -Algorithm SHA256 | Format-Table -AutoSize" },
    { id: "git-status", label: "Revisar estado de Git", shell: "terminal", command: "git status --short" },
    { id: "git-diff-check", label: "Detectar errores de espacios en Git", shell: "terminal", command: "git diff --check" },
    { id: "npm-test", label: "Ejecutar pruebas npm", shell: "cmd", command: "npm test" },
    { id: "npm-audit", label: "Auditar dependencias npm", shell: "cmd", command: "npm audit --omit=dev" },
    { id: "list-packages", label: "Listar dependencias npm directas", shell: "cmd", command: "npm ls --depth=0" },
    { id: "project-tree", label: "Mostrar estructura del proyecto", shell: "powershell", command: "Get-ChildItem -Recurse | Select-Object FullName" },
    { id: "build-project", label: "Compilar proyecto npm", shell: "cmd", command: "npm run build" },
    { id: "git-history", label: "Revisar historial reciente de Git", shell: "terminal", command: "git log --oneline --decorate -n 20" },
    { id: "open-ports", label: "Revisar puertos en escucha", shell: "powershell", command: "Get-NetTCPConnection -State Listen | Sort-Object LocalPort | Select-Object LocalAddress, LocalPort, OwningProcess" },
    { id: "python-tests", label: "Ejecutar pruebas de Python", shell: "terminal", command: "python -m pytest" },
    { id: "dotnet-tests", label: "Ejecutar pruebas de .NET", shell: "terminal", command: "dotnet test" }
  ];

  const NAV_ICONS = {
    general: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/>',
    router: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7.4 7.5l3.4 8M16.6 7.5l-3.4 8"/>',
    connections: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    catalog: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 13.5v7"/>',
    "prompt-explorer": '<path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-1-1.7V6a2 2 0 0 1 2-2z"/><path d="M8 8h8M8 12h5"/>',
    preferences: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    gamers: '<path d="M8 9h8a5 5 0 0 1 4.7 6.7l-.5 1.5a2.5 2.5 0 0 1-4.1 1l-1.4-1.2H9.3l-1.4 1.2a2.5 2.5 0 0 1-4.1-1l-.5-1.5A5 5 0 0 1 8 9zM8 12v4M6 14h4M16 13h.01M18 15h.01"/>',
    products: '<path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10"/>',
    developer: '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>',
    linux: '<path d="M7 4h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM8 9l3 3-3 3M13 15h3"/>',
    plugins: '<path d="M8.5 3H4a1 1 0 0 0-1 1v4.5a2.5 2.5 0 1 1 0 5V20a1 1 0 0 0 1 1h4.5a2.5 2.5 0 1 1 5 0H20a1 1 0 0 0 1-1v-6.5a2.5 2.5 0 1 1 0-5V4a1 1 0 0 0-1-1h-6.5a2.5 2.5 0 1 1-5 0z"/>',
    colors: '<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a1.5 1.5 0 0 1 0-3h2a7 7 0 0 0-2-11z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="9" cy="6.5" r=".8"/><circle cx="14" cy="6.5" r=".8"/><circle cx="17" cy="10" r=".8"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
  };

  const navButton = (tab, label) => `<button data-tab="${tab}"><svg viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[tab]}</svg><span>${label}</span></button>`;

  const linuxStateLabel = (state) => ({
    READY: "LISTO",
    NOT_INSTALLED: "REQUIERE WSL 2",
    NO_DISTRIBUTIONS: "REQUIERE UBUNTU",
    WSL2_REQUIRED: "REQUIERE WSL 2",
    DEGRADED: "NECESITA REVISIÓN",
    NOT_WINDOWS_HOST: "NO DISPONIBLE"
  }[state] || "SIN COMPROBAR");

  const linuxStateDetail = (state) => ({
    READY: "WSL 2 tiene una distribución compatible. DORN puede inspeccionar sus lenguajes y preparar Work Units aisladas.",
    NOT_INSTALLED: "Ejecuta Installer v3 con DORN Linux seleccionado. Windows puede solicitar permisos y reinicio.",
    NO_DISTRIBUTIONS: "WSL está presente, pero falta una distribución Linux. Installer v3 prepara Ubuntu sin bloquear DORN.",
    WSL2_REQUIRED: "La distribución observada usa WSL 1 y debe convertirse a WSL 2 antes de desarrollar.",
    DEGRADED: "Windows devolvió un estado incompleto. Revisa el registro y vuelve a comprobar.",
    NOT_WINDOWS_HOST: "DORN Linux integrado está diseñado para Windows 11 x64 mediante WSL 2."
  }[state] || "Todavía no existe una observación verificable del entorno Linux.");

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);

  const normalizeHex = appearanceApi.normalizeHex;
  const contrastRatio = appearanceApi.contrastRatio;
  const normalizePalette = appearanceApi.normalizePalette;
  const readAppearance = appearanceApi.read;
  const applyAppearance = appearanceApi.apply;
  const normalizeSearch = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const providerResources = (connectorId) => AI_PROVIDER_RESOURCES[connectorId] || (AI_OFFICIAL_URLS[connectorId]
    ? [{ label: "Web oficial", url: AI_OFFICIAL_URLS[connectorId] }]
    : []);
  const renderProviderLinks = (connectorId, limit = Infinity) => providerResources(connectorId).slice(0, limit).map((resource) =>
    `<a class="dorn-cc-secondary dorn-link-button" href="${escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(resource.label)}</a>`
  ).join("");
  const aiAvatar = (name, seed, type, brandHint = "") => {
    const words = String(name || "IA").trim().split(/\s+/).filter(Boolean);
    const initials = (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "IA").toUpperCase();
    const hue = [...String(seed || name)].reduce((total, character) => (total * 31 + character.charCodeAt(0)) % 360, 0);
    const candidates = [brandHint, name].map(normalizeSearch).filter(Boolean);
    const asset = Object.entries(AI_BRAND_ASSETS).find(([alias]) => candidates.some((candidate) => candidate === alias || candidate.includes(alias)))?.[1] || "";
    const visual = asset ? `<img src="${escapeHtml(asset)}" alt="">` : `<b>${escapeHtml(initials)}</b>`;
    return `<span class="dorn-ai-avatar ${asset ? "official-asset" : ""}" style="--dorn-avatar-hue:${hue}" role="img" aria-label="Identidad visual de ${escapeHtml(name)}">${visual}<small>${escapeHtml(type)}</small></span>`;
  };

  function openModels() {
    window.dornControlCenter?.open("connections");
  }

  let voiceListening = false;
  let voiceHandsFree = false;
  let voiceEventsBound = false;
  let voiceChatBound = false;
  let voicePreferences = null;
  function setVoiceState(state, detail = "") {
    voiceListening = state === "listening";
    document.querySelectorAll("[data-dorn-dictation]").forEach((button) => {
      button.classList.toggle("listening", voiceListening);
      button.classList.toggle("error", state === "error");
      button.title = detail || (voiceListening ? "Detener dictado" : "Dictar mensaje con el micrófono de Windows");
      button.setAttribute("aria-label", button.title);
    });
    const caption = document.querySelector("[data-dorn-dictation-status]");
    if (caption) {
      caption.textContent = detail;
      caption.hidden = !detail;
    }
  }

  function appendDictatedText(text) {
    const textarea = document.querySelector(".composer-box textarea");
    if (!textarea || textarea.disabled || !String(text || "").trim()) return;
    const addition = String(text).trim();
    const nextValue = `${textarea.value}${textarea.value && !/\s$/.test(textarea.value) ? " " : ""}${addition}`;
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    descriptor?.set?.call(textarea, nextValue);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  }

  function syncVoiceDictation() {
    const actions = document.querySelector(".composer-box .composer-actions");
    if (!actions || actions.querySelector("[data-dorn-dictation]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.dornDictation = "true";
    button.className = "dorn-dictation-button";
    button.title = "Dictar mensaje con el micrófono de Windows";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"></path></svg>';
    button.onclick = async () => {
      button.disabled = true;
      try {
        if (voiceListening) {
          voiceHandsFree = false;
          await window.dorn.v3.suite.voice.stopRecognition();
          setVoiceState("idle", "Dictado detenido.");
        } else {
          setVoiceState("starting", "Preparando el micrófono local…");
          await window.dorn.v3.suite.voice.startRecognition("es-CL");
        }
      } catch (error) {
        setVoiceState("error", error.message || String(error));
      } finally {
        button.disabled = false;
      }
    };
    actions.appendChild(button);
    const audioButton = document.createElement("button");
    audioButton.type = "button";
    audioButton.dataset.dornAudioTranscription = "true";
    audioButton.className = "dorn-dictation-button";
    audioButton.title = "Transcribir un archivo WAV al mensaje";
    audioButton.setAttribute("aria-label", audioButton.title);
    audioButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h2M8 8v8M12 4v16M16 7v10M20 10v4"></path></svg>';
    audioButton.onclick = async () => {
      audioButton.disabled = true;
      setVoiceState("transcribing", "Selecciona un WAV; Windows lo convertirá a texto localmente…");
      try {
        const result = await window.dorn.v3.suite.voice.transcribeAudio("es-CL");
        if (result && !result.canceled) {
          appendDictatedText(result.text || "");
          setVoiceState("idle", `Audio transcrito · ${result.segments?.length || 0} segmento(s)`);
        } else {
          setVoiceState("idle", "Transcripción cancelada.");
        }
      } catch (error) {
        setVoiceState("error", error.message || String(error));
      } finally {
        audioButton.disabled = false;
      }
    };
    actions.appendChild(audioButton);
    const composer = actions.closest(".composer-box");
    if (composer && !composer.querySelector("[data-dorn-dictation-status]")) {
      const status = document.createElement("span");
      status.dataset.dornDictationStatus = "true";
      status.className = "dorn-dictation-status";
      status.hidden = true;
      composer.appendChild(status);
    }
    if (!voiceEventsBound) {
      window.dorn.v3.suite.voice.onRecognition((event) => {
        if (event?.type === "ready") setVoiceState("listening", "Escuchando · el audio se procesa en Windows");
        if (event?.type === "text") {
          if (!voiceHandsFree) {
            appendDictatedText(event.text);
            return;
          }
          const original = String(event.text || "").trim();
          const normalized = normalizeSearch(original);
          const wakeRequired = voicePreferences?.voiceWake !== false;
          if (wakeRequired && !normalized.startsWith("dorn ") && normalized !== "dorn") return;
          const command = wakeRequired ? original.replace(/^dorn[\s,:-]*/i, "").trim() : original;
          if (/^(?:detente|detener|pausa|parar)$/.test(normalizeSearch(command))) {
            voiceHandsFree = false;
            void window.dorn.v3.suite.voice.stopRecognition();
            setVoiceState("idle", "Modo manos libres detenido.");
            return;
          }
          if (!command) return;
          appendDictatedText(command);
          window.setTimeout(() => {
            const send = document.querySelector(".composer-box .send-button:not(:disabled)");
            send?.click();
          }, 140);
        }
        if (event?.type === "stopped") setVoiceState("idle", "Dictado detenido.");
        if (event?.type === "error") setVoiceState("error", event.message || "No se pudo usar el micrófono.");
      });
      voiceEventsBound = true;
    }
    if (!voiceChatBound) {
      window.dorn.chat.onEvent(async (event) => {
        if (event?.type !== "done" || !voiceHandsFree || voicePreferences?.voiceAutoRead === false || !event.message?.content) return;
        const spoken = String(event.message.content).replace(/```[\s\S]*?```/g, " bloque de código ").replace(/[*_#>`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 12000);
        if (!spoken) return;
        try {
          await window.dorn.v3.suite.voice.stopRecognition();
          setVoiceState("speaking", "DORN está respondiendo por voz…");
          await window.dorn.v3.suite.voice.speak(spoken, {});
          if (voiceHandsFree) await window.dorn.v3.suite.voice.startRecognition("es-CL");
        } catch (error) {
          setVoiceState("error", error.message || String(error));
        }
      });
      voiceChatBound = true;
    }
    setVoiceState(voiceListening ? "listening" : "idle");
  }

  function downloadJson(fileName, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function closeApprovalPanel(conversationId = "") {
    const panel = document.querySelector(".dorn-approval-backdrop");
    if (!panel) return;
    if (!conversationId || panel.dataset.conversationId === conversationId) panel.remove();
  }

  function showApprovalPanel(payload) {
    if (!payload?.conversationId || !Array.isArray(payload.actions)) return;
    closeApprovalPanel();
    const panel = document.createElement("div");
    panel.className = "dorn-approval-backdrop";
    panel.dataset.conversationId = payload.conversationId;
    const firstAction = payload.actions[0];
    panel.innerHTML = `
      <section class="dorn-approval-panel dorn-approval-compact" role="dialog" aria-modal="true" aria-label="Confirmar acción local">
        <header><span><small>DECISIÓN LOCAL · 0 TOKENS</small><h2>${firstAction?.kind === "terminal" ? "Ejecutar comando" : "Aplicar cambio"}</h2></span><button data-approval-close aria-label="Cerrar">×</button></header>
        <p class="dorn-approval-current">${escapeHtml(firstAction?.label || "Acción del proyecto")}</p>
        ${payload.project ? `<div class="dorn-approval-project"><strong>PROYECTO · ${escapeHtml(payload.project.name)}</strong><code>${escapeHtml(payload.project.rootPath)}</code></div>` : ""}
        <details><summary>Ver ${payload.actions.length} acción(es) del plan</summary><ol>${payload.actions.map((action) => `<li><span>${escapeHtml(action.label)}</span><small>${action.kind === "terminal" ? "CMD / PowerShell / terminal" : "Archivo del proyecto"}</small></li>`).join("")}</ol></details>
        <div class="dorn-approval-note"><strong>Permiso limitado</strong><span>«Sí» autoriza sólo esta acción. El menú ⋯ puede autorizar todas las acciones que quedan en este plan, nunca tareas futuras.</span></div>
        <footer>
          <button data-approval-cancel>No</button>
          <span class="dorn-approval-more"><button data-approval-more aria-label="Más opciones" title="Más opciones">•••</button><span class="dorn-approval-more-menu" hidden><button data-approval-all>Sí a todas las siguientes (${payload.actions.length})</button></span></span>
          <button class="dorn-approval-primary" data-approval-next>Sí</button>
        </footer>
        <p class="dorn-approval-status" data-approval-status></p>
      </section>`;
    document.body.appendChild(panel);
    panel.querySelector("[data-approval-close]").onclick = () => panel.remove();
    panel.querySelector("[data-approval-cancel]").onclick = () => decide("cancel");
    panel.querySelector("[data-approval-next]").onclick = () => decide("approve-next");
    panel.querySelector("[data-approval-all]").onclick = () => decide("approve-all");
    panel.querySelector("[data-approval-more]").onclick = () => {
      const menu = panel.querySelector(".dorn-approval-more-menu");
      menu.hidden = !menu.hidden;
    };
    async function decide(decision) {
      const status = panel.querySelector("[data-approval-status]");
      panel.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      status.textContent = decision === "approve-all"
        ? "Ejecutando y verificando el plan…"
        : decision === "approve-next" ? "Ejecutando una acción…" : "Cancelando el plan…";
      try {
        const result = await window.dorn.chat.decide(payload.conversationId, decision);
        if (!result?.ok) throw new Error(result?.message || "El plan ya no está disponible.");
        panel.remove();
        if (result.pending?.actions?.length) setTimeout(() => showApprovalPanel(result.pending), 120);
      } catch (error) {
        status.textContent = error.message || String(error);
        panel.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      }
    }
  }

  function confirmConsoleExecution(summary = {}) {
    return new Promise((resolve) => {
      document.querySelector(".dorn-console-confirm")?.remove();
      const layer = document.createElement("div");
      layer.className = "dorn-approval-backdrop dorn-console-confirm";
      layer.innerHTML = `<section class="dorn-approval-panel dorn-approval-compact" role="dialog" aria-modal="true" aria-label="Confirmar comando">
        <header><span><small>CMD / POWERSHELL · 0 TOKENS</small><h2>¿Ejecutar este comando?</h2></span><button data-confirm-no aria-label="Cerrar">×</button></header>
        <p class="dorn-approval-current"><code>${escapeHtml(summary.command || "Comando autorizado")}</code></p>
        <details><summary>Ver detalles</summary><ol><li><span>${escapeHtml(summary.relativeCwd || ".")}</span><small>${escapeHtml(summary.shell || "terminal")} · ${(summary.permissionsRequired || []).map(escapeHtml).join(", ") || "permisos del proyecto"}</small></li></ol></details>
        <div class="dorn-approval-note"><strong>Control por consola</strong><span>“Sí” autoriza sólo este comando. “Sí a todas” dura únicamente hasta cerrar esta consola.</span></div>
        <footer><button data-confirm-no>No</button><span class="dorn-approval-more"><button data-confirm-more aria-label="Más opciones">•••</button><span class="dorn-approval-more-menu" hidden><button data-confirm-all>Sí a todas las siguientes</button></span></span><button class="dorn-approval-primary" data-confirm-yes>Sí</button></footer>
      </section>`;
      document.body.appendChild(layer);
      const finish = (answer) => { layer.remove(); resolve(answer); };
      layer.querySelectorAll("[data-confirm-no]").forEach((button) => { button.onclick = () => finish(false); });
      layer.querySelector("[data-confirm-yes]").onclick = () => finish("once");
      layer.querySelector("[data-confirm-all]").onclick = () => finish("all");
      layer.querySelector("[data-confirm-more]").onclick = () => {
        const menu = layer.querySelector(".dorn-approval-more-menu");
        menu.hidden = !menu.hidden;
      };
    });
  }

  async function openDeveloperConsole() {
    const existing = document.querySelector(".dorn-console-layer");
    if (existing) {
      existing.querySelector("[data-script-command]")?.focus();
      return;
    }
    const [preferences, projects] = await Promise.all([
      window.dorn.v3.suite.preferences.get(),
      window.dorn.projects.list()
    ]);
    if (!preferences.developerMode || !preferences.developerConsole) {
      await openCenter("developer");
      return;
    }

    let terminalApproval = null;
    let approveConsoleSession = false;
    const layer = document.createElement("div");
    layer.className = "dorn-console-layer";
    layer.innerHTML = `<section class="dorn-console-panel" role="dialog" aria-label="Consola DORN">
      <header class="dorn-console-head" data-console-drag>
        <span><small>DESARROLLADOR · PROYECTO AUTORIZADO</small><strong>Consola DORN</strong></span>
        <div><button data-console-minimize title="Minimizar consola">—</button><button data-console-close aria-label="Cerrar consola">×</button></div>
      </header>
      <div class="dorn-console-body">
        <div class="dorn-console-fields">
          <label class="dorn-field"><span>Proyecto</span><select data-script-project><option value="">Selecciona una carpeta conectada…</option>${projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("")}</select></label>
          <label class="dorn-field"><span>Plantilla</span><select data-script-template><option value="">Comando propio…</option>${AUTOMATION_TEMPLATES.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.label)}</option>`).join("")}</select></label>
          <label class="dorn-field"><span>Entorno</span><select data-script-shell><option value="powershell">PowerShell</option><option value="cmd">CMD</option><option value="terminal">Terminal del sistema</option></select></label>
          <label class="dorn-field"><span>Carpeta relativa</span><input data-script-cwd placeholder="Raíz del proyecto"></label>
        </div>
        <label class="dorn-field dorn-script-field"><span>Script o comando</span><textarea data-script-command rows="7" spellcheck="false" placeholder="Escribe o pega un script. Nada se ejecuta mientras escribes."></textarea></label>
        <div class="dorn-console-actions"><button class="dorn-cc-primary" data-script-preview>Revisar</button><button class="dorn-cc-secondary" data-script-execute disabled>Confirmar y ejecutar</button><button class="dorn-cc-secondary" data-script-clear>Limpiar</button></div>
        <pre class="dorn-script-output" data-script-output>Consola preparada. Selecciona un proyecto y revisa el comando antes de ejecutarlo.</pre>
      </div>
    </section>`;
    document.body.appendChild(layer);
    const panel = layer.querySelector(".dorn-console-panel");
    const output = layer.querySelector("[data-script-output]");
    const execute = layer.querySelector("[data-script-execute]");
    const command = layer.querySelector("[data-script-command]");
    const invalidate = () => {
      terminalApproval = null;
      execute.disabled = true;
      execute.textContent = "Confirmar y ejecutar";
    };
    const close = () => layer.remove();
    layer.querySelector("[data-console-close]").onclick = close;
    layer.querySelector("[data-console-minimize]").onclick = () => panel.classList.toggle("minimized");
    layer.querySelector("[data-script-clear]").onclick = () => {
      command.value = "";
      output.textContent = "Consola limpia. Ningún comando pendiente.";
      invalidate();
      command.focus();
    };
    layer.querySelectorAll("[data-script-project], [data-script-template], [data-script-shell], [data-script-cwd], [data-script-command]").forEach((input) => {
      input.addEventListener("input", invalidate);
      input.addEventListener("change", invalidate);
    });
    layer.querySelector("[data-script-template]").onchange = (event) => {
      const template = AUTOMATION_TEMPLATES.find((entry) => entry.id === event.target.value);
      if (!template) return;
      layer.querySelector("[data-script-shell]").value = template.shell;
      command.value = template.command;
      output.textContent = `PLANTILLA CARGADA — AÚN NO EJECUTADA\n${template.label}\n\n${template.command}`;
      invalidate();
    };
    layer.querySelector("[data-script-preview]").onclick = async () => {
      const projectId = layer.querySelector("[data-script-project]").value;
      if (!projectId || !command.value.trim()) {
        output.textContent = "Selecciona una carpeta de proyecto conectada y escribe un comando.";
        return;
      }
      try {
        terminalApproval = await window.dorn.v3.terminal.preview({
          projectId,
          shell: layer.querySelector("[data-script-shell]").value,
          command: command.value.trim(),
          relativeCwd: layer.querySelector("[data-script-cwd]").value.trim(),
          timeoutMs: 120000
        });
        output.textContent = [
          "VISTA PREVIA — AÚN NO EJECUTADO",
          `Proyecto: ${terminalApproval.summary?.projectId || projectId}`,
          `Entorno: ${terminalApproval.summary?.shell || "terminal"}`,
          `Carpeta: ${terminalApproval.summary?.relativeCwd || "."}`,
          `Permisos: ${(terminalApproval.summary?.permissionsRequired || []).join(", ") || "lectura"}`,
          "",
          terminalApproval.summary?.command || command.value.trim()
        ].join("\n");
        execute.disabled = false;
      } catch (error) {
        invalidate();
        output.textContent = `DORN bloqueó la vista previa:\n${error.message || String(error)}`;
      }
    };
    execute.onclick = async () => {
      if (!terminalApproval?.approvalToken) return;
      const decision = approveConsoleSession ? "all" : await confirmConsoleExecution(terminalApproval.summary || {});
      if (!decision) {
        output.textContent = "Ejecución cancelada. El comando no se inició.";
        return;
      }
      if (decision === "all") approveConsoleSession = true;
      execute.disabled = true;
      execute.textContent = "Ejecutando…";
      try {
        const result = await window.dorn.v3.terminal.execute(terminalApproval.approvalToken);
        output.textContent = [`PROCESO ${result.exitCode === 0 ? "COMPLETADO" : "FINALIZADO CON ERROR"} · código ${result.exitCode}`, result.stdout || "", result.stderr ? `\nERRORES:\n${result.stderr}` : ""].join("\n");
      } catch (error) {
        output.textContent = `No se pudo ejecutar:\n${error.message || String(error)}`;
      } finally {
        terminalApproval = null;
        execute.textContent = "Confirmar y ejecutar";
      }
    };

    let dragState = null;
    const dragHandle = layer.querySelector("[data-console-drag]");
    dragHandle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragState = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      dragHandle.setPointerCapture(event.pointerId);
    });
    dragHandle.addEventListener("pointermove", (event) => {
      if (!dragState) return;
      const left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, event.clientX - dragState.x));
      const top = Math.max(44, Math.min(window.innerHeight - 70, event.clientY - dragState.y));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });
    dragHandle.addEventListener("pointerup", () => { dragState = null; });
    command.focus();
  }

  function preferenceToggle(key, title, copy, checked, disabled = false) {
    return `<label class="dorn-pref-card ${disabled ? "disabled" : ""}">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></span>
      <input type="checkbox" data-pref="${escapeHtml(key)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
    </label>`;
  }

  async function openCenter(initialTab = "router") {
    if (document.querySelector(".dorn-cc-backdrop")) return;
    if (initialTab === "appearance") initialTab = "colors";
    if (initialTab === "providers") initialTab = "connections";
    const projectId = null;
    const [modes, current, responseStrategies, currentStrategy, productPreferences, products, bootstrap, initialProviders, providerPresets] = await Promise.all([
      window.dorn.v3.suite.modes.list(),
      window.dorn.v3.suite.modes.current(projectId),
      window.dorn.v3.suite.modes.strategies(),
      window.dorn.v3.suite.modes.strategy(projectId),
      window.dorn.v3.suite.preferences.get(),
      window.dorn.v3.suite.products(),
      window.dorn.bootstrap(),
      window.dorn.providers.list(),
      window.dorn.providers.presets()
    ]);
    const localModels = Array.isArray(bootstrap.system?.localModels) ? bootstrap.system.localModels : [];
    let localStatus = bootstrap.localRuntime || {};
    let linuxStatus = bootstrap.linuxRuntime || { state: "UNKNOWN", distributions: [], defaultDistro: null };
    let appearance = readAppearance();
    let preferences = productPreferences;
    let configuredProviders = initialProviders;
    let selectedProviderId = configuredProviders.find((provider) => !provider.locked)?.id || configuredProviders[0]?.id || "";
    let activeCatalogLetter = "A";
    const backdrop = document.createElement("div");
    backdrop.className = "dorn-cc-backdrop";
    backdrop.innerHTML = `
      <section class="dorn-cc-panel" role="dialog" aria-modal="true" aria-label="Centro de control DORN">
        <header class="dorn-cc-head">
          <div><small>DORN AI · 4.0 ALPHA INTERNA</small><h2>Configuración</h2><span class="dorn-cc-platform">Compatible con Windows 11 · x64</span></div>
          <button class="dorn-cc-close" aria-label="Cerrar">×</button>
        </header>
        <nav class="dorn-cc-tabs">
          <small class="dorn-cc-nav-group">EXPERIENCIA</small>
          ${navButton("general", "General")}
          ${navButton("preferences", "Preferencias")}
          ${navButton("colors", "Personalización")}
          <small class="dorn-cc-nav-group">INTELIGENCIA</small>
          ${navButton("router", "Router IA")}
          ${navButton("connections", "Modelos y APIs")}
          ${navButton("catalog", "Catálogo IA")}
          ${navButton("prompt-explorer", "Prompt Explorer")}
          <small class="dorn-cc-nav-group">HERRAMIENTAS</small>
          ${navButton("gamers", "Gamers")}
          ${navButton("products", "Productos")}
          ${navButton("developer", "Desarrollador")}
          ${navButton("linux", "DORN Linux")}
          ${navButton("plugins", "Plugins")}
          ${navButton("about", "Acerca de")}
        </nav>

        <div data-page="general" class="dorn-cc-section">
          <h3>Comportamiento general</h3>
          <p class="dorn-cc-copy">Configuración principal de DORN AI en este computador. Los productos independientes conservan su propio proceso y comparten la apariencia elegida.</p>
          <div class="dorn-pref-grid">
            ${preferenceToggle("introAnimation", "Animación de inicio DORN", "Muestra DORN en primer plano durante 7 segundos.", bootstrap.settings?.introAnimation !== false)}
            ${preferenceToggle("introSound", "Firma sonora de inicio", "Reproduce el sonido profesional de arranque.", bootstrap.settings?.introSound !== false)}
            ${preferenceToggle("launchAtStartup", "Iniciar con Windows", "DORN AI queda disponible al iniciar sesión.", bootstrap.settings?.launchAtStartup === true)}
            ${preferenceToggle("closeToTray", "Mantener en segundo plano", "Al cerrar DORN AI, permanece junto al reloj de Windows.", bootstrap.settings?.closeToTray === true)}
          </div>
          <label class="dorn-field dorn-field-wide"><span>Acceso de DORN al proyecto</span><select data-permission-mode>
            <option value="full-control" ${bootstrap.settings?.permissionMode === "full-control" || !bootstrap.settings?.permissionMode ? "selected" : ""}>Acceso completo (predeterminado)</option>
            <option value="operator" ${bootstrap.settings?.permissionMode === "operator" ? "selected" : ""}>Operador con aprobaciones</option>
            <option value="advisor" ${bootstrap.settings?.permissionMode === "advisor" ? "selected" : ""}>Sólo asesor</option>
          </select><small>Acceso completo permite crear, editar, ejecutar y reparar dentro del proyecto. DORN conserva confirmación para credenciales, rutas externas, elevación, borrado crítico y acciones sin recuperación.</small></label>
          <div class="dorn-cc-actions"><button class="dorn-cc-primary" data-save-general>Guardar configuración</button><button class="dorn-cc-secondary" data-open-models>Configurar conexiones avanzadas</button></div>
          <p class="dorn-inline-status" data-general-status></p>
        </div>

        <div data-page="router" class="dorn-cc-section">
          <h3>Cómo decide DORN</h3>
          <p class="dorn-cc-copy">El modo decide cómo DORN selecciona el motor. Automático busca la mejor IA configurada para cada tarea; Manual muestra alternativas; Privado evita servicios externos.</p>
          <div class="dorn-mode-grid">
            ${modes.map((mode) => {
              const copy = MODE_COPY[mode.id] || [mode.label, "Perfil avanzado de ejecución."];
              return `<button class="dorn-mode-card ${mode.id === current.id ? "active" : ""}" data-mode="${escapeHtml(mode.id)}"><strong>${escapeHtml(copy[0])}</strong><small>${escapeHtml(copy[1])}</small></button>`;
            }).join("")}
          </div>
          <div class="dorn-strategy-section">
            <div class="dorn-strategy-heading"><span><small>ESTRATEGIA DE RESPUESTA</small><strong>¿Cuántas IAs puede usar cada respuesta?</strong></span><em>Independiente del modo de selección</em></div>
            <div class="dorn-strategy-grid">
              ${responseStrategies.map((strategy) => `<button class="dorn-strategy-card ${strategy.id === currentStrategy.id ? "active" : ""}" data-response-strategy="${escapeHtml(strategy.id)}"><span class="dorn-strategy-icon">${strategy.id === "single" ? "1" : "2–4"}</span><span><strong>${escapeHtml(strategy.label)}</strong><small>${escapeHtml(strategy.description)}</small></span>${strategy.confirmationRequired ? '<b>Confirmación obligatoria</b>' : '<b>Una llamada normal</b>'}</button>`).join("")}
            </div>
            <div class="dorn-safety-banner"><strong>Control contra abusos</strong><span>Varias IAs nunca se activa por accidente: antes de enviar, DORN muestra los proveedores participantes, el máximo de llamadas y solicita una confirmación explícita. Automático sigue eligiendo la mejor IA; esta opción sólo determina si responde una o colaboran varias.</span></div>
            <p class="dorn-inline-status" data-strategy-status></p>
          </div>
        </div>

        <div data-page="connections" class="dorn-cc-section">
          <h3>Modelos, APIs y servidores</h3>
          <p class="dorn-cc-copy">Éste es el único menú de conexiones de DORN. Elige una IA y pega su clave: DORN aplica automáticamente protocolo, dirección, cabeceras, plantilla, ruta de respuesta y modelo disponible. Las opciones técnicas quedan sólo para APIs propias o casos especiales.</p>
          <div class="dorn-safety-banner"><strong>Grupos automáticos de claves</strong><span>Puedes guardar varias conexiones del mismo proveedor y modelo —por ejemplo, seis claves Gemini— con nombres distintos. DORN las agrupa por protocolo, dirección, ruta y modelo; reparte carga, evita conexiones ocupadas y cambia de clave ante cuota 429 o errores temporales.</span></div>
          <div class="dorn-connection-toolbar">
            <label><span>1. Elige la IA</span><select data-provider-preset><option value="">Elige API, router o servidor local…</option>${providerPresets.map((preset) => `<option value="${escapeHtml(preset.key)}">${escapeHtml(preset.name)}</option>`).join("")}</select></label>
            <label><span>2. Pega la clave API</span><input type="password" data-provider-quick-key maxlength="2000" autocomplete="off" placeholder="La clave se cifra y no entra al JSON"></label>
            <button class="dorn-cc-primary" data-provider-quick-connect disabled>Conectar, probar y activar</button>
            <button class="dorn-cc-secondary" data-provider-new>Opciones avanzadas</button>
          </div>
          <div class="dorn-connection-layout">
            <aside class="dorn-provider-list" data-provider-list></aside>
            <section class="dorn-provider-editor">
              <input type="hidden" data-provider-field="id">
              <div class="dorn-provider-form-grid">
                <label class="dorn-field"><span>Nombre visible</span><input data-provider-field="name" maxlength="80"></label>
                <label class="dorn-field"><span>Protocolo</span><select data-provider-field="protocol">
                  <option value="openai-responses">OpenAI Responses</option><option value="openai-chat">OpenAI compatible</option><option value="anthropic-messages">Anthropic Messages</option><option value="ollama-chat">Ollama local</option><option value="generic-json">JSON personalizado</option><option value="dorn-local">DORN local administrado</option><option value="dorn-guide">Guía de emergencia</option>
                </select></label>
                <label class="dorn-field"><span>Modelo</span><input data-provider-field="model" list="dorn-provider-model-options" maxlength="150"></label>
                <label class="dorn-field"><span>Clave API</span><input type="password" data-provider-field="apiKey" maxlength="2000" placeholder="Vacío = conservar la clave cifrada"></label>
                <label class="dorn-field dorn-field-wide"><span>Dirección del servidor</span><input data-provider-field="baseUrl" maxlength="300" placeholder="https://… o http://127.0.0.1…"></label>
                <label class="dorn-field"><span>Ruta</span><input data-provider-field="endpoint" maxlength="300" placeholder="/chat/completions"></label>
                <label class="dorn-field"><span>Autenticación</span><select data-provider-field="authType"><option value="bearer">Bearer</option><option value="x-api-key">x-api-key</option><option value="custom-header">Cabecera personalizada (por ejemplo api-key)</option><option value="none">Sin clave</option></select></label>
                <label class="dorn-field"><span>Cabecera de autenticación</span><input data-provider-field="authHeader" maxlength="100"></label>
                <label class="dorn-field"><span>Prioridad automática</span><input type="number" min="0" max="10000" data-provider-field="priority"></label>
              </div>
              <div class="dorn-provider-switches">
                <label><input type="checkbox" data-provider-field="enabled"> Activa</label>
                <label><input type="checkbox" data-provider-field="local"> Procesa localmente</label>
                <label><input type="checkbox" data-provider-field="clearApiKey"> Eliminar clave guardada</label>
              </div>
              <details class="dorn-provider-advanced"><summary>Opciones avanzadas · DORN las completa automáticamente</summary>
                <label class="dorn-field"><span>Capacidades separadas por coma</span><input data-provider-field="capabilities"></label>
                <label class="dorn-field"><span>Cabeceras JSON sin credenciales</span><textarea data-provider-field="headers"></textarea></label>
                <label class="dorn-field"><span>Plantilla JSON</span><textarea data-provider-field="requestTemplate"></textarea></label>
                <label class="dorn-field"><span>Ruta de respuesta</span><input data-provider-field="responsePath" placeholder="output.text"></label>
              </details>
              <datalist id="dorn-provider-model-options" data-provider-model-options></datalist>
              <div class="dorn-cc-actions">
                <button class="dorn-cc-secondary" data-provider-load-models>Cargar modelos</button>
                <button class="dorn-cc-secondary" data-provider-test>Probar conexión</button>
                <button class="dorn-cc-secondary dorn-danger" data-provider-remove>Eliminar</button>
                <button class="dorn-cc-primary" data-provider-save>Guardar</button>
              </div>
              <p class="dorn-inline-status" data-provider-status></p>
            </section>
          </div>
        </div>

        <div data-page="catalog" class="dorn-cc-section">
          <h3>Catálogo y enciclopedia de IA</h3>
          <p class="dorn-cc-copy">Compara modelos locales verificables, conectores de API y ${escapeHtml(AI_ENCYCLOPEDIA_STATS.entries.toLocaleString("es-CL"))} referencias de la enciclopedia aportada a DORN. Una referencia no se presenta como instalable hasta comprobar su origen, licencia y método de integración.</p>
          <div class="dorn-system-card">
            <span><small>ESTE EQUIPO</small><strong>${escapeHtml(`${bootstrap.system?.totalRamGb ?? "—"} GB RAM · ${bootstrap.system?.cpuCores ?? "—"} hilos`)}</strong></span>
            <span><small>ESPACIO LIBRE</small><strong>${escapeHtml(bootstrap.system?.diskFreeGb == null ? "No disponible" : `${bootstrap.system.diskFreeGb} GB`)}</strong></span>
          </div>
          <div class="dorn-model-tools">
            <input data-model-search placeholder="Buscar por nombre, modelo, uso o nivel…" aria-label="Buscar IA">
            <select data-model-kind aria-label="Tipo de IA">
              <option value="all">Local y API</option>
              <option value="verified-local">Instalación DORN</option>
              <option value="local-connector">Conector local</option>
              <option value="api">API externa</option>
              <option value="encyclopedia">Enciclopedia mundial</option>
            </select>
            <select data-model-compatibility aria-label="Compatibilidad">
              <option value="all">Toda compatibilidad</option>
              <option value="recommended">Recomendada</option>
              <option value="compatible">Compatible</option>
              <option value="experimental">Experimental</option>
              <option value="installed">Instalada</option>
              <option value="reference">Referencia por verificar</option>
            </select>
            <select data-model-task aria-label="Uso">
              <option value="all">Todos los usos</option>
              <option value="program">Programación</option>
              <option value="ingenier">Ingeniería</option>
              <option value="aprend">Aprendizaje</option>
              <option value="anal">Análisis</option>
              <option value="document">Documentos</option>
              <option value="imagen">Imagen y diseño</option>
              <option value="video">Video</option>
              <option value="audio">Audio y voz</option>
              <option value="3d">3D y CAD</option>
              <option value="ciencia">Ciencia y medicina</option>
              <option value="seguridad">Ciberseguridad</option>
            </select>
          </div>
          <div class="dorn-alphabet" aria-label="Catálogo alfabético">${["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `<button data-catalog-letter="${letter}" class="${letter === "A" ? "active" : ""}">${letter}</button>`).join("")}</div>
          <div class="dorn-model-grid" data-model-grid>
            ${localModels.map((model) => {
              const installed = (localStatus.installedModelIds || []).includes(model.id);
              const search = [model.label, model.parameterClass, model.aiLevel, ...(model.tasks || [])].join(" ").toLowerCase();
              return `<article class="dorn-model-card ${model.compatibility}" data-model-card="${escapeHtml(model.id)}" data-name="${escapeHtml(model.label)}" data-search="${escapeHtml(normalizeSearch(search))}" data-compatibility="${escapeHtml(model.compatibility)}" data-kind="verified-local" data-tasks="${escapeHtml(normalizeSearch((model.tasks || []).join(" ")))}">
                <div class="dorn-model-card-head">
                  <span class="dorn-model-badge">${escapeHtml(model.compatibility === "recommended" ? "RECOMENDADA" : model.compatibility === "compatible" ? "COMPATIBLE" : "EXPERIMENTAL")}</span>
                  ${installed ? '<span class="dorn-model-installed">INSTALADA</span>' : ""}
                </div>
                <div class="dorn-model-identity">${aiAvatar(model.label, model.id, "LOCAL", model.publisher)}<span><h4>${escapeHtml(model.label)}</h4><strong>${escapeHtml(model.aiLevel)} · ${escapeHtml(model.parameterClass)}</strong></span></div>
                <p>${escapeHtml(model.note)}</p>
                <div class="dorn-model-specs"><span>${escapeHtml(model.estimatedDownload)}</span><span>RAM ${escapeHtml(model.recommendedRam)}</span><span>${escapeHtml(model.contextTokens.toLocaleString("es-CL"))} tokens</span></div>
                <div class="dorn-model-tags">${(model.tasks || []).map((task) => `<small>${escapeHtml(task)}</small>`).join("")}</div>
                <button class="${installed ? "dorn-cc-secondary" : "dorn-cc-primary"}" data-model-review="${escapeHtml(model.id)}">${installed ? "Usar esta IA" : "Revisar e instalar"}</button>
              </article>`;
            }).join("")}
            ${AI_CONNECTORS.map((connector) => {
              const kind = connector.kind.toLowerCase().startsWith("local") ? "local-connector" : "api";
              const preset = providerPresets.find((entry) => entry.key === AI_PRESET_KEYS[connector.id]);
              const automaticReady = preset?.quickConnect?.ready === true;
              const search = `${connector.name} ${connector.kind} ${connector.task} ${connector.aliases || ""} ${connector.copy}`.toLowerCase();
              return `<article class="dorn-model-card connector" data-model-card="connector-${escapeHtml(connector.id)}" data-name="${escapeHtml(connector.name)}" data-search="${escapeHtml(normalizeSearch(search))}" data-compatibility="connector" data-kind="${kind}" data-tasks="${escapeHtml(normalizeSearch(connector.task))}">
                <div class="dorn-model-card-head"><span class="dorn-model-badge">${escapeHtml(connector.kind)}</span>${automaticReady ? '<span class="dorn-model-installed">CONFIGURACIÓN AUTOMÁTICA</span>' : ""}</div>
                <div class="dorn-model-identity">${aiAvatar(connector.name, connector.id, kind === "local-connector" ? "LOCAL" : "API", connector.name)}<span><h4>${escapeHtml(connector.name)}</h4><strong>${automaticReady ? preset.quickConnect.requiresApiKey ? "Sólo pega la API key; DORN configura y prueba lo demás" : "DORN detecta y prueba el servidor automáticamente" : kind === "local-connector" ? "Usa un servidor instalado en este PC" : "Requiere cuenta y configuración del proveedor"}</strong></span></div>
                <p>${escapeHtml(connector.copy)}</p>
                <div class="dorn-model-tags">${connector.task.split(" ").slice(0, 5).map((task) => `<small>${escapeHtml(task)}</small>`).join("")}</div>
                <div class="dorn-model-card-actions"><button class="dorn-cc-primary" data-connector-review="${escapeHtml(connector.name)}" data-connector-id="${escapeHtml(connector.id)}">${automaticReady ? "Conectar automáticamente" : "Revisar conexión"}</button>${renderProviderLinks(connector.id, 1)}</div>
              </article>`;
            }).join("")}
          </div>
          <div class="dorn-encyclopedia-summary" data-encyclopedia-summary></div>
          <div class="dorn-model-grid dorn-encyclopedia-grid" data-encyclopedia-grid></div>
          <div class="dorn-model-guide" data-model-guide>
            <strong>Cómo añadir una IA</strong>
            <ol>
              <li>Busca por tarea o capacidad y revisa la recomendación de RAM.</li>
              <li>Selecciona un modelo; DORN mostrará origen, licencia, descarga y advertencias.</li>
              <li>Confirma la descarga. Se puede pausar y continuar sin empezar de cero.</li>
              <li>Después de verificar el archivo, elígelo en modo Manual o deja que el Router lo recomiende.</li>
            </ol>
            <p>Las fichas de la Enciclopedia mundial son referencias de búsqueda, no promesas de disponibilidad. Para integrar una de ellas, DORN debe identificar primero si es un modelo descargable, una API, una aplicación externa o un producto histórico.</p>
          </div>
          <div class="dorn-model-progress" data-model-progress hidden><i></i><span></span></div>
          <p class="dorn-inline-status" data-model-status></p>
        </div>

        <div data-page="prompt-explorer" class="dorn-cc-section dorn-prompt-explorer">
          <div class="dorn-prompt-heading">
            <span><small>DISEÑO ASISTIDO · CATÁLOGO LOCAL</small><h3>Prompt Explorer</h3><p class="dorn-cc-copy">Explora direcciones visuales originales de DORN, adapta el brief y envía un prompt completo al chat. El catálogo funciona sin internet y no ejecuta nada por sí solo.</p></span>
            <a class="dorn-cc-secondary dorn-link-button" href="https://uiprompt.art/ui-prompt-gallery" target="_blank" rel="noopener noreferrer">Ver referencia externa</a>
          </div>
          <div class="dorn-prompt-tools">
            <label class="dorn-field"><span>Buscar estilos, superficies o tareas</span><input data-prompt-search type="search" placeholder="dashboard, presentación, juego, editorial…" autocomplete="off"></label>
            <label class="dorn-field"><span>Categoría</span><select data-prompt-category><option value="all">Todas</option></select></label>
            <label class="dorn-prompt-favorites"><input type="checkbox" data-prompt-favorites> Sólo favoritos</label>
          </div>
          <div class="dorn-prompt-status" data-prompt-status>Cargando catálogo local verificado…</div>
          <div class="dorn-prompt-layout">
            <div class="dorn-prompt-grid" data-prompt-grid></div>
            <aside class="dorn-prompt-detail" data-prompt-detail>
              <span class="dorn-prompt-empty"><strong>Selecciona una dirección visual</strong><small>Podrás completar tu brief, elegir plataforma y preparar el prompt antes de usarlo.</small></span>
            </aside>
          </div>
        </div>

        <div data-page="preferences" class="dorn-cc-section">
          <h3>Forma de trabajar</h3>
          <p class="dorn-cc-copy">Las funciones especializadas se activan de forma explícita y cambian las instrucciones enviadas al modelo.</p>
          <label class="dorn-field"><span>Personalidad</span><select data-personality>
            <option value="direct" ${preferences.personality === "direct" ? "selected" : ""}>Directo y preciso</option>
            <option value="mentor" ${preferences.personality === "mentor" ? "selected" : ""}>Mentor y profesor</option>
            <option value="companion" ${preferences.personality === "companion" ? "selected" : ""}>Cercano y respetuoso</option>
          </select></label>
          <div class="dorn-pref-grid">
            ${preferenceToggle("learning", "Aprendizaje", "Explicaciones adaptativas, PAES y evaluaciones originales.", preferences.learning)}
            ${preferenceToggle("engineering", "Ingeniería y 3D", "Medidas, unidades, supuestos y revisión técnica explícitos.", preferences.engineering)}
            ${preferenceToggle("workspaceSuggestions", "Sugerir organización", "Detecta si un chat corresponde a Aprender, Ingeniería, Analizar o Automatizar.", preferences.workspaceSuggestions)}
            ${preferenceToggle("voiceConversation", "Conversación por voz", "Permite un modo manos libres optativo con dictado y respuesta hablada de Windows.", preferences.voiceConversation)}
            ${preferenceToggle("voiceWake", "Frase de activación «DORN»", "Sólo procesa una petición manos libres cuando la frase reconocida comienza con DORN.", preferences.voiceWake)}
            ${preferenceToggle("voiceAutoRead", "Leer respuestas", "DORN usa la voz instalada en Windows y pausa el micrófono mientras habla.", preferences.voiceAutoRead)}
            ${preferenceToggle("voiceOutsideApp", "Seguir disponible fuera de la ventana", "Mantiene DORN en segundo plano para escuchar mientras trabajas en otra aplicación.", preferences.voiceOutsideApp)}
            ${preferenceToggle("movablePanels", "Paneles desacoplables", "Pendiente de migrar el frontend compilado a componentes mantenibles.", false, true)}
          </div>
          <div class="dorn-cc-actions"><button class="dorn-cc-primary" data-save-preferences>Guardar preferencias</button><button class="dorn-cc-secondary" data-voice-diagnostics>Comprobar voz de Windows</button></div>
          <p class="dorn-inline-status" data-pref-status></p>
        </div>

        <div data-page="gamers" class="dorn-cc-section">
          <div class="dorn-feature-heading">
            <span class="dorn-feature-mark">G</span>
            <span><small>ASISTENCIA PARA JUGADORES</small><h3>DORN Gamers</h3><p class="dorn-cc-copy">Ayuda mientras juegas: explica mecánicas, misiones, configuraciones, rendimiento, accesibilidad y contenido permitido. La creación de videojuegos pertenece a Desarrollador.</p></span>
          </div>
          <label class="dorn-pref-card dorn-master-toggle">
            <span><strong>Activar asistencia Gamers</strong><small>DORN adapta sus respuestas como apoyo al jugador, sin convertirlas en desarrollo de software.</small></span>
            <input type="checkbox" data-gamer-enabled ${preferences.gamers ? "checked" : ""}>
          </label>
          <div class="dorn-gamer-fields">
            <label class="dorn-field"><span>Objetivo principal</span><select data-gamer="gamerGoal">
              <option value="play" ${preferences.gamerGoal === "play" ? "selected" : ""}>Ayuda mientras juego</option>
              <option value="guide" ${preferences.gamerGoal === "guide" ? "selected" : ""}>Guías, misiones y mecánicas</option>
              <option value="optimize" ${preferences.gamerGoal === "optimize" ? "selected" : ""}>Optimizar rendimiento y ajustes</option>
              <option value="stream" ${preferences.gamerGoal === "stream" ? "selected" : ""}>Streaming y contenido</option>
            </select></label>
            <label class="dorn-field"><span>Perfil de jugador</span><select data-gamer="gamerLevel">
              <option value="casual" ${preferences.gamerLevel === "casual" ? "selected" : ""}>Casual · explicaciones simples</option>
              <option value="regular" ${preferences.gamerLevel === "regular" ? "selected" : ""}>Habitual · equilibrio</option>
              <option value="competitive" ${preferences.gamerLevel === "competitive" ? "selected" : ""}>Competitivo · datos y precisión</option>
            </select></label>
            <label class="dorn-field"><span>Plataforma donde juegas</span><select data-gamer="gamerPlatform">
              <option value="windows" ${preferences.gamerPlatform === "windows" ? "selected" : ""}>Windows</option>
              <option value="web" ${preferences.gamerPlatform === "web" ? "selected" : ""}>Web</option>
              <option value="mobile" ${preferences.gamerPlatform === "mobile" ? "selected" : ""}>Móvil</option>
              <option value="console" ${preferences.gamerPlatform === "console" ? "selected" : ""}>Consola</option>
              <option value="multiplatform" ${preferences.gamerPlatform === "multiplatform" ? "selected" : ""}>Multiplataforma</option>
            </select></label>
          </div>
          <h4 class="dorn-subheading">Prioridades del asesor</h4>
          <div class="dorn-pref-grid">
            ${preferenceToggle("gamerPerformance", "Rendimiento y FPS", "Perfiles, cuellos de botella, memoria y carga de escenas.", preferences.gamerPerformance)}
            ${preferenceToggle("gamerGraphics", "Ajustes gráficos", "Resolución, calidad, latencia, escalado y equilibrio visual.", preferences.gamerGraphics)}
            ${preferenceToggle("gamerTesting", "Errores y estabilidad", "Cierres, fallos conocidos, registros y pasos de diagnóstico seguros.", preferences.gamerTesting)}
            ${preferenceToggle("gamerAccessibility", "Accesibilidad", "Controles, legibilidad, subtítulos, contraste y alternativas.", preferences.gamerAccessibility)}
            ${preferenceToggle("gamerStreaming", "Streaming y contenido", "Escenas, rendimiento de captura y flujo de publicación.", preferences.gamerStreaming)}
            ${preferenceToggle("gamerModding", "Modding autorizado", "Mods y extensiones permitidas por el juego y su licencia.", preferences.gamerModding)}
            ${preferenceToggle("gamerBackgroundAssistant", "Mantener DORN disponible mientras juego", "DORN permanece en segundo plano y puede volver desde la bandeja; no simula teclas ni evita expulsiones por inactividad.", preferences.gamerBackgroundAssistant)}
          </div>
          <div class="dorn-safety-banner"><strong>Límite permanente</strong><span>DORN Gamers no evade anti-cheat, controles de inactividad, licencias, pagos, sanciones ni controles de acceso. Las acciones sobre archivos mantienen vista previa, aprobación e historial.</span></div>
          <div class="dorn-cc-actions"><button class="dorn-cc-primary" data-save-gamers>Guardar perfil Gamers</button></div>
          <p class="dorn-inline-status" data-gamer-status></p>
        </div>

        <div data-page="products" class="dorn-cc-section">
          <h3>Aplicaciones DORN</h3>
          <p class="dorn-cc-copy">Cada producto abre en su propia ventana y comparte identidad, proyectos autorizados y apariencia. En el instalador final podrá tener su acceso directo independiente.</p>
          <div class="dorn-product-grid">
            ${products.filter((product) => ["core", "design", "education", "machine", "editor", "studio3d-basic"].includes(product.id)).map((product) => {
              const canOpen = ["design", "education", "machine", "editor"].includes(product.id);
              const pending = product.id === "studio3d-basic";
              return `<article class="dorn-product-card"><span class="dorn-product-state ${pending ? "pending" : "ready"}">${pending ? "PLANIFICADO PARA V5.0" : "BASE DISPONIBLE"}</span><strong>${escapeHtml(product.label)}</strong><small>${pending ? "Aplicación industrial separada; desarrollo posterior" : "Aplicación conectada a DORN AI"}</small>${canOpen ? `<button class="dorn-cc-secondary" data-product-open="${escapeHtml(product.id)}">Abrir aplicación</button>` : ""}</article>`;
            }).join("")}
          </div>
        </div>

        <div data-page="developer" class="dorn-cc-section">
          <div class="dorn-feature-heading">
            <span class="dorn-feature-mark">D</span>
            <span><small>FUNCIONES OPTATIVAS</small><h3>DORN Desarrollador</h3><p class="dorn-cc-copy">Activa únicamente las herramientas que necesitas para crear páginas, aplicaciones, videojuegos y automatizaciones. Gamers no modifica estas opciones.</p></span>
          </div>
          <label class="dorn-pref-card dorn-master-toggle">
            <span><strong>Activar Desarrollador</strong><small>Permite que DORN proponga trabajo técnico dentro de proyectos autorizados.</small></span>
            <input type="checkbox" data-developer-enabled ${preferences.developerMode ? "checked" : ""}>
          </label>
          <div class="dorn-pref-grid dorn-developer-options">
            ${preferenceToggle("developerWebApi", "Web y APIs", "Interfaces, servicios, autenticación, bases de datos y despliegue.", preferences.developerWebApi)}
            ${preferenceToggle("developerDesktop", "Aplicaciones de escritorio", "Windows, Electron, utilidades, instaladores y actualizaciones.", preferences.developerDesktop)}
            ${preferenceToggle("developerMobile", "Móvil y PWA", "Aplicaciones móviles, interfaces adaptativas, modo offline y publicación.", preferences.developerMobile)}
            ${preferenceToggle("developerGameCreation", "Videojuegos e interacción", "Motores, lógica, físicas, recursos, pruebas y empaquetado.", preferences.developerGameCreation)}
            ${preferenceToggle("developerAutomation", "Scripts y automatización", "PowerShell, CMD y terminal con vista previa y aprobación.", preferences.developerAutomation)}
            ${preferenceToggle("developerDataAi", "Datos e integración IA", "APIs de modelos, procesamiento, bases de datos y flujos de información.", preferences.developerDataAi)}
            ${preferenceToggle("developerDatabases", "Bases de datos", "Modelado, SQL, migraciones, índices, respaldo e integridad.", preferences.developerDatabases)}
            ${preferenceToggle("developerTesting", "Pruebas y depuración", "Tests, reproducción de errores, perfiles, registros y control de calidad.", preferences.developerTesting)}
            ${preferenceToggle("developerSecurity", "Seguridad defensiva", "Dependencias, secretos, permisos, validación y superficies de ataque.", preferences.developerSecurity)}
            ${preferenceToggle("developerPerformance", "Rendimiento y accesibilidad", "Perfiles, memoria, carga, compatibilidad, teclado y lectores de pantalla.", preferences.developerPerformance)}
            ${preferenceToggle("developerInfrastructure", "Infraestructura y CI", "Contenedores, pipelines, entornos y despliegues autorizados.", preferences.developerInfrastructure)}
            ${preferenceToggle("developerRelease", "Git, compilación y publicación", "Versiones, builds, instaladores, CI y entregas verificables.", preferences.developerRelease)}
            ${preferenceToggle("developerDocumentation", "Documentación técnica", "README, arquitectura, decisiones, manuales y traspaso del proyecto.", preferences.developerDocumentation)}
            ${preferenceToggle("developerConsole", "Consola flotante", "Muestra una consola DORN sobre el chat para revisar y ejecutar scripts autorizados.", preferences.developerConsole)}
            ${preferenceToggle("developerIdeTools", "IDEs y herramientas instaladas", "VS Code, compiladores, linters, depuradores, Git y administradores de paquetes disponibles en el equipo.", preferences.developerIdeTools)}
            ${preferenceToggle("developerRobloxStudio", "Roblox Studio y Luau", "MCP oficial de Studio, scripts Luau, pruebas en modo Play y Open Cloud con autorización.", preferences.developerRobloxStudio)}
            ${preferenceToggle("developerCadDccBridges", "CAD, 3D y aplicaciones técnicas", "SolidWorks, Fusion, AutoCAD, Blender y Cinema 4D mediante sus APIs o adaptadores oficiales instalados.", preferences.developerCadDccBridges)}
            ${preferenceToggle("developerLocalProtocols", "MCP y servicios locales", "Conecta herramientas por MCP, procesos stdio o servicios loopback autenticados y limitados al proyecto.", preferences.developerLocalProtocols)}
          </div>
          <div class="dorn-safety-banner"><strong>Potencia con destino explícito</strong><span>Desarrollador puede usar todas las herramientas marcadas dentro del proyecto activo. Roblox, SolidWorks, Fusion y otras aplicaciones requieren su instalación y método oficial; DORN no simula compatibilidad ni controla interfaces a ciegas.</span></div>
          <div class="dorn-cc-actions"><button class="dorn-cc-primary" data-enable-all-developer>Activar perfil completo</button><button class="dorn-cc-secondary" data-save-developer>Guardar selección</button><button class="dorn-cc-secondary" data-open-console>Abrir consola flotante</button></div>
          <p class="dorn-inline-status" data-developer-status></p>
        </div>

        <div data-page="linux" class="dorn-cc-section">
          <div class="dorn-feature-heading">
            <span class="dorn-feature-mark">D</span>
            <span><small>ENTORNO DE CREACIÓN</small><h3>DORN Linux</h3><p class="dorn-cc-copy">Un espacio Linux dentro de Windows 11 para lenguajes, compiladores y herramientas de proyecto. Usa WSL 2; no reemplaza Windows, no particiona el disco y no abre una terminal sin límites.</p></span>
          </div>
          <section class="dorn-linux-hero">
            <div><small>ESTADO OBSERVADO</small><strong data-linux-state>${escapeHtml(linuxStateLabel(linuxStatus.state))}</strong><p data-linux-detail>${escapeHtml(linuxStateDetail(linuxStatus.state))}</p></div>
            <span class="dorn-linux-orbit" aria-hidden="true"><i></i><b>DORN</b></span>
          </section>
          <div class="dorn-model-review-grid dorn-linux-facts">
            <span><small>TARGET</small><strong>WSL 2 local</strong></span>
            <span><small>DISTRIBUCIÓN</small><strong data-linux-default>${escapeHtml(linuxStatus.defaultDistro || "No detectada")}</strong></span>
            <span><small>ALMACENAMIENTO ACTUAL</small><strong data-linux-storage>${escapeHtml(linuxStatus.storageMode || "Sin comprobar")}</strong></span>
            <span><small>EJECUCIÓN</small><strong>Work Units aisladas</strong></span>
          </div>
          <label class="dorn-field dorn-linux-distro"><span>Distribución para revisar</span><select data-linux-distro>
            ${(linuxStatus.distributions?.length ? linuxStatus.distributions : [{ name: "Ubuntu", wslVersion: 2 }]).map((entry) => `<option value="${escapeHtml(entry.name)}" ${entry.name === linuxStatus.defaultDistro ? "selected" : ""}>${escapeHtml(entry.name)} · WSL ${escapeHtml(entry.wslVersion || "—")}</option>`).join("")}
          </select><small>DORN sólo acepta identidades de distribución observadas o el objetivo de instalación Ubuntu.</small></label>
          <div class="dorn-cc-actions">
            <button class="dorn-cc-primary" data-linux-refresh>Comprobar entorno</button>
            <button class="dorn-cc-secondary" data-linux-toolchain ${linuxStatus.state === "READY" ? "" : "disabled"}>Revisar lenguajes</button>
            <button class="dorn-cc-secondary" data-linux-plan>Ver preparación segura</button>
          </div>
          <div class="dorn-linux-toolchain" data-linux-toolchain-output><span>Node.js, Python, Git, C/C++, CMake, Rust, Go y Java se mostrarán sólo si WSL confirma que están instalados.</span></div>
          <p class="dorn-inline-status" data-linux-status></p>
          <div class="dorn-safety-banner"><strong>Control del proyecto</strong><span>Las herramientas Linux operan dentro de una Work Unit vinculada al proyecto. DORN bloquea shell genérico, sudo, eval, rutas externas y ejecución sin alcance; integrar cambios sigue requiriendo pruebas y Evidence sobre los mismos bytes.</span></div>
        </div>

        <div data-page="plugins" class="dorn-cc-section">
          <div class="dorn-future-module">
            <span class="dorn-product-state pending">EN PROCESO</span>
            <h3>Plugins para DORN 5.0</h3>
            <p>El catálogo público, la firma de paquetes y el SDK para desarrolladores se diseñarán para la edición pública. En v4 este apartado no instala ni ejecuta plugins para evitar presentar una función incompleta.</p>
          </div>
        </div>

        <div data-page="colors" class="dorn-cc-section">
          <h3>Personalización y aspecto</h3>
          <p class="dorn-cc-copy">Aplica una identidad coherente a DORN AI, sus productos y la animación de inicio. Puedes usar una paleta profesional o una imagen propia con capas de legibilidad.</p>
          <section class="dorn-background-editor">
            <div class="dorn-background-preview ${appearance.backgroundMode === "image" ? "active" : ""}" data-background-preview>
              <img data-background-preview-image alt="Vista previa del fondo" ${appearance.backgroundImage ? `src="${appearance.backgroundImage}"` : "hidden"}>
              <span data-background-empty ${appearance.backgroundImage ? "hidden" : ""}><strong>Fondo con imagen o GIF</strong><small>PNG, JPG, GIF, WebP, AVIF, BMP o ICO · máximo 48 MB</small></span>
              <i></i>
            </div>
            <div class="dorn-background-controls">
              <div><small>FONDO DE LA INTERFAZ</small><strong>Imagen local o color de la paleta</strong><p>La imagen se guarda en este computador y recibe una capa oscura para mantener textos y botones legibles.</p></div>
              <div class="dorn-cc-actions"><button class="dorn-cc-primary" data-background-upload>${appearance.backgroundImage ? "Reemplazar imagen o GIF" : "Elegir imagen o GIF"}</button><button class="dorn-cc-secondary" data-background-color>Usar sólo paleta</button><button class="dorn-cc-secondary" data-background-remove ${appearance.backgroundImage ? "" : "disabled"}>Quitar archivo</button></div>
              <div class="dorn-background-options">
                <label class="dorn-field"><span>Ajuste</span><select data-background-fit><option value="cover" ${appearance.backgroundFit === "cover" ? "selected" : ""}>Cubrir ventana</option><option value="contain" ${appearance.backgroundFit === "contain" ? "selected" : ""}>Mostrar completa</option><option value="tile" ${appearance.backgroundFit === "tile" ? "selected" : ""}>Mosaico</option></select></label>
                <label class="dorn-field"><span>Mezcla con la paleta</span><select data-background-blend><option value="normal" ${appearance.backgroundBlend === "normal" ? "selected" : ""}>Normal</option><option value="multiply" ${appearance.backgroundBlend === "multiply" ? "selected" : ""}>Multiplicar</option><option value="overlay" ${appearance.backgroundBlend === "overlay" ? "selected" : ""}>Superponer</option><option value="soft-light" ${appearance.backgroundBlend === "soft-light" ? "selected" : ""}>Luz suave</option></select></label>
                <label><span>Intensidad <b data-background-strength-label>${appearance.backgroundStrength}%</b></span><input type="range" min="10" max="100" value="${appearance.backgroundStrength}" data-background-strength></label>
                <label><span>Desenfoque <b data-background-blur-label>${appearance.backgroundBlur}px</b></span><input type="range" min="0" max="24" value="${appearance.backgroundBlur}" data-background-blur></label>
                <label><span>Capa de color <b data-background-tint-label>${appearance.backgroundTint}%</b></span><input type="range" min="0" max="92" value="${appearance.backgroundTint}" data-background-tint></label>
              </div>
              <p class="dorn-inline-status" data-background-status></p>
            </div>
          </section>
          <div class="dorn-theme-grid">
            ${THEMES.map(([id, title, copy]) => {
              const palette = PALETTES[id];
              return `<button class="dorn-theme-card ${appearance.theme === id ? "active" : ""}" data-theme="${id}">
                <span class="dorn-theme-swatches">${[palette.background, palette.panel, palette.surface, palette.accent, palette.text].map((color) => `<i style="background:${color}"></i>`).join("")}</span>
                <strong>${title}</strong><small>${copy}</small>
              </button>`;
            }).join("")}
          </div>
          <div class="dorn-palette-editor">
            <div class="dorn-palette-title"><span><small>PALETA PERSONALIZADA ARMONIZADA</small><strong>Elige tu identidad; DORN equilibrará las superficies</strong></span><span class="dorn-palette-chip">HEX · LOCAL</span></div>
            <div class="dorn-color-grid">
              ${[
                ["accent", "Acento"],
                ["background", "Fondo"],
                ["panel", "Panel"],
                ["surface", "Superficie"],
                ["text", "Texto"],
                ["muted", "Texto secundario"]
              ].map(([key, label]) => `<label class="dorn-color-field"><span>${label}</span><div><input type="color" data-palette-color="${key}" value="${appearance.customPalette[key]}"><input data-palette-hex="${key}" value="${appearance.customPalette[key]}" maxlength="7" spellcheck="false"></div></label>`).join("")}
            </div>
            <div class="dorn-palette-preview" data-palette-preview>
              <aside><span class="dorn-preview-dot"></span><i></i><i></i><i></i></aside>
              <main><small>VISTA PREVIA</small><strong>DORN · Espacio de trabajo</strong><p>Comprueba la jerarquía, el texto y el color de acción antes de aplicar.</p><button>Acción principal</button></main>
            </div>
            <p class="dorn-contrast-status" data-color-status></p>
            <div class="dorn-cc-actions">
              <button class="dorn-cc-primary" data-apply-custom>Aplicar colores</button>
              <button class="dorn-cc-secondary" data-reset-colors>Restablecer DORN</button>
              <button class="dorn-cc-secondary" data-export-colors>Exportar paleta</button>
              <button class="dorn-cc-secondary" data-import-colors>Importar paleta</button>
              <input type="file" accept="application/json,.json" data-import-colors-file hidden>
            </div>
          </div>
          <section class="dorn-window-motion">
            <div>
              <small>MOVIMIENTO DE VENTANAS</small>
              <strong>Animación al abrir paneles y herramientas</strong>
              <p>Elige un estilo para las ventanas internas de DORN. No modifica las ventanas de Windows ni otras aplicaciones.</p>
            </div>
            <label class="dorn-field"><span>Efecto</span><select data-window-effect>
              <option value="default" ${appearance.windowEffect === "default" ? "selected" : ""}>Predeterminado</option>
              <option value="fade" ${appearance.windowEffect === "fade" ? "selected" : ""}>Desvanecer</option>
              <option value="scale" ${appearance.windowEffect === "scale" ? "selected" : ""}>Escala suave</option>
              <option value="slide" ${appearance.windowEffect === "slide" ? "selected" : ""}>Deslizar</option>
              <option value="spring" ${appearance.windowEffect === "spring" ? "selected" : ""}>Resorte</option>
              <option value="cinematic" ${appearance.windowEffect === "cinematic" ? "selected" : ""}>Cinemático</option>
            </select></label>
            <label class="dorn-field"><span>Intensidad</span><select data-motion-intensity>
              <option value="very-soft" ${appearance.motionIntensity === "very-soft" ? "selected" : ""}>Muy suave</option>
              <option value="soft" ${appearance.motionIntensity === "soft" ? "selected" : ""}>Suave</option>
              <option value="balanced" ${appearance.motionIntensity === "balanced" ? "selected" : ""}>Equilibrado</option>
              <option value="dynamic" ${appearance.motionIntensity === "dynamic" ? "selected" : ""}>Dinámico</option>
              <option value="aggressive" ${appearance.motionIntensity === "aggressive" ? "selected" : ""}>Agresivo</option>
            </select></label>
            <button class="dorn-cc-secondary" data-preview-window-effect>Probar efecto</button>
          </section>
          <div class="dorn-cc-actions" style="margin-top:16px">
            <button class="dorn-cc-secondary" data-density>${appearance.density === "compact" ? "Densidad: compacta" : "Densidad: cómoda"}</button>
            <button class="dorn-cc-secondary" data-motion>${appearance.motion === "reduced" ? "Movimiento: reducido" : "Movimiento: completo"}</button>
            <button class="dorn-cc-secondary" data-contrast>${appearance.contrast === "high" ? "Contraste: alto" : "Contraste: normal"}</button>
          </div>
        </div>
        <div data-page="about" class="dorn-cc-section">
          <h3>Acerca de DORN AI</h3>
          <p class="dorn-cc-copy">DORN AI 4.0 es una versión interna. DORN 5.0 sigue siendo la futura edición pública completa.</p>
          <div class="dorn-model-review-grid">
            <span><small>VERSIÓN</small><strong>${escapeHtml(bootstrap.version || "4.0.0-alpha")}</strong></span>
            <span><small>SISTEMA</small><strong>${escapeHtml(`${bootstrap.system?.platform || "Windows"} ${bootstrap.system?.arch || "x64"}`)}</strong></span>
            <span><small>PROCESADOR</small><strong>${escapeHtml(bootstrap.system?.cpu || "No identificado")}</strong></span>
            <span><small>MEMORIA</small><strong>${escapeHtml(`${bootstrap.system?.totalRamGb ?? "—"} GB RAM`)}</strong></span>
            <span><small>GPU</small><strong>${escapeHtml(bootstrap.system?.gpu || "No detectada")}</strong></span>
            <span><small>ESPACIO LIBRE</small><strong>${escapeHtml(bootstrap.system?.diskFreeGb == null ? "No disponible" : `${bootstrap.system.diskFreeGb} GB`)}</strong></span>
          </div>
        </div>
      </section>`;
    document.body.appendChild(backdrop);

    const show = (tab) => {
      backdrop.querySelectorAll("[data-page]").forEach((page) => page.hidden = page.dataset.page !== tab);
      backdrop.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    };
    let selectedPromptId = "";
    let builtPrompt = null;
    const promptFilters = () => ({
      query: backdrop.querySelector("[data-prompt-search]").value,
      category: backdrop.querySelector("[data-prompt-category]").value,
      favoritesOnly: backdrop.querySelector("[data-prompt-favorites]").checked
    });
    const renderPromptCatalog = (catalog) => {
      const grid = backdrop.querySelector("[data-prompt-grid]");
      const status = backdrop.querySelector("[data-prompt-status]");
      const category = backdrop.querySelector("[data-prompt-category]");
      if (category.options.length === 1) {
        for (const name of catalog.categories || []) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          category.appendChild(option);
        }
      }
      status.textContent = `${catalog.matched} de ${catalog.total} direcciones · catálogo original DORN · disponible sin internet`;
      grid.innerHTML = (catalog.entries || []).map((entry) => `<button class="dorn-prompt-card ${selectedPromptId === entry.id ? "active" : ""}" data-prompt-id="${escapeHtml(entry.id)}">
        <span class="dorn-prompt-preview" style="--pe-bg:${escapeHtml(entry.palette[0])};--pe-surface:${escapeHtml(entry.palette[1])};--pe-text:${escapeHtml(entry.palette[2])};--pe-accent:${escapeHtml(entry.palette[3])}"><i></i><b></b><em></em><small></small></span>
        <span class="dorn-prompt-card-copy"><small>${escapeHtml(entry.category)} · ${escapeHtml(entry.layout)}</small><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.description)}</span><span class="dorn-prompt-tags">${entry.tags.slice(0, 3).map((tag) => `<i>${escapeHtml(tag)}</i>`).join("")}</span></span>
        <span class="dorn-prompt-star" aria-label="${entry.favorite ? "Favorito" : "No favorito"}">${entry.favorite ? "★" : "☆"}</span>
      </button>`).join("");
      if (!(catalog.entries || []).length) {
        grid.innerHTML = '<span class="dorn-prompt-empty"><strong>No hay coincidencias</strong><small>Cambia la búsqueda, categoría o filtro de favoritos.</small></span>';
      }
      grid.querySelectorAll("[data-prompt-id]").forEach((button) => {
        button.onclick = () => openPromptDetail(button.dataset.promptId);
      });
    };
    const loadPromptCatalog = async () => {
      const status = backdrop.querySelector("[data-prompt-status]");
      status.textContent = "Buscando en el catálogo local…";
      try {
        renderPromptCatalog(await window.dorn.v3.suite.promptExplorer.catalog(promptFilters()));
      } catch (error) {
        status.textContent = `Prompt Explorer no pudo cargar: ${error.message || String(error)}`;
      }
    };
    const buildSelectedPrompt = async () => {
      if (!selectedPromptId) return null;
      const detail = backdrop.querySelector("[data-prompt-detail]");
      const status = detail.querySelector("[data-prompt-build-status]");
      status.textContent = "Preparando prompt local…";
      try {
        builtPrompt = await window.dorn.v3.suite.promptExplorer.build(selectedPromptId, {
          brief: detail.querySelector("[data-prompt-brief]").value,
          platform: detail.querySelector("[data-prompt-platform]").value,
          framework: detail.querySelector("[data-prompt-framework]").value,
          theme: detail.querySelector("[data-prompt-theme]").value
        });
        const output = detail.querySelector("[data-prompt-output]");
        output.value = builtPrompt.prompt;
        output.hidden = false;
        status.textContent = "Prompt preparado. Aún no se ha enviado ni ejecutado.";
        return builtPrompt;
      } catch (error) {
        status.textContent = error.message || String(error);
        return null;
      }
    };
    const openPromptDetail = async (promptId) => {
      selectedPromptId = promptId;
      builtPrompt = null;
      const detail = backdrop.querySelector("[data-prompt-detail]");
      detail.innerHTML = '<span class="dorn-prompt-empty"><strong>Cargando dirección…</strong></span>';
      try {
        const entry = await window.dorn.v3.suite.promptExplorer.get(promptId);
        detail.innerHTML = `
          <div class="dorn-prompt-detail-head"><span><small>${escapeHtml(entry.category)} · ${escapeHtml(entry.layout)}</small><h3>${escapeHtml(entry.title)}</h3></span><button class="dorn-prompt-favorite-button ${entry.favorite ? "active" : ""}" data-prompt-favorite title="Favorito">${entry.favorite ? "★" : "☆"}</button></div>
          <p>${escapeHtml(entry.description)}</p>
          <div class="dorn-prompt-palette">${entry.palette.map((color) => `<i style="background:${escapeHtml(color)}" title="${escapeHtml(color)}"></i>`).join("")}</div>
          <label class="dorn-field"><span>Brief del proyecto</span><textarea data-prompt-brief rows="5" placeholder="Qué se crea, para quién, tarea principal, contenido y resultado esperado"></textarea></label>
          <div class="dorn-prompt-form-grid">
            <label class="dorn-field"><span>Plataforma</span><input data-prompt-platform value="web responsive y escritorio"></label>
            <label class="dorn-field"><span>Tecnología</span><input data-prompt-framework value="el stack más apropiado y mantenible"></label>
          </div>
          <label class="dorn-field"><span>Dirección visual</span><input data-prompt-theme value="${escapeHtml(entry.aesthetic)}"></label>
          <textarea class="dorn-prompt-output" data-prompt-output rows="9" readonly hidden></textarea>
          <div class="dorn-cc-actions"><button class="dorn-cc-secondary" data-prompt-build>Preparar prompt</button><button class="dorn-cc-secondary" data-prompt-copy disabled>Copiar</button><button class="dorn-cc-primary" data-prompt-use>Usar en el chat</button></div>
          <p class="dorn-inline-status" data-prompt-build-status>Completa el brief. DORN no ejecutará nada desde esta vista.</p>`;
        detail.querySelector("[data-prompt-favorite]").onclick = async (event) => {
          const next = !event.currentTarget.classList.contains("active");
          await window.dorn.v3.suite.promptExplorer.favorite(entry.id, next);
          event.currentTarget.classList.toggle("active", next);
          event.currentTarget.textContent = next ? "★" : "☆";
          await loadPromptCatalog();
        };
        detail.querySelector("[data-prompt-build]").onclick = async () => {
          const result = await buildSelectedPrompt();
          detail.querySelector("[data-prompt-copy]").disabled = !result;
        };
        detail.querySelector("[data-prompt-copy]").onclick = async () => {
          if (!builtPrompt) builtPrompt = await buildSelectedPrompt();
          if (!builtPrompt) return;
          const output = detail.querySelector("[data-prompt-output]");
          try {
            await navigator.clipboard.writeText(builtPrompt.prompt);
          } catch {
            output.select();
            document.execCommand("copy");
          }
          detail.querySelector("[data-prompt-build-status]").textContent = "Prompt copiado al portapapeles.";
        };
        detail.querySelector("[data-prompt-use]").onclick = async () => {
          const result = builtPrompt || await buildSelectedPrompt();
          if (!result) return;
          closeCenter();
          placeProductPrompt({ productLabel: "Prompt Explorer", content: result.prompt });
        };
        await loadPromptCatalog();
      } catch (error) {
        detail.innerHTML = `<span class="dorn-prompt-empty"><strong>No se pudo abrir</strong><small>${escapeHtml(error.message || String(error))}</small></span>`;
      }
    };
    let promptSearchTimer = null;
    backdrop.querySelector("[data-prompt-search]").addEventListener("input", () => {
      clearTimeout(promptSearchTimer);
      promptSearchTimer = setTimeout(loadPromptCatalog, 180);
    });
    backdrop.querySelector("[data-prompt-category]").onchange = loadPromptCatalog;
    backdrop.querySelector("[data-prompt-favorites]").onchange = loadPromptCatalog;
    const providerField = (name) => backdrop.querySelector(`[data-provider-field="${name}"]`);
    const blankProvider = () => ({
      id: "", name: "Nueva conexión", protocol: "openai-chat", authType: "bearer", authHeader: "Authorization",
      baseUrl: "", endpoint: "/chat/completions", model: "", headers: {}, requestTemplate: {}, responsePath: "",
      enabled: true, priority: 100, capabilities: ["text"], local: false, locked: false
    });
    const writeProviderForm = (provider = blankProvider()) => {
      selectedProviderId = provider.id || "";
      const values = {
        id: provider.id || "", name: provider.name || "", protocol: provider.protocol || "openai-chat",
        authType: provider.authType || "bearer", authHeader: provider.authHeader || "Authorization",
        baseUrl: provider.baseUrl || "", endpoint: provider.endpoint || "", model: provider.model || "",
        apiKey: "", priority: provider.priority ?? 100, enabled: provider.enabled !== false, local: provider.local === true,
        clearApiKey: false, capabilities: (provider.capabilities || ["text"]).join(", "),
        headers: JSON.stringify(provider.headers || {}, null, 2), requestTemplate: JSON.stringify(provider.requestTemplate || {}, null, 2),
        responsePath: provider.responsePath || ""
      };
      Object.entries(values).forEach(([name, value]) => {
        const field = providerField(name);
        if (!field) return;
        if (field.type === "checkbox") field.checked = Boolean(value);
        else field.value = value;
      });
      const remove = backdrop.querySelector("[data-provider-remove]");
      remove.disabled = !provider.id || provider.locked === true;
      remove.title = provider.locked ? "Este componente pertenece al núcleo de DORN." : "";
      backdrop.querySelector("[data-provider-status]").textContent = provider.hasApiKey ? "La clave ya está cifrada en este computador. Déjala vacía para conservarla." : "";
      backdrop.querySelectorAll("[data-provider-entry]").forEach((button) => button.classList.toggle("active", button.dataset.providerEntry === selectedProviderId));
    };
    const renderProviderList = () => {
      const list = backdrop.querySelector("[data-provider-list]");
      list.innerHTML = configuredProviders.map((provider) => `<button data-provider-entry="${escapeHtml(provider.id)}" class="${provider.id === selectedProviderId ? "active" : ""}">
        ${aiAvatar(provider.name, provider.id, provider.local ? "LOCAL" : "API", provider.name)}
        <span><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(provider.model || provider.protocol)} · ${provider.enabled ? "Activa" : "Desactivada"}</small></span>
      </button>`).join("");
      list.querySelectorAll("[data-provider-entry]").forEach((button) => {
        button.onclick = () => writeProviderForm(configuredProviders.find((provider) => provider.id === button.dataset.providerEntry));
      });
    };
    const parseProviderJson = (name) => {
      const value = providerField(name).value.trim();
      if (!value) return {};
      const parsed = JSON.parse(value);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(`${name} debe ser un objeto JSON.`);
      return parsed;
    };
    const readProviderForm = () => {
      const id = providerField("id").value.trim();
      const draft = {
        name: providerField("name").value.trim(), protocol: providerField("protocol").value,
        authType: providerField("authType").value, authHeader: providerField("authHeader").value.trim(),
        baseUrl: providerField("baseUrl").value.trim(), endpoint: providerField("endpoint").value.trim(),
        model: providerField("model").value.trim(), apiKey: providerField("apiKey").value.trim() || undefined,
        clearApiKey: providerField("clearApiKey").checked, headers: parseProviderJson("headers"),
        requestTemplate: parseProviderJson("requestTemplate"), responsePath: providerField("responsePath").value.trim(),
        enabled: providerField("enabled").checked, priority: Number(providerField("priority").value || 100),
        capabilities: providerField("capabilities").value.split(",").map((value) => value.trim()).filter(Boolean),
        local: providerField("local").checked, locked: false
      };
      if (id) draft.id = id;
      return draft;
    };
    const refreshProviderList = async (preferredId = selectedProviderId) => {
      configuredProviders = await window.dorn.providers.list();
      selectedProviderId = configuredProviders.some((provider) => provider.id === preferredId) ? preferredId : configuredProviders[0]?.id || "";
      renderProviderList();
      writeProviderForm(configuredProviders.find((provider) => provider.id === selectedProviderId) || blankProvider());
    };
    const readPaletteInputs = () => {
      const result = {};
      backdrop.querySelectorAll("[data-palette-hex]").forEach((input) => {
        const fallback = appearance.customPalette[input.dataset.paletteHex] || PALETTES.graphite[input.dataset.paletteHex];
        result[input.dataset.paletteHex] = normalizeHex(input.value, fallback);
      });
      return normalizePalette(result, appearance.customPalette);
    };
    const writePaletteInputs = (palette) => {
      const normalized = normalizePalette(palette, PALETTES.graphite);
      backdrop.querySelectorAll("[data-palette-hex]").forEach((input) => {
        const value = normalized[input.dataset.paletteHex];
        input.value = value;
        input.classList.remove("invalid");
        const picker = backdrop.querySelector(`[data-palette-color="${input.dataset.paletteHex}"]`);
        if (picker) picker.value = value;
      });
      refreshPalettePreview(normalized);
    };
    const refreshPalettePreview = (provided) => {
      const palette = provided || readPaletteInputs();
      const preview = backdrop.querySelector("[data-palette-preview]");
      if (!preview) return palette;
      const onAccent = contrastRatio(palette.accent, "#08090a") >= contrastRatio(palette.accent, "#ffffff") ? "#08090a" : "#ffffff";
      preview.style.setProperty("--preview-bg", palette.background);
      preview.style.setProperty("--preview-panel", palette.panel);
      preview.style.setProperty("--preview-surface", palette.surface);
      preview.style.setProperty("--preview-accent", palette.accent);
      preview.style.setProperty("--preview-text", palette.text);
      preview.style.setProperty("--preview-muted", palette.muted);
      preview.style.setProperty("--preview-on-accent", onAccent);
      const ratio = contrastRatio(palette.text, palette.background);
      const status = backdrop.querySelector("[data-color-status]");
      status.classList.toggle("warning", ratio < 4.5);
      status.textContent = ratio >= 7
        ? `Contraste ${ratio.toFixed(2)}:1 · excelente para lectura.`
        : ratio >= 4.5
          ? `Contraste ${ratio.toFixed(2)}:1 · correcto para texto normal.`
          : `Contraste ${ratio.toFixed(2)}:1 · advertencia: el texto puede resultar difícil de leer.`;
      return palette;
    };
    const closeAiSetup = () => document.querySelector(".dorn-ai-setup-layer")?.remove();
    const openAiSetup = ({ badge, title, subtitle = "", content, actions = "" }) => {
      closeAiSetup();
      const layer = document.createElement("div");
      layer.className = "dorn-ai-setup-layer";
      layer.innerHTML = `<section class="dorn-ai-setup-panel" role="dialog" aria-modal="true" aria-label="Configurar ${escapeHtml(title)}">
        <header><span><small>${escapeHtml(badge)}</small><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</span><button data-ai-setup-close aria-label="Cerrar">×</button></header>
        <div class="dorn-ai-setup-body">${content}</div>
        <footer>${actions}<button class="dorn-cc-secondary" data-ai-setup-cancel>Cancelar</button></footer>
      </section>`;
      document.body.appendChild(layer);
      layer.querySelector("[data-ai-setup-close]").onclick = closeAiSetup;
      layer.querySelector("[data-ai-setup-cancel]").onclick = closeAiSetup;
      layer.onclick = (event) => { if (event.target === layer) closeAiSetup(); };
      return layer;
    };
    const reviewEncyclopedia = (entryId) => {
      const entry = AI_ENCYCLOPEDIA.find((candidate) => candidate.id === entryId);
      if (!entry) return;
      const connector = encyclopediaConnector(entry);
      if (connector) {
        void reviewConnector(connector.name);
        return;
      }
      const layer = openAiSetup({
        badge: "REFERENCIA · REQUIERE VERIFICACIÓN",
        title: entry.name,
        subtitle: "Ficha de la Enciclopedia Mundial de IA",
        content: `<div class="dorn-model-review">
        <p>Esta ficha proviene de la Enciclopedia Mundial de IA aportada a DORN. Todavía no afirma que exista una descarga directa, una API pública ni una licencia utilizable.</p>
        <div class="dorn-model-review-grid">
          <span><small>EMPRESA O GRUPO</small><strong>${escapeHtml(entry.company)}</strong></span>
          <span><small>FAMILIA</small><strong>${escapeHtml(entry.family)}</strong></span>
          <span><small>CATEGORÍA</small><strong>${escapeHtml(entry.category)}</strong></span>
          <span><small>DISPONIBILIDAD</small><strong>${escapeHtml(entry.availability)}</strong></span>
        </div>
        <p><strong>Etiquetas:</strong> ${escapeHtml((entry.modalities || []).join(" · "))}</p>
        <div class="dorn-approval-note"><strong>Antes de implementar</strong><span>Confirma el sitio oficial, la licencia, la plataforma, el formato, los requisitos de hardware y si el proveedor permite uso local o mediante API.</span></div>
      </div>`,
        actions: '<button class="dorn-cc-primary" data-ai-reference-connect>Agregar conexión verificada</button>'
      });
      layer.querySelector("[data-ai-reference-connect]").onclick = () => {
        closeAiSetup();
        show("connections");
        writeProviderForm({ ...blankProvider(), name: entry.name });
      };
    };
    const filterModels = () => {
      const query = normalizeSearch(backdrop.querySelector("[data-model-search]").value);
      const kind = backdrop.querySelector("[data-model-kind]").value;
      const compatibility = backdrop.querySelector("[data-model-compatibility]").value;
      const task = backdrop.querySelector("[data-model-task]").value;
      backdrop.querySelectorAll("[data-model-card]").forEach((card) => {
        const matchesQuery = !query || card.dataset.search.includes(query);
        const first = normalizeSearch(card.dataset.name).charAt(0).toUpperCase();
        const matchesLetter = Boolean(query) || activeCatalogLetter === "#"
          ? Boolean(query) || !/^[A-Z]$/.test(first)
          : first === activeCatalogLetter;
        const installed = (localStatus.installedModelIds || []).includes(card.dataset.modelCard);
        const matchesKind = kind === "all" || card.dataset.kind === kind;
        const matchesCompatibility = compatibility === "all"
          || (compatibility === "installed" ? installed : card.dataset.compatibility === compatibility);
        const matchesTask = task === "all" || card.dataset.tasks.includes(task);
        card.hidden = !(matchesQuery && matchesLetter && matchesKind && matchesCompatibility && matchesTask);
      });

      const encyclopediaMatches = AI_ENCYCLOPEDIA.filter((entry) => {
        const first = normalizeSearch(entry.name).charAt(0).toUpperCase();
        const matchesQuery = !query || entry.search.includes(query);
        const matchesLetter = Boolean(query) || activeCatalogLetter === "#"
          ? Boolean(query) || !/^[A-Z]$/.test(first)
          : first === activeCatalogLetter;
        const matchesKind = kind === "all" || kind === "encyclopedia";
        const matchesCompatibility = compatibility === "all" || compatibility === "reference";
        const matchesTask = task === "all" || entry.search.includes(task);
        return matchesQuery && matchesLetter && matchesKind && matchesCompatibility && matchesTask;
      });
      const encyclopediaGrid = backdrop.querySelector("[data-encyclopedia-grid]");
      const visibleEntries = encyclopediaMatches.slice(0, 120);
      encyclopediaGrid.innerHTML = visibleEntries.map((entry) => {
        const connector = encyclopediaConnector(entry);
        return `<article class="dorn-model-card encyclopedia" data-encyclopedia-card="${escapeHtml(entry.id)}">
        <div class="dorn-model-card-head"><span class="dorn-model-badge">${connector ? "API OFICIAL" : "ENCICLOPEDIA"}</span><span class="${connector ? "dorn-model-installed" : "dorn-model-reference"}">${connector ? "CONFIGURACIÓN AUTOMÁTICA" : "POR VERIFICAR"}</span></div>
        <div class="dorn-model-identity">${aiAvatar(entry.name, entry.id, "REF", entry.company)}<span><h4>${escapeHtml(entry.name)}</h4><strong>${escapeHtml(entry.company)} · ${escapeHtml(entry.category)}</strong></span></div>
        <p>${connector ? "DORN reconoce esta familia y usará su conector oficial verificado. Sólo tendrás que pegar la clave API." : "Referencia navegable. DORN no la marca como descargable ni conectable hasta validar la fuente oficial."}</p>
        <div class="dorn-model-tags">${(entry.modalities || []).slice(0, 4).map((tag) => `<small>${escapeHtml(tag)}</small>`).join("")}</div>
        <button class="${connector ? "dorn-cc-primary" : "dorn-cc-secondary"}" data-encyclopedia-review="${escapeHtml(entry.id)}">${connector ? "Conectar automáticamente" : "Revisar ficha"}</button>
      </article>`;
      }).join("");
      encyclopediaGrid.querySelectorAll("[data-encyclopedia-review]").forEach((button) => {
        button.onclick = () => reviewEncyclopedia(button.dataset.encyclopediaReview);
      });
      encyclopediaGrid.querySelectorAll("[data-encyclopedia-card]").forEach((card) => {
        card.onclick = (event) => {
          if (event.target.closest("button, a, input, select")) return;
          reviewEncyclopedia(card.dataset.encyclopediaCard);
        };
      });
      const summary = backdrop.querySelector("[data-encyclopedia-summary]");
      summary.hidden = encyclopediaMatches.length === 0;
      summary.textContent = encyclopediaMatches.length > visibleEntries.length
        ? `Enciclopedia: mostrando ${visibleEntries.length.toLocaleString("es-CL")} de ${encyclopediaMatches.length.toLocaleString("es-CL")} coincidencias. Escribe más detalles para reducir la búsqueda.`
        : `Enciclopedia: ${encyclopediaMatches.length.toLocaleString("es-CL")} coincidencias verificables en el índice.`;
    };
    const updateLocalProgress = (status) => {
      localStatus = status || localStatus;
      const progress = backdrop.querySelector("[data-model-progress]");
      if (!progress) return;
      const percent = localStatus.modelSizeBytes
        ? Math.max(0, Math.min(100, Math.round((localStatus.downloadedBytes || 0) / localStatus.modelSizeBytes * 100)))
        : 0;
      progress.hidden = localStatus.state !== "downloading";
      progress.querySelector("i").style.width = `${percent}%`;
      progress.querySelector("span").textContent = `${percent}% · ${localStatus.detail || "Descargando y verificando…"}`;
      backdrop.querySelector("[data-model-status]").textContent = localStatus.detail || "";
      const setupProgress = document.querySelector("[data-ai-setup-progress]");
      if (setupProgress) {
        setupProgress.hidden = localStatus.state !== "downloading";
        setupProgress.querySelector("i").style.width = `${percent}%`;
        setupProgress.querySelector("span").textContent = `${percent}% · ${localStatus.detail || "Descargando y verificando…"}`;
      }
      const setupStatus = document.querySelector("[data-ai-setup-status]");
      if (setupStatus && localStatus.detail) setupStatus.textContent = localStatus.detail;
    };
    const reviewModel = (modelId) => {
      const model = localModels.find((entry) => entry.id === modelId);
      if (!model) return;
      const installed = (localStatus.installedModelIds || []).includes(model.id);
      const requiresConfirmation = model.compatibility === "experimental";
      const layer = openAiSetup({
        badge: installed ? "INSTALADA" : model.compatibility === "recommended" ? "COMPATIBLE CON ESTE EQUIPO" : model.compatibility === "compatible" ? "COMPATIBLE" : "REQUIERE MÁS RECURSOS",
        title: model.label,
        subtitle: installed ? "Configuración de modelo local" : "Instalador de modelo local DORN",
        content: `<div class="dorn-model-review">
        <p>${escapeHtml(model.warning)}</p>
        <div class="dorn-model-review-grid">
          <span><small>MODELO</small><strong>${escapeHtml(model.parameterClass)}</strong></span>
          <span><small>DESCARGA</small><strong>${escapeHtml(model.estimatedDownload)}</strong></span>
          <span><small>RAM RECOMENDADA</small><strong>${escapeHtml(model.recommendedRam)}</strong></span>
          <span><small>CONTEXTO CONFIGURADO</small><strong>${escapeHtml(model.contextTokens.toLocaleString("es-CL"))} tokens</strong></span>
          <span><small>LICENCIA</small><strong>${escapeHtml(model.license)}</strong></span>
          <span><small>ORIGEN</small><strong>${escapeHtml(model.publisher)}</strong></span>
        </div>
        <p><strong>Sirve para:</strong> ${escapeHtml((model.tasks || []).join(" · "))}</p>
        <ol class="dorn-ai-install-steps"><li class="done"><b>1</b><span>Compatibilidad revisada</span></li><li><b>2</b><span>Descarga reanudable</span></li><li><b>3</b><span>SHA-256 y licencia</span></li><li><b>4</b><span>Activación en Router</span></li></ol>
        ${requiresConfirmation ? `<label class="dorn-ai-risk"><input type="checkbox" data-ai-risk> Entiendo que este modelo pide ${escapeHtml(model.recommendedRam)} y puede funcionar con lentitud o quedarse sin memoria.</label>` : ""}
        <div class="dorn-model-progress" data-ai-setup-progress hidden><i></i><span></span></div>
        <p class="dorn-inline-status" data-ai-setup-status>${installed ? "El modelo está listo para seleccionarse." : "DORN verificará el archivo antes de activarlo."}</p>
        <small>La instalación no promete velocidad ni calidad idénticas en todos los equipos. DORN validará el archivo completo antes de utilizarlo.</small>
      </div>`,
        actions: `<button class="dorn-cc-primary" data-model-confirm="${escapeHtml(model.id)}" ${requiresConfirmation ? "disabled" : ""}>${installed ? "Seleccionar y usar" : `Instalar · ${escapeHtml(model.estimatedDownload)}`}</button>`
      });
      const confirm = layer.querySelector("[data-model-confirm]");
      const risk = layer.querySelector("[data-ai-risk]");
      if (risk) risk.onchange = () => { confirm.disabled = !risk.checked; };
      confirm.onclick = async (event) => {
        event.currentTarget.disabled = true;
        const previousText = event.currentTarget.textContent;
        event.currentTarget.textContent = installed ? "Activando…" : "Preparando descarga…";
        try {
          await window.dorn.localRuntime.select(model.id);
          if (!installed) await window.dorn.localRuntime.download();
          localStatus = await window.dorn.localRuntime.status();
          backdrop.querySelector("[data-model-status]").textContent = `${model.label} está instalada y seleccionada. Puedes usarla en el Router IA.`;
          event.currentTarget.textContent = "IA seleccionada";
          layer.querySelector("[data-ai-setup-status]").textContent = "Instalación verificada. El Router Automático la tendrá disponible desde el próximo mensaje.";
          filterModels();
        } catch (error) {
          backdrop.querySelector("[data-model-status]").textContent = error.message || String(error);
          event.currentTarget.disabled = false;
          event.currentTarget.textContent = previousText;
        }
      };
    };
    const reviewConnector = async (name) => {
      const guide = await window.dorn.v3.suite.help.provider(name);
      const connector = AI_CONNECTORS.find((entry) => entry.name === name);
      const connectorResources = connector ? providerResources(connector.id) : guide?.officialUrl ? [{ label: "Sitio oficial", url: guide.officialUrl }] : [];
      const presetKey = connector ? AI_PRESET_KEYS[connector.id] : "";
      const preset = presetKey ? providerPresets.find((entry) => entry.key === presetKey) : null;
      const connectorReady = Boolean(preset);
      const automaticReady = preset?.quickConnect?.ready === true;
      const layer = openAiSetup({
        badge: connector?.kind || "CONEXIÓN IA",
        title: guide?.name || name,
        subtitle: connector?.kind?.toLowerCase().startsWith("local") ? "Conectar servidor instalado" : "Configurar cuenta y API",
        content: `<div class="dorn-model-review">
          <p>${escapeHtml(guide?.purpose || "DORN preparará una conexión editable. Define la dirección, autenticación y modelo, y prueba la respuesta antes de guardarla.")}</p>
          <div class="dorn-model-review-grid">
            <span><small>BASE URL SUGERIDA</small><strong>${escapeHtml(guide?.quickFields?.baseUrl || "Configurable")}</strong></span>
            <span><small>RUTA</small><strong>${escapeHtml(guide?.quickFields?.endpoint || "Configurable")}</strong></span>
            <span><small>AUTENTICACIÓN</small><strong>${escapeHtml(guide?.quickFields?.authType || "Configurable")}</strong></span>
          </div>
          <ol>${(guide?.steps || ["Abre la web oficial y crea una cuenta o instala el servidor local.", "Obtén la clave o activa el endpoint local.", "Completa los campos en DORN y prueba la conexión.", "Guarda; el Router Automático la verá de inmediato."]).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
          ${(guide?.notes || []).map((note) => `<p><strong>Importante:</strong> ${escapeHtml(note)}</p>`).join("")}
          <p>DORN aplicará la plantilla, cabeceras y ruta de respuesta del proveedor, consultará los modelos reales y activará la conexión sólo después de una respuesta de prueba.</p>
          ${automaticReady && preset.quickConnect.requiresApiKey ? `<label class="dorn-field"><span>Clave API de ${escapeHtml(preset.name)}</span><input type="password" data-ai-connector-key maxlength="2000" autocomplete="off" placeholder="Pega la clave; DORN configura lo demás"></label>` : ""}
          <p class="dorn-inline-status" data-ai-connector-status>${automaticReady ? preset.quickConnect.requiresApiKey ? "Sólo falta la clave API." : "La conexión local no necesita clave." : "Esta IA necesita datos adicionales y se abrirá en modo avanzado."}</p>
        </div>`,
        actions: `${automaticReady ? '<button class="dorn-cc-primary" data-ai-connector-auto>Conectar automáticamente</button>' : ""}<button class="dorn-cc-secondary" data-ai-connector-config>${connectorReady ? "Revisar opciones avanzadas" : "Conexión avanzada"}</button>${connectorResources.map((resource) => `<a class="dorn-cc-secondary dorn-link-button" href="${escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(resource.label)}</a>`).join("")}`
      });
      const automaticButton = layer.querySelector("[data-ai-connector-auto]");
      if (automaticButton) automaticButton.onclick = async (event) => {
        const status = layer.querySelector("[data-ai-connector-status]");
        const apiKey = layer.querySelector("[data-ai-connector-key]")?.value.trim() || "";
        if (preset.quickConnect.requiresApiKey && !apiKey) {
          status.textContent = `Pega la clave API de ${preset.name}.`;
          return;
        }
        event.currentTarget.disabled = true;
        status.textContent = "Cifrando la clave, cargando modelos y probando una respuesta real…";
        try {
          const result = await window.dorn.providers.quickConnect({ presetKey, apiKey });
          if (layer.querySelector("[data-ai-connector-key]")) layer.querySelector("[data-ai-connector-key]").value = "";
          await refreshProviderList(result.provider.id);
          status.textContent = `Lista y activa · ${result.provider.name} · ${result.selectedModel}`;
          event.currentTarget.textContent = "Conexión verificada";
        } catch (error) {
          await refreshProviderList();
          status.textContent = error.message || String(error);
          event.currentTarget.disabled = false;
        }
      };
      layer.querySelector("[data-ai-connector-config]").onclick = () => {
        closeAiSetup();
        show("connections");
        writeProviderForm(preset ? { ...preset.draft, id: "", locked: false } : { ...blankProvider(), name });
        backdrop.querySelector("[data-provider-status]").textContent = preset
          ? "DORN cargó el preset completo. Modifica estas opciones sólo si el proveedor requiere una configuración especial."
          : "Esta conexión aún no tiene un preset automático y necesita revisión avanzada.";
      };
    };

    show(initialTab);
    void loadPromptCatalog();
    renderProviderList();
    writeProviderForm(configuredProviders.find((provider) => provider.id === selectedProviderId) || blankProvider());
    const catalogGrid = backdrop.querySelector("[data-model-grid]");
    [...catalogGrid.querySelectorAll("[data-model-card]")].sort((left, right) => left.dataset.name.localeCompare(right.dataset.name, "es", { sensitivity: "base" })).forEach((card) => catalogGrid.appendChild(card));
    filterModels();
    refreshPalettePreview();
    const gamerPage = backdrop.querySelector('[data-page="gamers"]');
    const updateGamerState = () => gamerPage.classList.toggle("profile-disabled", !backdrop.querySelector("[data-gamer-enabled]").checked);
    updateGamerState();
    const developerPage = backdrop.querySelector('[data-page="developer"]');
    const updateDeveloperState = () => developerPage.classList.toggle("profile-disabled", !backdrop.querySelector("[data-developer-enabled]").checked);
    updateDeveloperState();
    const renderLinuxStatus = (status) => {
      linuxStatus = status || linuxStatus;
      backdrop.querySelector("[data-linux-state]").textContent = linuxStateLabel(linuxStatus.state);
      backdrop.querySelector("[data-linux-detail]").textContent = linuxStateDetail(linuxStatus.state);
      backdrop.querySelector("[data-linux-default]").textContent = linuxStatus.defaultDistro || "No detectada";
      backdrop.querySelector("[data-linux-storage]").textContent = linuxStatus.storageMode || "Sin comprobar";
      const distroSelect = backdrop.querySelector("[data-linux-distro]");
      const previous = distroSelect.value;
      const distributions = linuxStatus.distributions?.length ? linuxStatus.distributions : [{ name: "Ubuntu", wslVersion: 2 }];
      distroSelect.innerHTML = distributions.map((entry) => `<option value="${escapeHtml(entry.name)}">${escapeHtml(entry.name)} · WSL ${escapeHtml(entry.wslVersion || "—")}</option>`).join("");
      distroSelect.value = distributions.some((entry) => entry.name === previous)
        ? previous
        : linuxStatus.defaultDistro || distributions[0].name;
      backdrop.querySelector("[data-linux-toolchain]").disabled = linuxStatus.state !== "READY";
    };
    renderLinuxStatus(linuxStatus);
    const unsubscribeLocal = window.dorn.localRuntime.onStatus(updateLocalProgress);
    const closeCenter = () => {
      unsubscribeLocal?.();
      closeAiSetup();
      backdrop.remove();
    };
    backdrop.querySelector(".dorn-cc-close").onclick = closeCenter;
    backdrop.onclick = (event) => { if (event.target === backdrop) closeCenter(); };
    backdrop.querySelectorAll("[data-tab]").forEach((button) => button.onclick = () => show(button.dataset.tab));
    backdrop.querySelectorAll("[data-mode]").forEach((button) => button.onclick = async () => {
      const selected = await window.dorn.v3.suite.modes.select(button.dataset.mode, projectId);
      backdrop.querySelectorAll("[data-mode]").forEach((entry) => entry.classList.toggle("active", entry.dataset.mode === selected.id));
      updateTrigger(selected);
    });
    backdrop.querySelectorAll("[data-response-strategy]").forEach((button) => button.onclick = async () => {
      const selected = await window.dorn.v3.suite.modes.selectStrategy(button.dataset.responseStrategy, projectId);
      backdrop.querySelectorAll("[data-response-strategy]").forEach((entry) => entry.classList.toggle("active", entry.dataset.responseStrategy === selected.id));
      backdrop.querySelector("[data-strategy-status]").textContent = selected.id === "multi"
        ? "Varias IAs activado. DORN pedirá confirmación y mostrará el equipo antes de cada respuesta."
        : "Una IA por respuesta activado. El cambio entre claves equivalentes queda sólo como respaldo ante errores o cuota.";
    });
    const updateQuickConnectState = (preset = null) => {
      const button = backdrop.querySelector("[data-provider-quick-connect]");
      const keyInput = backdrop.querySelector("[data-provider-quick-key]");
      const policy = preset?.quickConnect || { ready: false, requiresApiKey: false };
      button.disabled = !policy.ready;
      keyInput.disabled = !preset || !policy.ready || !policy.requiresApiKey;
      keyInput.placeholder = policy.requiresApiKey ? "La clave se cifra y no entra al JSON" : "Esta conexión no necesita clave";
      if (!preset) return;
      backdrop.querySelector("[data-provider-status]").textContent = policy.ready
        ? policy.requiresApiKey
          ? "Pega sólo la clave. DORN completará y probará toda la conexión antes de activarla."
          : "DORN comprobará el servidor local y elegirá un modelo disponible."
        : "Esta guía necesita un dato adicional. Usa Opciones avanzadas; DORN conservará la plantilla base.";
    };
    backdrop.querySelector("[data-provider-preset]").onchange = (event) => {
      const preset = providerPresets.find((entry) => entry.key === event.target.value);
      if (preset) writeProviderForm({ ...preset.draft, id: "", locked: false });
      updateQuickConnectState(preset || null);
    };
    backdrop.querySelector("[data-provider-quick-connect]").onclick = async (event) => {
      const status = backdrop.querySelector("[data-provider-status]");
      const presetKey = backdrop.querySelector("[data-provider-preset]").value;
      const preset = providerPresets.find((entry) => entry.key === presetKey);
      if (!preset?.quickConnect?.ready) {
        status.textContent = "Elige una IA disponible para conexión automática.";
        return;
      }
      const apiKey = backdrop.querySelector("[data-provider-quick-key]").value.trim();
      if (preset.quickConnect.requiresApiKey && !apiKey) {
        status.textContent = `Pega la clave API de ${preset.name}.`;
        return;
      }
      event.currentTarget.disabled = true;
      status.textContent = "Cifrando la clave, consultando modelos y probando una respuesta real…";
      try {
        const result = await window.dorn.providers.quickConnect({ presetKey, apiKey });
        backdrop.querySelector("[data-provider-quick-key]").value = "";
        await refreshProviderList(result.provider.id);
        status.textContent = `Conexión verificada y activa · ${result.provider.name} · ${result.selectedModel}${result.modelDiscoveryWarning ? " · El endpoint de modelos no respondió, pero la conversación real sí pasó." : ""}`;
      } catch (error) {
        await refreshProviderList();
        status.textContent = error.message || String(error);
      } finally {
        updateQuickConnectState(preset);
      }
    };
    backdrop.querySelector("[data-provider-new]").onclick = () => {
      const presetKey = backdrop.querySelector("[data-provider-preset]").value;
      const preset = providerPresets.find((entry) => entry.key === presetKey);
      writeProviderForm(preset ? { ...preset.draft, id: "", locked: false } : blankProvider());
    };
    backdrop.querySelector("[data-provider-save]").onclick = async (event) => {
      const status = backdrop.querySelector("[data-provider-status]");
      event.currentTarget.disabled = true;
      status.textContent = "Validando y guardando la conexión…";
      try {
        const saved = await window.dorn.providers.save(readProviderForm());
        await refreshProviderList(saved.id);
        const group = await window.dorn.providers.groupStatus(saved.id);
        const verification = saved.connectionReverified ? " Configuración técnica probada nuevamente antes de activarla." : "";
        status.textContent = group.connections.length > 1
          ? "Conexión guardada. Grupo automático activo con " + group.connections.length + " conexiones equivalentes." + verification
          : "Conexión guardada. El Router Automático ya la considera; no necesitas activarlo de nuevo." + verification;
      } catch (error) {
        status.textContent = error.message || String(error);
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    backdrop.querySelector("[data-provider-test]").onclick = async (event) => {
      const status = backdrop.querySelector("[data-provider-status]");
      if (!providerField("id").value) {
        status.textContent = "Guarda primero la conexión para poder probarla.";
        return;
      }
      event.currentTarget.disabled = true;
      status.textContent = "Probando autenticación, dirección y respuesta…";
      try {
        const result = await window.dorn.providers.test(providerField("id").value);
        const group = await window.dorn.providers.groupStatus(providerField("id").value);
        status.textContent = (result?.message || "Conexión verificada correctamente.") + (group.connections.length > 1 ? " · Grupo automático: " + group.connections.length + " conexiones." : "");
      } catch (error) {
        status.textContent = error.message || String(error);
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    backdrop.querySelector("[data-provider-load-models]").onclick = async (event) => {
      const status = backdrop.querySelector("[data-provider-status]");
      const id = providerField("id").value;
      if (!id) {
        status.textContent = "Guarda primero la conexión para consultar sus modelos.";
        return;
      }
      event.currentTarget.disabled = true;
      status.textContent = "Consultando los modelos realmente disponibles…";
      try {
        const models = await window.dorn.providers.models(id);
        backdrop.querySelector("[data-provider-model-options]").innerHTML = models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`).join("");
        status.textContent = `${models.length.toLocaleString("es-CL")} modelos cargados. Elige uno en el campo Modelo.`;
      } catch (error) {
        status.textContent = error.message || String(error);
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    backdrop.querySelector("[data-provider-remove]").onclick = async (event) => {
      const id = providerField("id").value;
      const provider = configuredProviders.find((entry) => entry.id === id);
      if (!provider || provider.locked || !window.confirm(`¿Eliminar la conexión “${provider.name}”? La clave cifrada asociada también se eliminará.`)) return;
      event.currentTarget.disabled = true;
      try {
        await window.dorn.providers.remove(id);
        await refreshProviderList();
        backdrop.querySelector("[data-provider-status]").textContent = "Conexión eliminada. El Router Automático ya actualizó sus opciones.";
      } catch (error) {
        backdrop.querySelector("[data-provider-status]").textContent = error.message || String(error);
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    const backgroundStatus = backdrop.querySelector("[data-background-status]");
    const refreshBackgroundUi = () => {
      const preview = backdrop.querySelector("[data-background-preview]");
      const image = backdrop.querySelector("[data-background-preview-image]");
      const empty = backdrop.querySelector("[data-background-empty]");
      preview.classList.toggle("active", appearance.backgroundMode === "image" && Boolean(appearance.backgroundImage));
      if (appearance.backgroundImage) {
        image.src = appearance.backgroundImage;
        image.hidden = false;
        empty.hidden = true;
      } else {
        image.removeAttribute("src");
        image.hidden = true;
        empty.hidden = false;
      }
      backdrop.querySelector("[data-background-upload]").textContent = appearance.backgroundImage ? "Reemplazar imagen o GIF" : "Elegir imagen o GIF";
      backdrop.querySelector("[data-background-remove]").disabled = !appearance.backgroundImage;
      backdrop.querySelector("[data-background-fit]").value = appearance.backgroundFit;
      backdrop.querySelector("[data-background-strength]").value = appearance.backgroundStrength;
      backdrop.querySelector("[data-background-strength-label]").textContent = `${appearance.backgroundStrength}%`;
      backdrop.querySelector("[data-background-blur]").value = appearance.backgroundBlur;
      backdrop.querySelector("[data-background-blur-label]").textContent = `${appearance.backgroundBlur}px`;
      backdrop.querySelector("[data-background-tint]").value = appearance.backgroundTint;
      backdrop.querySelector("[data-background-tint-label]").textContent = `${appearance.backgroundTint}%`;
      backdrop.querySelector("[data-background-blend]").value = appearance.backgroundBlend;
    };
    backdrop.querySelector("[data-background-upload]").onclick = async (event) => {
      event.currentTarget.disabled = true;
      try {
        const result = await window.dorn.appearance.pickBackground();
        if (result.canceled) return;
        appearance = applyAppearance(result.appearance, { sync: false });
        refreshBackgroundUi();
        backgroundStatus.classList.remove("warning");
        backgroundStatus.textContent = appearance.backgroundOriginalName
          ? "Fondo aplicado sin cargarlo completo en memoria: " + appearance.backgroundOriginalName
          : "Fondo aplicado sin cargarlo completo en memoria.";
      } catch (error) {
        backgroundStatus.classList.add("warning");
        backgroundStatus.textContent = error.message || String(error);
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    backdrop.querySelector("[data-background-color]").onclick = () => {
      appearance = applyAppearance({ ...appearance, backgroundMode: "color" });
      refreshBackgroundUi();
      backgroundStatus.textContent = "DORN usa ahora el color de la paleta. La imagen queda disponible para volver a activarla.";
    };
    backdrop.querySelector("[data-background-remove]").onclick = async (event) => {
      event.currentTarget.disabled = true;
      try {
        appearance = applyAppearance(await window.dorn.appearance.removeBackground(), { sync: false });
        refreshBackgroundUi();
        backgroundStatus.textContent = "El archivo de fondo fue eliminado de la personalización local.";
      } catch (error) {
        backgroundStatus.classList.add("warning");
        backgroundStatus.textContent = error.message || String(error);
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    backdrop.querySelector("[data-background-fit]").onchange = (event) => {
      appearance = applyAppearance({ ...appearance, backgroundFit: event.target.value, backgroundMode: appearance.backgroundImage ? "image" : "color" });
      refreshBackgroundUi();
    };
    backdrop.querySelector("[data-background-blend]").onchange = (event) => {
      appearance = applyAppearance({ ...appearance, backgroundBlend: event.target.value, backgroundMode: appearance.backgroundImage ? "image" : "color" });
      refreshBackgroundUi();
    };
    for (const [selector, key, labelSelector, suffix] of [
      ["[data-background-strength]", "backgroundStrength", "[data-background-strength-label]", "%"],
      ["[data-background-blur]", "backgroundBlur", "[data-background-blur-label]", "px"],
      ["[data-background-tint]", "backgroundTint", "[data-background-tint-label]", "%"]
    ]) {
      const input = backdrop.querySelector(selector);
      input.oninput = () => { backdrop.querySelector(labelSelector).textContent = `${input.value}${suffix}`; };
      input.onchange = () => {
        appearance = applyAppearance({ ...appearance, [key]: Number(input.value), backgroundMode: appearance.backgroundImage ? "image" : "color" });
        refreshBackgroundUi();
      };
    }
    backdrop.querySelectorAll("[data-theme]").forEach((button) => button.onclick = () => {
      appearance = applyAppearance({ ...appearance, theme: button.dataset.theme });
      writePaletteInputs(PALETTES[appearance.theme]);
      backdrop.querySelectorAll("[data-theme]").forEach((entry) => entry.classList.toggle("active", entry.dataset.theme === appearance.theme));
    });
    backdrop.querySelector("[data-density]").onclick = (event) => {
      appearance = applyAppearance({ ...appearance, density: appearance.density === "compact" ? "comfortable" : "compact" });
      event.currentTarget.textContent = appearance.density === "compact" ? "Densidad: compacta" : "Densidad: cómoda";
    };
    backdrop.querySelector("[data-motion]").onclick = (event) => {
      appearance = applyAppearance({ ...appearance, motion: appearance.motion === "reduced" ? "full" : "reduced" });
      event.currentTarget.textContent = appearance.motion === "reduced" ? "Movimiento: reducido" : "Movimiento: completo";
    };
    const previewWindowEffect = () => {
      const panel = backdrop.querySelector(".dorn-cc-panel");
      panel.style.animation = "none";
      void panel.offsetWidth;
      panel.style.removeProperty("animation");
    };
    const windowEffectInput = backdrop.querySelector("[data-window-effect]");
    windowEffectInput.onchange = () => {
      appearance = applyAppearance({ ...appearance, windowEffect: windowEffectInput.value });
      previewWindowEffect();
    };
    const motionIntensityInput = backdrop.querySelector("[data-motion-intensity]");
    motionIntensityInput.onchange = () => {
      appearance = applyAppearance({ ...appearance, motionIntensity: motionIntensityInput.value });
      previewWindowEffect();
    };
    backdrop.querySelector("[data-preview-window-effect]").onclick = previewWindowEffect;
    backdrop.querySelector("[data-contrast]").onclick = (event) => {
      appearance = applyAppearance({ ...appearance, contrast: appearance.contrast === "high" ? "normal" : "high" });
      event.currentTarget.textContent = appearance.contrast === "high" ? "Contraste: alto" : "Contraste: normal";
    };
    backdrop.querySelectorAll("[data-palette-color]").forEach((picker) => {
      picker.oninput = () => {
        const input = backdrop.querySelector(`[data-palette-hex="${picker.dataset.paletteColor}"]`);
        input.value = picker.value.toLowerCase();
        input.classList.remove("invalid");
        refreshPalettePreview();
      };
    });
    backdrop.querySelectorAll("[data-palette-hex]").forEach((input) => {
      input.oninput = () => {
        const valid = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(input.value.trim());
        input.classList.toggle("invalid", !valid);
        if (!valid) return;
        const value = normalizeHex(input.value, "#000000");
        backdrop.querySelector(`[data-palette-color="${input.dataset.paletteHex}"]`).value = value;
        refreshPalettePreview();
      };
    });
    backdrop.querySelector("[data-apply-custom]").onclick = () => {
      if (backdrop.querySelector("[data-palette-hex].invalid")) {
        backdrop.querySelector("[data-color-status]").textContent = "Corrige los colores marcados antes de aplicar.";
        return;
      }
      const customPalette = refreshPalettePreview();
      appearance = applyAppearance({ ...appearance, theme: "custom", customPalette });
      backdrop.querySelectorAll("[data-theme]").forEach((entry) => entry.classList.remove("active"));
      backdrop.querySelector("[data-color-status]").textContent += " Paleta aplicada y guardada en este computador.";
    };
    backdrop.querySelector("[data-reset-colors]").onclick = () => {
      appearance = applyAppearance(DEFAULT_APPEARANCE);
      refreshBackgroundUi();
      writePaletteInputs(PALETTES.graphite);
      backdrop.querySelectorAll("[data-theme]").forEach((entry) => entry.classList.toggle("active", entry.dataset.theme === "graphite"));
      backdrop.querySelector("[data-density]").textContent = "Densidad: cómoda";
      backdrop.querySelector("[data-motion]").textContent = "Movimiento: completo";
      backdrop.querySelector("[data-motion-intensity]").value = "balanced";
      backdrop.querySelector("[data-window-effect]").value = "default";
      backdrop.querySelector("[data-contrast]").textContent = "Contraste: normal";
      backdrop.querySelector("[data-color-status]").textContent += " Apariencia DORN restablecida.";
    };
    backdrop.querySelector("[data-export-colors]").onclick = () => {
      downloadJson("dorn-paleta.json", { schema: "dorn-palette/1", palette: readPaletteInputs() });
    };
    const importPaletteInput = backdrop.querySelector("[data-import-colors-file]");
    backdrop.querySelector("[data-import-colors]").onclick = () => importPaletteInput.click();
    importPaletteInput.onchange = async () => {
      const file = importPaletteInput.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const palette = normalizePalette(parsed.palette || parsed, PALETTES.graphite);
        writePaletteInputs(palette);
        appearance = applyAppearance({ ...appearance, theme: "custom", customPalette: palette });
        backdrop.querySelectorAll("[data-theme]").forEach((entry) => entry.classList.remove("active"));
        backdrop.querySelector("[data-color-status]").textContent += " Paleta importada y aplicada.";
      } catch (error) {
        backdrop.querySelector("[data-color-status]").textContent = `No se pudo importar: ${error.message || error}`;
        backdrop.querySelector("[data-color-status]").classList.add("warning");
      } finally {
        importPaletteInput.value = "";
      }
    };
    backdrop.querySelectorAll("[data-open-models]").forEach((button) => { button.onclick = () => { closeCenter(); openModels(); }; });
    backdrop.querySelector("[data-save-general]").onclick = async () => {
      const status = backdrop.querySelector("[data-general-status]");
      const patch = { permissionMode: backdrop.querySelector("[data-permission-mode]").value };
      backdrop.querySelector('[data-page="general"]').querySelectorAll("[data-pref]").forEach((input) => { patch[input.dataset.pref] = input.checked; });
      try {
        const saved = await window.dorn.settings.save(patch);
        backdrop.querySelector("[data-permission-mode]").value = saved.permissionMode;
        status.textContent = "Configuración guardada en este computador.";
        status.classList.remove("warning");
      } catch (error) {
        status.textContent = `No se pudo guardar: ${error.message || error}`;
        status.classList.add("warning");
      }
    };
    backdrop.querySelector("[data-model-search]").oninput = filterModels;
    backdrop.querySelectorAll("[data-catalog-letter]").forEach((button) => {
      button.onclick = () => {
        activeCatalogLetter = button.dataset.catalogLetter;
        backdrop.querySelectorAll("[data-catalog-letter]").forEach((entry) => entry.classList.toggle("active", entry === button));
        backdrop.querySelector("[data-model-search]").value = "";
        filterModels();
      };
    });
    backdrop.querySelector("[data-model-kind]").onchange = filterModels;
    backdrop.querySelector("[data-model-compatibility]").onchange = filterModels;
    backdrop.querySelector("[data-model-task]").onchange = filterModels;
    backdrop.querySelectorAll("[data-model-review]").forEach((button) => {
      button.onclick = () => reviewModel(button.dataset.modelReview);
    });
    backdrop.querySelectorAll("[data-connector-review]").forEach((button) => {
      button.onclick = () => reviewConnector(button.dataset.connectorReview);
    });
    backdrop.querySelectorAll("[data-model-card]").forEach((card) => {
      card.onclick = (event) => {
        if (event.target.closest("button, a, input, select")) return;
        const modelButton = card.querySelector("[data-model-review]");
        const connectorButton = card.querySelector("[data-connector-review]");
        if (modelButton) reviewModel(modelButton.dataset.modelReview);
        if (connectorButton) reviewConnector(connectorButton.dataset.connectorReview);
      };
    });
    backdrop.querySelectorAll("[data-product-open]").forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          await window.dorn.v3.suite.openProduct(button.dataset.productOpen);
        } catch (error) {
          window.alert(error.message || String(error));
        } finally {
          button.disabled = false;
        }
      };
    });
    backdrop.querySelector("[data-save-preferences]").onclick = async () => {
      const patch = { personality: backdrop.querySelector("[data-personality]").value };
      backdrop.querySelector('[data-page="preferences"]').querySelectorAll("[data-pref]:not(:disabled)").forEach((input) => patch[input.dataset.pref] = input.checked);
      preferences = await window.dorn.v3.suite.preferences.configure(patch);
      voicePreferences = preferences;
      if (preferences.voiceOutsideApp && bootstrap.settings?.closeToTray !== true) {
        await window.dorn.settings.save({ ...bootstrap.settings, closeToTray: true });
      }
      if (!preferences.voiceConversation && voiceHandsFree) {
        voiceHandsFree = false;
        await window.dorn.v3.suite.voice.stopRecognition();
      }
      syncVoiceConversationTrigger(preferences);
      backdrop.querySelector("[data-pref-status]").textContent = "Preferencias guardadas.";
      backdrop.querySelector("[data-gamer-enabled]").checked = preferences.gamers;
      updateGamerState();
    };
    backdrop.querySelector("[data-voice-diagnostics]").onclick = async (event) => {
      const status = backdrop.querySelector("[data-pref-status]");
      event.currentTarget.disabled = true;
      status.textContent = "Comprobando reconocimiento y voces instaladas en Windows…";
      try {
        const result = await window.dorn.v3.suite.voice.diagnostics();
        status.textContent = result.ready
          ? `Voz lista · ${result.recognizers.length} reconocedor(es) · ${result.voices.length} voz(es).`
          : result.message || "Windows no informó un reconocedor y una voz utilizables.";
      } catch (error) {
        status.textContent = error.message || String(error);
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    backdrop.querySelector("[data-gamer-enabled]").onchange = updateGamerState;
    backdrop.querySelector("[data-save-gamers]").onclick = async () => {
      const patch = { gamers: backdrop.querySelector("[data-gamer-enabled]").checked };
      gamerPage.querySelectorAll("[data-gamer]").forEach((input) => patch[input.dataset.gamer] = input.value);
      gamerPage.querySelectorAll("[data-pref]").forEach((input) => patch[input.dataset.pref] = input.checked);
      const status = backdrop.querySelector("[data-gamer-status]");
      try {
        preferences = await window.dorn.v3.suite.preferences.configure(patch);
        if (preferences.gamerBackgroundAssistant && bootstrap.settings?.closeToTray !== true) {
          await window.dorn.settings.save({ ...bootstrap.settings, closeToTray: true });
        }
        const preferencesToggle = backdrop.querySelector('[data-page="preferences"] [data-pref="gamers"]');
        if (preferencesToggle) preferencesToggle.checked = preferences.gamers;
        status.textContent = preferences.gamers
          ? "Perfil Gamers activado. DORN aplicará estas preferencias a los próximos mensajes."
          : "Opciones guardadas. El perfil Gamers permanece desactivado.";
        updateGamerState();
      } catch (error) {
        status.textContent = error.message || String(error);
      }
    };
    const saveDeveloper = async () => {
      const patch = { developerMode: backdrop.querySelector("[data-developer-enabled]").checked };
      developerPage.querySelectorAll("[data-pref]").forEach((input) => { patch[input.dataset.pref] = input.checked; });
      if (patch.developerMode) {
        developerPage.querySelectorAll("[data-pref]").forEach((input) => { input.checked = true; patch[input.dataset.pref] = true; });
      }
      const status = backdrop.querySelector("[data-developer-status]");
      try {
        const security = await window.dorn.developer.setEnabled(patch.developerMode);
        preferences = await window.dorn.v3.suite.preferences.configure(patch);
        status.textContent = preferences.developerMode
          ? `Desarrollador tiene acceso total a todas las áreas y herramientas. ${security.actualUacPerElevatedAction ? "Windows pedirá UAC en cada acción elevada." : "La ruta UAC queda preparada para Windows."}`
          : "Opciones conservadas; el perfil Desarrollador permanece desactivado.";
        syncConsoleTrigger(preferences);
        updateDeveloperState();
        return true;
      } catch (error) {
        status.textContent = error.message || String(error);
        return false;
      }
    };
    backdrop.querySelector("[data-developer-enabled]").onchange = updateDeveloperState;
    backdrop.querySelector("[data-enable-all-developer]").onclick = async () => {
      backdrop.querySelector("[data-developer-enabled]").checked = true;
      developerPage.querySelectorAll("[data-pref]").forEach((input) => { input.checked = true; });
      updateDeveloperState();
      if (await saveDeveloper()) backdrop.querySelector("[data-developer-status]").textContent = "Perfil completo activado. DORN podrá usar todas las áreas de desarrollo dentro del proyecto confirmado.";
    };
    backdrop.querySelector("[data-save-developer]").onclick = saveDeveloper;
    backdrop.querySelector("[data-open-console]").onclick = async () => {
      if (!backdrop.querySelector("[data-developer-enabled]").checked || !developerPage.querySelector('[data-pref="developerConsole"]').checked) {
        backdrop.querySelector("[data-developer-status]").textContent = "Activa Desarrollador y Consola flotante para abrirla.";
        return;
      }
      if (!await saveDeveloper()) return;
      closeCenter();
      await openDeveloperConsole();
    };
    backdrop.querySelector("[data-linux-refresh]").onclick = async (event) => {
      const status = backdrop.querySelector("[data-linux-status]");
      event.currentTarget.disabled = true;
      status.textContent = "Comprobando WSL 2 y distribuciones observadas…";
      status.classList.remove("warning");
      try {
        renderLinuxStatus(await window.dorn.linuxRuntime.status());
        status.textContent = linuxStatus.state === "READY"
          ? `DORN Linux listo · ${linuxStatus.defaultDistro || "distribución WSL 2"}.`
          : linuxStateDetail(linuxStatus.state);
      } catch (error) {
        status.textContent = error.message || String(error);
        status.classList.add("warning");
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    backdrop.querySelector("[data-linux-plan]").onclick = async (event) => {
      const status = backdrop.querySelector("[data-linux-status]");
      event.currentTarget.disabled = true;
      status.textContent = "Preparando un plan sin modificar Windows…";
      status.classList.remove("warning");
      try {
        const plan = await window.dorn.linuxRuntime.setupPlan({ distro: backdrop.querySelector("[data-linux-distro]").value || "Ubuntu" });
        status.textContent = plan.outcome === "READY"
          ? "WSL 2 ya está listo. Revisa los lenguajes y luego deja que DORN cree una Work Unit para el proyecto activo."
          : plan.outcome === "SETUP_REQUIRED"
            ? "Preparación necesaria: vuelve a ejecutar Installer v3 con DORN Linux seleccionado. Windows pedirá permiso y puede requerir reinicio; la instalación principal no se bloqueará."
            : plan.outcome === "CONVERSION_REQUIRED"
              ? `La distribución ${plan.distro} debe convertirse a WSL 2. DORN no hará ese cambio sin una acción elevada y visible.`
              : "El entorno Linux está bloqueado hasta resolver el estado informado por Windows.";
      } catch (error) {
        status.textContent = error.message || String(error);
        status.classList.add("warning");
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    backdrop.querySelector("[data-linux-toolchain]").onclick = async (event) => {
      const status = backdrop.querySelector("[data-linux-status]");
      const output = backdrop.querySelector("[data-linux-toolchain-output]");
      event.currentTarget.disabled = true;
      status.textContent = "Consultando versiones dentro de WSL 2…";
      status.classList.remove("warning");
      try {
        const inventory = await window.dorn.linuxRuntime.toolchain({ distro: backdrop.querySelector("[data-linux-distro]").value });
        output.innerHTML = Object.entries(inventory.tools).map(([name, tool]) => `<span class="${tool.installed ? "ready" : "missing"}"><b>${escapeHtml(name)}</b><small>${escapeHtml(tool.installed ? tool.version || "Instalado" : "No instalado")}</small></span>`).join("");
        const installed = Object.values(inventory.tools).filter((tool) => tool.installed).length;
        status.textContent = `${installed} de ${Object.keys(inventory.tools).length} herramientas detectadas en ${inventory.distro}.`;
      } catch (error) {
        status.textContent = error.message || String(error);
        status.classList.add("warning");
      } finally {
        event.currentTarget.disabled = linuxStatus.state !== "READY";
      }
    };
  }

  function updateTrigger(mode) {
    const label = document.querySelector("[data-dorn-mode-label]");
    if (label) label.textContent = mode.id === "manual" ? "IA manual" : `IA ${mode.label.toLowerCase()}`;
  }

  function syncConsoleTrigger(preferences) {
    const header = document.querySelector(".header-tools");
    if (!header) return;
    let trigger = header.querySelector("[data-dorn-console]");
    if (!preferences?.developerMode || !preferences?.developerConsole) {
      trigger?.remove();
      return;
    }
    if (trigger) return;
    trigger = document.createElement("button");
    trigger.className = "dorn-console-trigger";
    trigger.dataset.dornConsole = "true";
    trigger.title = "Abrir Consola DORN";
    trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 9l3 3-3 3M13 15h4"></path></svg><span>Consola</span>';
    trigger.onclick = openDeveloperConsole;
    header.prepend(trigger);
  }

  async function toggleVoiceConversation() {
    if (voiceHandsFree) {
      voiceHandsFree = false;
      await window.dorn.v3.suite.voice.stopRecognition();
      setVoiceState("idle", "Modo manos libres detenido.");
      document.querySelector("[data-dorn-voice-conversation]")?.classList.remove("active");
      return;
    }
    voicePreferences = await window.dorn.v3.suite.preferences.get();
    if (!voicePreferences.voiceConversation) {
      await openCenter("preferences");
      return;
    }
    document.querySelectorAll(".assistant-message").forEach((message) => message.dataset.dornVoiceSeen = "true");
    voiceHandsFree = true;
    try {
      await window.dorn.v3.suite.voice.startRecognition("es-CL");
      document.querySelector("[data-dorn-voice-conversation]")?.classList.add("active");
      setVoiceState("starting", voicePreferences.voiceWake === false ? "Modo manos libres activo." : "Modo manos libres activo · comienza diciendo DORN.");
    } catch (error) {
      voiceHandsFree = false;
      setVoiceState("error", error.message || String(error));
    }
  }

  function syncVoiceConversationTrigger(preferences) {
    const header = document.querySelector(".header-tools");
    if (!header) return;
    voicePreferences = preferences || voicePreferences;
    let trigger = header.querySelector("[data-dorn-voice-conversation]");
    if (!preferences?.voiceConversation) {
      trigger?.remove();
      return;
    }
    if (trigger) return;
    trigger = document.createElement("button");
    trigger.className = "dorn-voice-conversation-trigger";
    trigger.dataset.dornVoiceConversation = "true";
    trigger.title = "Iniciar modo manos libres";
    trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14a8 8 0 0 1 16 0"></path><path d="M4 14v4a2 2 0 0 0 2 2h2v-7H6a2 2 0 0 0-2 2M20 14v4a2 2 0 0 1-2 2h-2v-7h2a2 2 0 0 1 2 2"></path></svg><span>Voz</span>';
    trigger.onclick = toggleVoiceConversation;
    header.prepend(trigger);
  }

  window.dornControlCenter = Object.freeze({
    open: (tab = "router") => openCenter(tab),
    appearance: () => readAppearance(),
    console: () => openDeveloperConsole()
  });

  function placeProductPrompt(payload = queuedProductPrompt) {
    if (!payload?.content) return false;
    const textarea = document.querySelector(".composer-box textarea");
    if (!textarea || textarea.disabled) {
      queuedProductPrompt = payload;
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    const prefix = payload.productLabel ? `[Contexto desde ${payload.productLabel}]\n` : "";
    descriptor?.set?.call(textarea, `${prefix}${payload.content}`);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
    queuedProductPrompt = null;
    return true;
  }

  async function mount() {
    applyAppearance(readAppearance());
    syncVoiceDictation();
    if (!productPromptBound) {
      window.dorn.v3.suite.onProductPrompt((payload) => {
        queuedProductPrompt = payload;
        if (!placeProductPrompt(payload)) setTimeout(() => placeProductPrompt(payload), 800);
      });
      productPromptBound = true;
    }
    if (!approvalPromptBound) {
      window.dorn.chat.onEvent((event) => {
        if (event?.type === "approval_required") showApprovalPanel(event);
        if (event?.type === "approval_resolved") closeApprovalPanel(event.conversationId);
        if (event?.type === "ui_action" && event.action?.type === "open-control-center") openCenter(event.action.tab || "connections");
      });
      approvalPromptBound = true;
    }
    if (queuedProductPrompt) placeProductPrompt();
    const header = document.querySelector(".header-tools");
    if (!header) return false;
    const [mode, preferences] = await Promise.all([
      window.dorn.v3.suite.modes.current(null),
      window.dorn.v3.suite.preferences.get()
    ]);
    if (!header.querySelector("[data-dorn-control]")) {
      const trigger = document.createElement("button");
      trigger.className = "dorn-cc-trigger active";
      trigger.dataset.dornControl = "true";
      trigger.title = "Router, catálogo, productos y preferencias";
      trigger.innerHTML = `<span class="dorn-cc-trigger-dot"></span><span data-dorn-mode-label>${mode.id === "manual" ? "IA manual" : `IA ${mode.label.toLowerCase()}`}</span>`;
      trigger.onclick = () => openCenter("router");
      header.prepend(trigger);
    }
    syncConsoleTrigger(preferences);
    syncVoiceConversationTrigger(preferences);
    return true;
  }

  const timer = setInterval(async () => {
    try {
      if (await mount()) clearInterval(timer);
    } catch {
      // La aplicación todavía está cargando.
    }
  }, 400);
  setInterval(syncVoiceDictation, 900);
})();
