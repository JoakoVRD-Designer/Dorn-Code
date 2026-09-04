"use strict";

const path = require("node:path");
const { atomicJson, now, readJson } = require("./common");

const PROMPT_EXPLORER_SCHEMA = "dorn.prompt-explorer/1";
const EXTERNAL_REFERENCE = "https://uiprompt.art/ui-prompt-gallery";

const BUILTIN_PROMPTS = Object.freeze([
  {
    id: "precision-command-center",
    title: "Precision Command Center",
    category: "Dashboard",
    layout: "Sidebar + command canvas",
    aesthetic: "Industrial oscuro",
    description: "Panel operacional denso, legible y verificable para datos, alertas y acciones críticas.",
    tags: ["dashboard", "datos", "industrial", "accesible"],
    palette: ["#090b0d", "#14181c", "#d8dde2", "#7ee0c3"],
    prompt: "Diseña una interfaz de centro de mando para {{platform}} usando {{framework}}. Objetivo del usuario: {{brief}}. Aplica una estética {{theme}} industrial y precisa: sidebar compacta, jerarquía tipográfica fuerte, métricas con contexto, estados semánticos que no dependan sólo del color, tablas escaneables, comandos primarios inequívocos y densidad adaptable. Incluye estados vacío, carga, error, permisos y confirmación destructiva. Entrega responsive, teclado completo, WCAG AA y componentes reutilizables."
  },
  {
    id: "editorial-launch",
    title: "Editorial Product Launch",
    category: "Landing",
    layout: "Narrativa por secciones",
    aesthetic: "Editorial premium",
    description: "Landing profesional con ritmo narrativo, demostración de producto y conversión sin ruido visual.",
    tags: ["landing", "marketing", "editorial", "producto"],
    palette: ["#f4f1ea", "#ffffff", "#171717", "#d15f3f"],
    prompt: "Crea una landing de lanzamiento para {{platform}} con {{framework}}. Producto y audiencia: {{brief}}. Dirección {{theme}} editorial premium: hero con propuesta concreta, demostración visual del producto, prueba social verificable, comparación honesta, casos de uso, precios claros y CTA coherente. Usa composición asimétrica controlada, tipografía expresiva, movimiento con propósito y una versión reducida para prefers-reduced-motion. Evita clichés, gradientes gratuitos y texto genérico."
  },
  {
    id: "calm-saas-workspace",
    title: "Calm SaaS Workspace",
    category: "SaaS",
    layout: "Workspace de tres zonas",
    aesthetic: "Minimalismo cálido",
    description: "Aplicación SaaS serena para trabajo prolongado, onboarding gradual y colaboración.",
    tags: ["saas", "workspace", "colaboración", "productividad"],
    palette: ["#f6f7f3", "#ffffff", "#22251f", "#68745f"],
    prompt: "Diseña un workspace SaaS para {{platform}} en {{framework}}. Necesidad principal: {{brief}}. Estilo {{theme}} minimalista cálido, con navegación persistente, área de trabajo flexible y panel contextual que aparezca sólo cuando aporta valor. Define onboarding progresivo, colaboración, historial, autosave, conflictos, estados offline y recuperación. Prioriza accesibilidad, atajos visibles y contenido realista sobre decoración."
  },
  {
    id: "atelier-portfolio",
    title: "Atelier Portfolio",
    category: "Portfolio",
    layout: "Galería modular",
    aesthetic: "Estudio creativo",
    description: "Portafolio visual de alta gama donde cada proyecto conserva protagonismo y contexto.",
    tags: ["portfolio", "galería", "creativo", "casos"],
    palette: ["#0d0d0f", "#19191d", "#f3f0ea", "#d7a86e"],
    prompt: "Crea un portafolio para {{platform}} con {{framework}}. Perfil y trabajos: {{brief}}. Dirección {{theme}} de estudio creativo: portada tipográfica memorable, galería modular, fichas de proyecto con problema/proceso/resultado, navegación por teclado, imágenes responsivas y transiciones sobrias. Evita convertir cada bloque en una tarjeta. Mantén lectura excelente, carga rápida y una ruta de contacto evidente."
  },
  {
    id: "trustworthy-commerce",
    title: "Trustworthy Commerce",
    category: "Commerce",
    layout: "Catálogo + compra guiada",
    aesthetic: "Comercio humano",
    description: "Tienda confiable con comparación, información completa y compra sin patrones manipulativos.",
    tags: ["ecommerce", "catálogo", "checkout", "confianza"],
    palette: ["#fcfaf6", "#ffffff", "#25211c", "#bb6d45"],
    prompt: "Diseña una experiencia de comercio para {{platform}} en {{framework}}. Catálogo y cliente: {{brief}}. Estética {{theme}} humana y confiable. Incluye descubrimiento, filtros comprensibles, comparación, disponibilidad, variantes, envío, devoluciones, carrito persistente y checkout breve. Muestra costos antes del pago, nunca uses dark patterns y cubre agotado, error de pago, conexión lenta y confirmación accesible."
  },
  {
    id: "field-mobile-system",
    title: "Field Mobile System",
    category: "Mobile",
    layout: "Acciones por contexto",
    aesthetic: "Utilitario resistente",
    description: "Aplicación móvil para terreno, guantes, mala señal y tareas que no pueden perderse.",
    tags: ["mobile", "offline", "terreno", "operaciones"],
    palette: ["#101316", "#1c2227", "#f5f7f8", "#f1b95b"],
    prompt: "Diseña una aplicación móvil de terreno para {{platform}} usando {{framework}}. Flujo: {{brief}}. Estilo {{theme}} utilitario resistente: blancos táctiles amplios, contraste solar, operación con una mano, captura rápida, cola offline, sincronización explícita, resolución de conflictos y registro auditable. Considera cámara, permisos, batería, mala señal, errores recuperables y confirmaciones que no bloqueen el trabajo."
  },
  {
    id: "data-story-lab",
    title: "Data Story Lab",
    category: "Data",
    layout: "Pregunta + evidencia",
    aesthetic: "Laboratorio analítico",
    description: "Explorador de datos que conecta cada visualización con su pregunta, fuente y decisión.",
    tags: ["datos", "charts", "evidencia", "análisis"],
    palette: ["#0b1016", "#111b25", "#e7edf4", "#5bb7e8"],
    prompt: "Crea un laboratorio de análisis para {{platform}} con {{framework}}. Datos y decisiones: {{brief}}. Dirección {{theme}} de laboratorio: selector de pregunta, trazabilidad de fuente, filtros visibles, visualización adecuada al dato, tabla accesible equivalente, anotaciones, comparación temporal y exportación reproducible. Explica incertidumbre, valores faltantes y actualización; no uses gráficos decorativos ni ejes engañosos."
  },
  {
    id: "cinematic-deck-system",
    title: "Cinematic Deck System",
    category: "Presentation",
    layout: "Narrativa 16:9",
    aesthetic: "Cinemático técnico",
    description: "Sistema de presentación con titular dominante, ritmo visual y evidencia legible a distancia.",
    tags: ["presentación", "slides", "storytelling", "pitch"],
    palette: ["#08090a", "#121417", "#f4f5f6", "#aeb6bf"],
    prompt: "Diseña una presentación 16:9 para {{platform}} con {{framework}}. Tema, audiencia y objetivo: {{brief}}. Dirección {{theme}} cinemática técnica: una idea por diapositiva, titulares dominantes, retícula rigurosa, contraste plateado, animación progresiva y evidencia con fuente. Define portada, tensión, solución, demostración, prueba, plan y cierre. Todo texto debe ser editable, visible a distancia y compatible con movimiento reducido."
  },
  {
    id: "immersive-game-hud",
    title: "Immersive Game HUD",
    category: "Game UI",
    layout: "HUD adaptativo",
    aesthetic: "Diegético inmersivo",
    description: "Interfaz de juego que informa sin ocultar la escena y se adapta a mando, teclado y táctil.",
    tags: ["game", "hud", "mando", "accesibilidad"],
    palette: ["#070b0e", "#132129", "#eef8fa", "#60e2c7"],
    prompt: "Diseña un HUD y menús para {{platform}} usando {{framework}}. Juego y bucle principal: {{brief}}. Dirección {{theme}} diegética inmersiva: información priorizada, daño y objetivos legibles sin depender del color, navegación por mando/teclado/táctil, safe zones, escalado, subtítulos, remapeo y modos de contraste. Incluye pausa, inventario, tutorial contextual, feedback de latencia y estados desconectado/reconexión."
  },
  {
    id: "desktop-creation-studio",
    title: "Desktop Creation Studio",
    category: "Desktop",
    layout: "Canvas + inspectors",
    aesthetic: "Herramienta profesional",
    description: "Aplicación de creación densa al estilo de herramientas profesionales, configurable y recuperable.",
    tags: ["desktop", "editor", "canvas", "pro"],
    palette: ["#0a0b0d", "#15181c", "#e8ebee", "#8fa8ff"],
    prompt: "Diseña una herramienta de creación de escritorio para {{platform}} con {{framework}}. Disciplina y tareas: {{brief}}. Estética {{theme}} profesional: canvas central, paneles acoplables, inspector contextual, árbol del documento, command palette, atajos, deshacer/rehacer y espacios de trabajo guardables. Define apertura pesada con splash, recuperación de sesión, archivos recientes, progreso real y aislamiento por proyecto."
  },
  {
    id: "knowledge-editorial",
    title: "Knowledge Editorial",
    category: "Editorial",
    layout: "Lectura + mapa de contenido",
    aesthetic: "Publicación contemporánea",
    description: "Experiencia de lectura extensa con navegación, citas, notas y búsqueda profunda.",
    tags: ["docs", "blog", "lectura", "búsqueda"],
    palette: ["#f5f2ec", "#fffefd", "#1f1d1a", "#76614c"],
    prompt: "Crea una publicación de conocimiento para {{platform}} en {{framework}}. Materia y lectores: {{brief}}. Dirección {{theme}} editorial contemporánea: tipografía de lectura, ancho controlado, índice jerárquico, citas enlazables, notas, búsqueda, progreso y navegación anterior/siguiente. Incluye impresión, alto contraste, código, tablas responsivas y metadatos de actualización y autoría."
  },
  {
    id: "spatial-interface-prototype",
    title: "Spatial Interface Prototype",
    category: "Experimental",
    layout: "Capas espaciales",
    aesthetic: "Futuro sobrio",
    description: "Exploración espacial avanzada que conserva orientación, accesibilidad y ruta 2D equivalente.",
    tags: ["3d", "spatial", "experimental", "prototype"],
    palette: ["#05070a", "#0d141c", "#eef6ff", "#79c8ff"],
    prompt: "Prototipa una interfaz espacial para {{platform}} usando {{framework}}. Caso de uso: {{brief}}. Dirección {{theme}} de futuro sobrio: profundidad con propósito, puntos de referencia persistentes, foco claro, navegación reversible y feedback de orientación. Mantén una vista 2D equivalente, teclado, lector de pantalla, reducción de movimiento y rendimiento medible. Separa explícitamente experimento visual de funciones confirmadas."
  }
]);

