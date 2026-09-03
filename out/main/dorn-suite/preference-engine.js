"use strict";

const path = require("node:path");
const { atomicJson, readJson, now } = require("./common");

const PERSONALITIES = new Set(["direct", "mentor", "companion"]);
const GAMER_GOALS = new Set(["play", "guide", "optimize", "stream"]);
const GAMER_LEVELS = new Set(["casual", "regular", "competitive"]);
const GAMER_PLATFORMS = new Set(["windows", "web", "mobile", "console", "multiplatform"]);
const DEFAULTS = Object.freeze({
  personality: "direct",
  learning: false,
  engineering: false,
  gamers: false,
  gamerGoal: "play",
  gamerLevel: "regular",
  gamerPlatform: "windows",
  gamerPerformance: true,
  gamerGraphics: false,
  gamerTesting: true,
  gamerAccessibility: true,
  gamerStreaming: false,
  gamerModding: false,
  gamerBackgroundAssistant: false,
  workspaceSuggestions: true,
  keepLocalWarm: false,
  movablePanels: false,
  developerMode: false,
  developerWebApi: true,
  developerDesktop: true,
  developerMobile: false,
  developerGameCreation: false,
  developerAutomation: false,
  developerDataAi: false,
  developerDatabases: true,
  developerTesting: true,
  developerSecurity: true,
  developerPerformance: true,
  developerInfrastructure: false,
  developerRelease: false,
  developerDocumentation: true,
  developerConsole: false,
  developerIdeTools: true,
  developerRobloxStudio: false,
  developerCadDccBridges: false,
  developerLocalProtocols: false,
  voiceConversation: false,
  voiceAutoRead: true,
  voiceWake: true,
  voiceOutsideApp: false,
  updatedAt: null
});

const WORKSPACE_RULES = [
  { id: "learn", label: "Aprender", pattern: /paes|prueba|examen|estudi|enseñ|matem[aá]tica|historia|contabilidad/i },
  { id: "engineering", label: "Ingeniería", pattern: /solidworks|fusion 360|autocad|cad|plano|pieza|ensambl|mec[aá]nic|industrial|3d|stl|step/i },
  { id: "automate", label: "Automatizar", pattern: /automat|powershell|terminal|script|proceso repet|tarea programada/i },
  { id: "analyze", label: "Analizar", pattern: /analiz|pdf|documento|tabla|datos|resumen|comparar/i },
  { id: "create", label: "Crear", pattern: /aplicaci[oó]n|p[aá]gina|web|juego|programa|c[oó]digo|diseñ/i }
];

class PreferenceEngine {
  constructor(stateRoot) {
    this.filePath = path.join(stateRoot, "preferences.json");
    this.state = { ...DEFAULTS, ...readJson(this.filePath, {}) };
    const legacyGoals = { create: "play", learn: "guide" };
    const legacyLevels = { beginner: "casual", intermediate: "regular", advanced: "competitive" };
    this.state.gamerGoal = legacyGoals[this.state.gamerGoal] || this.state.gamerGoal;
    this.state.gamerLevel = legacyLevels[this.state.gamerLevel] || this.state.gamerLevel;
    if (!GAMER_GOALS.has(this.state.gamerGoal)) this.state.gamerGoal = DEFAULTS.gamerGoal;
    if (!GAMER_LEVELS.has(this.state.gamerLevel)) this.state.gamerLevel = DEFAULTS.gamerLevel;
    delete this.state.gamerEngine;
  }

  settings() {
    return structuredClone(this.state);
  }

  configure(patch = {}) {
    if (patch.personality !== undefined) {
      const personality = String(patch.personality);
      if (!PERSONALITIES.has(personality)) throw new Error("La personalidad solicitada no existe.");
      this.state.personality = personality;
    }
    for (const [key, allowed, error] of [
      ["gamerGoal", GAMER_GOALS, "El objetivo gamer solicitado no existe."],
      ["gamerLevel", GAMER_LEVELS, "El nivel gamer solicitado no existe."],
      ["gamerPlatform", GAMER_PLATFORMS, "La plataforma gamer solicitada no existe."]
    ]) {
      if (patch[key] === undefined) continue;
      const value = String(patch[key]);
      if (!allowed.has(value)) throw new Error(error);
      this.state[key] = value;
    }
    for (const key of [
      "learning",
      "engineering",
      "gamers",
      "gamerPerformance",
      "gamerGraphics",
      "gamerTesting",
      "gamerAccessibility",
      "gamerStreaming",
      "gamerModding",
      "gamerBackgroundAssistant",
      "workspaceSuggestions",
      "keepLocalWarm",
      "movablePanels",
      "developerMode",
      "developerWebApi",
      "developerDesktop",
      "developerMobile",
      "developerGameCreation",
      "developerAutomation",
      "developerDataAi",
      "developerDatabases",
      "developerTesting",
      "developerSecurity",
      "developerPerformance",
      "developerInfrastructure",
      "developerRelease",
      "developerDocumentation",
      "developerConsole",
      "developerIdeTools",
      "developerRobloxStudio",
      "developerCadDccBridges",
      "developerLocalProtocols",
      "voiceConversation",
      "voiceAutoRead",
      "voiceWake",
      "voiceOutsideApp"
    ]) {
      if (patch[key] !== undefined) this.state[key] = Boolean(patch[key]);
    }
    if (!this.state.voiceWake) this.state.voiceOutsideApp = false;
    this.state.updatedAt = now();
    atomicJson(this.filePath, this.state);
    return this.settings();
  }

  suggestWorkspace(text, currentWorkspace = "create") {
    if (!this.state.workspaceSuggestions) return null;
    const rule = WORKSPACE_RULES.find((entry) => entry.pattern.test(String(text || "")));
    if (!rule || rule.id === currentWorkspace) return null;
    if (rule.id === "learn" && !this.state.learning) {
      return { ...rule, enabled: false, reason: "El espacio educativo está desactivado en Preferencias." };
    }
    if (rule.id === "engineering" && !this.state.engineering) {
      return { ...rule, enabled: false, reason: "El espacio de ingeniería está desactivado en Preferencias." };
    }
    return { ...rule, enabled: true, reason: `La solicitud parece corresponder a ${rule.label}.` };
  }

  promptFragment() {
    const personality = {
      direct: "ESTILO: directo, preciso y sin gastar palabras o tokens innecesarios.",
      mentor: "ESTILO: mentor. Enseña el razonamiento esencial, comprueba comprensión y evita relleno.",
      companion: "ESTILO: cercano y respetuoso, sin fingir ser humano, amigo real, psicólogo ni reemplazo de ayuda profesional."
    }[this.state.personality];
    const enabled = [];
    if (this.state.learning) enabled.push("aprendizaje adaptativo y evaluaciones originales");
    if (this.state.engineering) enabled.push("ingeniería y 3D con medidas, unidades y supuestos explícitos");
    if (this.state.gamers) enabled.push("asistencia para jugar, comprender mecánicas, ajustar rendimiento y accesibilidad");
    const gamerLabels = {
      goal: {
        play: "acompañamiento mientras juega",
        guide: "guías, mecánicas y aprendizaje del juego",
        optimize: "rendimiento, ajustes y solución de fallos",
        stream: "streaming y creación de contenido"
      },
      level: {
        casual: "casual",
        regular: "habitual",
        competitive: "competitivo"
      },
      platform: {
        windows: "Windows",
        web: "Web",
        mobile: "móvil",
        console: "consola",
        multiplatform: "multiplataforma"
      }
    };
    const gamerFocus = [
      this.state.gamerPerformance && "rendimiento y FPS",
      this.state.gamerGraphics && "calidad gráfica",
      this.state.gamerTesting && "errores, cierres y estabilidad del juego",
      this.state.gamerAccessibility && "accesibilidad",
      this.state.gamerStreaming && "streaming y contenido",
      this.state.gamerModding && "modding autorizado"
    ].filter(Boolean);
    const developerFocus = [
      this.state.developerWebApi && "web, servicios y APIs",
      this.state.developerDesktop && "aplicaciones de escritorio y multiplataforma",
      this.state.developerMobile && "aplicaciones móviles y PWA",
      this.state.developerGameCreation && "creación de videojuegos",
      this.state.developerAutomation && "scripts y automatización",
      this.state.developerDataAi && "datos e integración de IA",
      this.state.developerDatabases && "bases de datos, migraciones y consultas",
      this.state.developerTesting && "pruebas, depuración y calidad",
      this.state.developerSecurity && "seguridad defensiva, dependencias y tratamiento de secretos",
      this.state.developerPerformance && "rendimiento, accesibilidad y compatibilidad",
      this.state.developerInfrastructure && "contenedores, CI e infraestructura autorizada",
      this.state.developerRelease && "Git, compilación y publicación",
      this.state.developerDocumentation && "documentación técnica",
      this.state.developerConsole && "consola flotante autorizada",
      this.state.developerIdeTools && "IDEs, compiladores, linters, depuradores y administradores de paquetes instalados",
      this.state.developerRobloxStudio && "Roblox Studio mediante MCP oficial, Luau, pruebas y Open Cloud autorizado",
      this.state.developerCadDccBridges && "aplicaciones CAD y DCC mediante APIs, scripts y adaptadores oficiales",
      this.state.developerLocalProtocols && "MCP y servicios locales autenticados dentro del proyecto"
    ].filter(Boolean);
    return [
      "PREFERENCIAS ACTIVAS DEL USUARIO",
      personality,
      enabled.length ? `FUNCIONES ACTIVAS: ${enabled.join("; ")}.` : "No hay perfiles especializados activados.",
      this.state.gamers
        ? [
            `MODO GAMERS: objetivo ${gamerLabels.goal[this.state.gamerGoal]}; perfil ${gamerLabels.level[this.state.gamerLevel]}; plataforma ${gamerLabels.platform[this.state.gamerPlatform]}.`,
            `PRIORIDADES GAMER: ${gamerFocus.length ? gamerFocus.join(", ") : "asistencia general durante el juego"}.`,
            "Ayuda al usuario como jugador con guías, mecánicas, configuración, rendimiento, accesibilidad y contenido permitido. No conviertas este perfil en desarrollo de videojuegos ni propongas código salvo que el usuario active Desarrollador. No evadas anti-cheat, controles de inactividad, reglas de plataformas, licencias ni controles de acceso."
          ].join("\n")
        : "",
      this.state.developerMode
        ? `MODO DESARROLLADOR: funciones activas: ${developerFocus.length ? developerFocus.join(", ") : "ninguna"}. Puede proponer archivos y herramientas únicamente para esas funciones. Cada acción conserva límites, vista previa, aprobación y registro. No supongas privilegios de administrador.`
        : ""
    ].filter(Boolean).join("\n");
  }
}

module.exports = {
  DEFAULT_PREFERENCES: DEFAULTS,
  GAMER_OPTIONS: {
    goals: [...GAMER_GOALS],
    levels: [...GAMER_LEVELS],
    platforms: [...GAMER_PLATFORMS]
  },
  PreferenceEngine,
  WORKSPACE_RULES
};