function clone(value) {
  return structuredClone(value);
}

function normalize(value, max = 160) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .toLowerCase();
}

function safeText(value, fallback, max) {
  const text = String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
  return text || fallback;
}

class PromptExplorer {
  constructor(stateRoot) {
    this.statePath = path.join(stateRoot, "prompt-explorer.json");
    const stored = readJson(this.statePath, { schema: PROMPT_EXPLORER_SCHEMA, favorites: [], recent: [] });
    const ids = new Set(BUILTIN_PROMPTS.map((entry) => entry.id));
    this.state = {
      schema: PROMPT_EXPLORER_SCHEMA,
      favorites: [...new Set(Array.isArray(stored.favorites) ? stored.favorites : [])].filter((id) => ids.has(id)).slice(0, BUILTIN_PROMPTS.length),
      recent: (Array.isArray(stored.recent) ? stored.recent : []).filter((entry) => ids.has(entry?.id)).slice(0, 30)
    };
  }

  catalog(filters = {}) {
    const query = normalize(filters.query);
    const category = normalize(filters.category);
    const favoritesOnly = filters.favoritesOnly === true;
    const limit = Math.max(1, Math.min(120, Number(filters.limit) || 120));
    const favoriteSet = new Set(this.state.favorites);
    const entries = BUILTIN_PROMPTS.filter((entry) => {
      if (favoritesOnly && !favoriteSet.has(entry.id)) return false;
      if (category && category !== "all" && normalize(entry.category) !== category) return false;
      if (!query) return true;
      const haystack = normalize([entry.title, entry.category, entry.layout, entry.aesthetic, entry.description, ...entry.tags].join(" "), 1200);
      return query.split(" ").filter(Boolean).every((token) => haystack.includes(token));
    }).slice(0, limit).map((entry) => ({ ...clone(entry), favorite: favoriteSet.has(entry.id) }));
    return {
      schema: PROMPT_EXPLORER_SCHEMA,
      source: "DORN_BUILTIN_ORIGINAL",
      externalReference: EXTERNAL_REFERENCE,
      offline: true,
      total: BUILTIN_PROMPTS.length,
      matched: entries.length,
      categories: [...new Set(BUILTIN_PROMPTS.map((entry) => entry.category))].sort((left, right) => left.localeCompare(right, "es")),
      entries
    };
  }

  get(id) {
    const entry = BUILTIN_PROMPTS.find((candidate) => candidate.id === String(id));
    if (!entry) throw new Error("El prompt solicitado no existe en el catálogo local de DORN.");
    return { ...clone(entry), favorite: this.state.favorites.includes(entry.id) };
  }

  build(id, input = {}) {
    const entry = this.get(id);
    const values = {
      brief: safeText(input.brief, "Describe el producto, su audiencia, la tarea principal y el resultado esperado.", 8000),
      platform: safeText(input.platform, "web responsive y escritorio", 120),
      framework: safeText(input.framework, "el stack más apropiado y mantenible", 120),
      theme: safeText(input.theme, entry.aesthetic, 120)
    };
    const prompt = entry.prompt.replace(/\{\{(brief|platform|framework|theme)\}\}/g, (_match, key) => values[key]);
    this.state.recent = [{ id: entry.id, usedAt: now() }, ...this.state.recent.filter((item) => item.id !== entry.id)].slice(0, 30);
    this.#save();
    return {
      schema: PROMPT_EXPLORER_SCHEMA,
      id: entry.id,
      title: entry.title,
      prompt,
      values,
      provenance: {
        source: "DORN_BUILTIN_ORIGINAL",
        externalReference: EXTERNAL_REFERENCE,
        generatedAt: now(),
        executed: false
      }
    };
  }

  setFavorite(id, favorite) {
    const entry = this.get(id);
    const values = new Set(this.state.favorites);
    if (favorite) values.add(entry.id);
    else values.delete(entry.id);
    this.state.favorites = [...values].sort();
    this.#save();
    return { id: entry.id, favorite: values.has(entry.id), count: values.size };
  }

  recent() {
    return this.state.recent.map((item) => ({ ...item, title: this.get(item.id).title }));
  }

  #save() {
    atomicJson(this.statePath, this.state);
  }
}

module.exports = {
  BUILTIN_PROMPTS,
  EXTERNAL_REFERENCE,
  PROMPT_EXPLORER_SCHEMA,
  PromptExplorer
};
