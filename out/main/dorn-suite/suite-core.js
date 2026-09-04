"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  DornSuiteError,
  ensureDirectory,
  redact,
  now
} = require("./common");
const { ModeManager, MemoryEngine } = require("./modes-memory");
const { AgentManager } = require("./agent-manager");
const { PluginEngine } = require("./plugin-engine");
const { GeometryEngine } = require("./geometry");
const { DoctorEngine } = require("./doctor");
const { DornInstallerEngine } = require("./installer-engine");
const { DornBridgeEngine } = require("./bridge-engine");
const { HelpCenter, ModelProfileManager } = require("./help-center");
const { PlatformServices } = require("./platform-services");
const { PreferenceEngine } = require("./preference-engine");
const { PromptExplorer } = require("./prompt-explorer");

const SUITE_VERSION = "4.0.0-alpha.3";

const MODULES = [
  { id: "core", label: "DORN AI", state: "active", optional: false },
  { id: "memory", label: "DORN Memory", state: "active", optional: false },
  { id: "agents", label: "DORN Agent Manager", state: "active", optional: false },
  { id: "plugins", label: "Plugins DORN", state: "planned-v5", optional: true },
  { id: "doctor", label: "DORN Doctor", state: "active", optional: false },
  { id: "bridge", label: "DORN Bridge", state: "active", optional: false },
  { id: "help", label: "DORN Learning Center", state: "active", optional: false },
  { id: "prompt-explorer", label: "Prompt Explorer", state: "local-active", optional: true },
  { id: "account-recovery", label: "DORN Account & Recovery", state: "local-active", optional: false },
  { id: "images", label: "DORN Image Gateway", state: "provider-ready", optional: true },
  { id: "voice", label: "DORN Voice · Windows", state: "synthesis-and-dictation-active", optional: true },
  { id: "collaboration", label: "DORN Collaboration", state: "local-server-active", optional: true },
  { id: "telemetry", label: "DORN Telemetry", state: "local-opt-in", optional: true },
  { id: "studio3d-basic", label: "DORN Studio 3D", state: "planned-v5", optional: true },
  { id: "studio3d-cad", label: "DORN CAD Pack", state: "not-installed", optional: true },
  { id: "design", label: "DORN Design", state: "foundation-active", optional: true },
  { id: "education", label: "DORN Education", state: "foundation-active", optional: true },
  { id: "machine", label: "DORN Machine", state: "foundation-active", optional: true },
  { id: "editor", label: "DORN Editor", state: "foundation-active", optional: true },
  { id: "installer-engine", label: "DORN Installer Engine", state: "active", optional: false },
  { id: "installer-studio", label: "DORN Installer Studio", state: "hidden-in-v4", optional: true }
];

const MODE_ALIASES = new Map([
  ["automatico", "automatic"],
  ["automático", "automatic"],
  ["automatic", "automatic"],
  ["manual", "manual"],
  ["economico", "economic"],
  ["económico", "economic"],
  ["economic", "economic"],
  ["privado", "private"],
  ["private", "private"],
  ["equipo", "team"],
  ["team", "team"],
  ["rendimiento", "performance"],
  ["maximo rendimiento", "performance"],
  ["máximo rendimiento", "performance"],
  ["performance", "performance"],
  ["bateria", "battery"],
  ["batería", "battery"],
  ["battery", "battery"]
]);

function normalize(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^[¿¡]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formattedMode(mode) {
  return [
    `Modo **${mode.label}** activado.`,
    "",
    `- Proveedores externos: ${mode.allowExternalProviders ? "permitidos con confirmación" : "bloqueados"}`,
    `- Prioridad local: ${mode.localFirst ? "sí" : "no"}`,
    `- Máximo de agentes: ${mode.maxAgents}`,
    `- Iteraciones: ${mode.maxIterations}`,
    `- Presupuesto de tiempo: ${mode.timeBudgetSeconds} segundos`,
    `- Presupuesto de tokens: ${mode.tokenBudget.toLocaleString("es-CL")}`
  ].join("\n");
}

class DornSuiteCore {
  constructor(options) {
    this.userDataPath = options.userDataPath;
    this.database = options.database;
    this.localRuntime = options.localRuntime;
    this.providers = options.providers;
    this.dialog = options.dialog;
    this.openStudio3d = typeof options.openStudio3d === "function" ? options.openStudio3d : null;
    this.stateRoot = ensureDirectory(path.join(this.userDataPath, "dorn-suite"));
    const audit = (projectId, action, detail) => {
      try {
        this.database.audit(projectId || null, action, detail);
      } catch {
      }
    };
    this.modeManager = new ModeManager(this.stateRoot);
    this.memory = new MemoryEngine(this.stateRoot);
    this.preferences = new PreferenceEngine(this.stateRoot);
    this.promptExplorer = new PromptExplorer(this.stateRoot);
    this.agents = new AgentManager({ modeManager: this.modeManager, audit });
    this.plugins = new PluginEngine(this.stateRoot, { audit });
    this.geometry = new GeometryEngine({ audit });
    this.doctor = new DoctorEngine({
      userDataPath: this.userDataPath,
      providers: () => this.providers.list(),
      localRuntime: () => this.localRuntime.status(),
      suiteStatus: () => this.status()
    });
    this.installer = new DornInstallerEngine(this.stateRoot, { audit });
    this.bridge = new DornBridgeEngine(this.stateRoot, { audit });
    this.help = new HelpCenter();
    this.modelProfiles = new ModelProfileManager(this.stateRoot);
    this.services = new PlatformServices({
      stateRoot: this.stateRoot,
      providers: this.providers
    });
    this.pluginApprovals = new Map();
  }

  status() {
    return {
      version: SUITE_VERSION,
      modules: MODULES.map((module) => ({ ...module })),
      mode: this.modeManager.current(),
      memory: this.memory.settings(),
      preferences: this.preferences.settings(),
      promptExplorer: {
        total: this.promptExplorer.catalog().total,
        offline: true
      },
      plugins: this.plugins.list().length,
      activeAgentTasks: this.agents.activeTasks().length,
      installations: fs.readdirSync(this.installer.registryRoot).filter((name) => name.endsWith(".json")).length,
      connectors: this.bridge.list().length,
      helpTopics: this.help.topics().length,
      modelProfiles: this.modelProfiles.list().length,
      services: this.services.status()
    };
  }

  products() {
    return MODULES.map((module) => ({
      ...module,
      installed: module.state !== "not-installed"
    }));
  }

  verification() {
    const localStatus = this.localRuntime.status();
    const checks = [
      {
        id: "suite-state",
        label: "Estado persistente y aislado",
        ok: fs.existsSync(this.stateRoot) && fs.statSync(this.stateRoot).isDirectory()
      },
      {
        id: "local-runtime",
        label: "Runtime local localizado",
        ok: Boolean(localStatus.supported && localStatus.runtime),
        detail: localStatus.detail
      },
      {
        id: "geometry",
        label: "Inspector y visor 3D",
        ok: Object.values(this.geometry.formats()).some((format) => format.inspect && format.preview)
      },
      {
        id: "files",
        label: "Creación de archivos con aprobación",
        ok: true
      },
      {
        id: "agents",
        label: "Coordinador y especialistas",
        ok: this.agents.roles().length === 9
      },
      {
        id: "installer",
        label: "Motor de instaladores",
        ok: typeof this.installer.projectTemplate === "function"
      },
      {
        id: "plugins",
        label: "Host aislado de plugins",
        ok: typeof this.plugins.inspect === "function"
      },
      {
        id: "recovery",
        label: "Respaldo verificable sin secretos",
        ok: typeof this.services.recovery.verifyBackup === "function"
      },
      {
        id: "images",
        label: "Pasarela de generación de imágenes",
        ok: typeof this.services.images.generate === "function",
        detail: `${this.services.images.candidates().length} proveedor(es) configurado(s)`
      },
      {
        id: "voice",
        label: "Síntesis de voz de Windows",
        ok: this.services.voice.status().platformSupported
      }
    ];
    return {
      version: SUITE_VERSION,
      generatedAt: now(),
      checks,
      passed: checks.filter((check) => check.ok).length,
      total: checks.length
    };
  }

  project(projectId) {
    return this.database.getProject(projectId);
  }

  async inspectPluginDialog() {
    const result = await this.dialog.showOpenDialog({
      title: "Selecciona la carpeta del plugin DORN",
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const inspected = this.plugins.inspect(result.filePaths[0]);
    const approvalToken = crypto.randomUUID();
    this.pluginApprovals.set(approvalToken, {
      sourceRoot: inspected.root,
      packageHash: inspected.packageHash,
      expiresAt: Date.now() + 10 * 60 * 1000
    });
    return {
      approvalToken,
      manifest: inspected.manifest,
      packageHash: inspected.packageHash,
      sizeBytes: inspected.sizeBytes,
      signatureStatus: inspected.signatureStatus
    };
  }

  installPlugin(approvalToken, approvedPermissions) {
    const approval = this.pluginApprovals.get(approvalToken);
    this.pluginApprovals.delete(approvalToken);
    if (!approval || approval.expiresAt < Date.now()) {
      throw new DornSuiteError("DORN-PLUGIN-017", "plugins", "La autorización del plugin venció.");
    }
    const current = this.plugins.inspect(approval.sourceRoot);
    if (current.packageHash !== approval.packageHash) {
      throw new DornSuiteError("DORN-PLUGIN-018", "plugins", "El plugin cambió después de la vista previa.");
    }
    return this.plugins.install(approval.sourceRoot, approvedPermissions);
  }

  handleTextCommand(text, projectId = null) {
    const normalized = normalize(text);
    if (/^\/(?:version|versión)$|^(?:que|qué) version (?:es|tiene) dorn/.test(normalized)) {
      return {
        handled: true,
        content: [
          `**DORN AI ${SUITE_VERSION}**`,
          "",
          "- Núcleo de archivos y programas: activo con vista previa y aprobación",
          "- Agentes y modos: activos",
          "- Memoria local de proyecto: activa",
          "- Studio 3D: inspector y visor local activos",
          "- Installer Engine: activo",
          "- Plugins y puentes externos: activos con permisos",
          "- Recuperación local: activa",
          "- Plataforma actual: Windows 11 x64",
          "- Voz: servicios de voz compatibles del sistema",
          `- Proveedores de imágenes listos: ${this.services.images.candidates().length}`,
          "",
          "Escribe `/novedades` para ver comandos comprobables o `/verificar` para ejecutar la revisión interna."
        ].join("\n")
      };
    }
    if (/^\/(?:novedades|capacidades)$/.test(normalized)) {
      return {
        handled: true,
        content: [
          `Capacidades comprobables de **DORN ${SUITE_VERSION}**:`,
          "",
          "- `/verificar` — revisa los motores integrados.",
          "- `/doctor` — diagnostica equipo, IA local, APIs y herramientas.",
          "- `/agentes` y `/modo equipo` — coordina especialistas con límites.",
          "- `crea una aplicación...` — prepara archivos y pruebas; el panel local permite aprobar el plan completo sin gastar tokens.",
          "- `abre el modelo pieza.obj` — inicia el visor 3D local.",
          "- `analiza el modelo pieza.stl` — mide geometría real.",
          "- `centra el modelo pieza.obj` — crea una copia no destructiva.",
          "- `crea una mesa industrial de 1200 x 700 x 900 mm` — genera OBJ y BOM.",
          "- `prepara un instalador` — crea `dorn-installer.json`; el CLI también genera paquetes, parches y bundles verificables.",
          "- `/productos` — muestra los componentes reales de la suite.",
          "- `/respaldo crear` — crea un respaldo local que excluye secretos.",
          "- `/imagen descripción...` — usa una API de imagen configurada y guarda el resultado con aprobación.",
          "- `/voz texto...` — lee texto mediante las voces instaladas en Windows.",
          "- `/colaboracion iniciar local` — abre una sala local autenticada.",
          "- `/puentes` — muestra adaptadores autorizados para Cinema 4D, CAD u otras aplicaciones."
        ].join("\n")
      };
    }
    if (/^\/verificar$|^(?:verifica|comprobar) (?:la )?(?:instalacion|instalación|suite|version|versión)/.test(normalized)) {
      return { handled: true, async: "suite-verify" };
    }
    if (/^\/productos$|^(?:muestra|abre|lista)(?:me)? (?:los )?productos/.test(normalized)) {
      return {
        handled: true,
        content: [
          "Productos y componentes DORN:",
          "",
          ...this.products().map((module) => `- **${module.label}:** ${module.state}${module.optional ? " · opcional" : " · base"}`)
        ].join("\n")
      };
    }
    if (/^\/cuenta$/.test(normalized)) {
      const profile = this.services.recovery.profileStatus();
      return {
        handled: true,
        content: [
          "Cuenta y recuperación:",
          "",
          `- Perfil local: ${profile.localProfileReady ? profile.displayName : "sin configurar"}`,
          `- Correo de recuperación: ${profile.email || "no definido"}`,
          `- Google OAuth: ${profile.googleOAuthConfigured ? "configurado" : "requiere credenciales OAuth oficiales de DORN"}`,
          `- Respaldos locales: ${this.services.recovery.listBackups().length}`,
          "",
          "DORN no guarda contraseñas ni cookies de Google. El inicio con Google se activará cuando se incorporen el cliente OAuth y su URL de redirección oficiales."
        ].join("\n")
      };
    }
    const profileMatch = String(text).trim().match(/^\/perfil\s+([^;\r\n]+?)(?:\s*;\s*([^\s;]+@[^\s;]+))?$/i);
    if (profileMatch) {
      const profile = this.services.recovery.configureLocalProfile({
        displayName: profileMatch[1],
        email: profileMatch[2] || ""
      });
      return {
        handled: true,
        content: `Perfil local configurado para **${profile.displayName}**${profile.email ? ` · ${profile.email}` : ""}.`
      };
    }
    if (/^\/respaldo(?:\s+estado)?$/.test(normalized)) {
      const backups = this.services.recovery.listBackups();
      return {
        handled: true,
        content: backups.length
          ? ["Respaldos locales verificados por DORN:", "", ...backups.slice(0, 10).map((backup) => `- ${backup.fileName} · ${(backup.sizeBytes / 1024).toFixed(1)} KB`)].join("\n")
          : "Todavía no hay respaldos. Escribe `/respaldo crear` para guardar configuración, memoria y metadatos sin incluir claves API."
      };
    }
    if (/^\/respaldo crear$/.test(normalized)) {
      return { handled: true, async: "recovery-backup" };
    }
    if (/^\/telemetria(?:\s+estado)?$/.test(normalized)) {
      const telemetry = this.services.telemetry.status();
      return {
        handled: true,
        content: [
          `Telemetría: **${telemetry.enabled ? "activa" : "desactivada"}**.`,
          "",
          "Esta versión sólo conserva contadores locales opcionales. No transmite datos a un servidor."
        ].join("\n")
      };
    }
    const telemetryMatch = normalized.match(/^\/telemetria\s+(activar|activa|desactivar|desactiva)$/);
    if (telemetryMatch) {
      const telemetry = this.services.telemetry.configure({ enabled: telemetryMatch[1].startsWith("activa") });
      return { handled: true, content: `Telemetría local ${telemetry.enabled ? "activada" : "desactivada"}.` };
    }
    if (/^\/voz detener$/.test(normalized)) {
      this.services.voice.stop();
      return { handled: true, content: "La lectura de voz fue detenida." };
    }
    const voiceMatch = String(text).trim().match(/^\/voz\s+([\s\S]+)$/i);
    if (voiceMatch) {
      return { handled: true, async: "voice-speak", text: voiceMatch[1] };
    }
    const imageMatch = String(text).trim().match(/^(?:\/imagen\s+|(?:(?:crea|crear|genera|generar|haz|hacer|diseña|diseñar)\s+(?:una?\s+)?(?:imagen|foto|ilustraci[oó]n)(?:\s+(?:de|con|que muestre))?\s+)|(?:dibuja|dibujar|dib[uú]jame)\s+)([\s\S]+)$/i);
    if (imageMatch) {
      if (!this.services.images.candidates().length) {
        return {
          handled: true,
          content: "Todavía no hay un generador de imágenes configurado. DORN abrirá Modelos y APIs para que añadas una conexión con capacidad `image`; el preset OpenAI · GPT Image 2 ya contiene la ruta y el modelo correctos.",
          uiAction: { type: "open-control-center", tab: "connections" }
        };
      }
      return {
        handled: true,
        async: "image-generate",
        projectId: projectId || null,
        prompt: imageMatch[1].trim()
      };
    }
    if (/^\/colaboracion(?:\s+estado)?$/.test(normalized)) {
      const status = this.services.collaboration.status();
      const relativePath = `DORN-Images/${slug}.${extension}`;
      return {
        handled: true,
        content: status.active
          ? `La sala de colaboración está activa en ${status.host}:${status.port} para ${status.audience}.`
          : "No hay una sala activa. Usa `/colaboracion iniciar local`; para exponerla en la red local usa `/colaboracion iniciar lan` de forma explícita."
      };
    }
    const collaborationStart = normalized.match(/^\/colaboracion iniciar(?:\s+(local|lan))?$/);
    if (collaborationStart) {
      return { handled: true, async: "collaboration-start", audience: collaborationStart[1] || "local" };
    }
    if (/^\/colaboracion detener$/.test(normalized)) {
      return { handled: true, async: "collaboration-stop" };
    }
    if (/^\/redes$/.test(normalized)) {
      return {
        handled: true,
        content: "Servidor oficial de Discord de DORN: https://discord.gg/qTBNR8du4K"
      };
    }
    const modeMatch = normalized.match(/^(?:\/modo\s+|(?:activa|activar|trabaja|trabajar)\s+(?:en\s+)?modo\s+)(.+)$/);
    if (modeMatch) {
      const requested = modeMatch[1].replace(/[.!]$/, "").trim();
      const modeId = MODE_ALIASES.get(requested);
      if (!modeId) {
        return {
          handled: true,
          content: `No reconozco el modo “${requested}”. Opciones: automático, manual, económico, privado, equipo, máximo rendimiento y batería.`
        };
      }
      const mode = this.modeManager.select(modeId, projectId);
      return { handled: true, content: formattedMode(mode) };
    }
    if (/^\/modo$|^(?:que|qué) modo (?:esta|está) activo/.test(normalized)) {
      return { handled: true, content: formattedMode(this.modeManager.current(projectId)) };
    }
    if (/^\/agentes$|^(?:muestra|dime) (?:los )?agentes/.test(normalized)) {
      const lines = this.agents.roles().map((role) => `- **${role.label}:** ${role.capabilities.join(", ")}`);
      return { handled: true, content: ["Equipo disponible de DORN:", "", ...lines].join("\n") };
    }
    if (/^\/memoria$|^(?:que|qué) recuerdas (?:de )?(?:este )?proyecto/.test(normalized)) {
      if (!projectId) return { handled: true, content: "Conecta una carpeta para utilizar memoria separada de proyecto." };
      const memory = this.memory.getProject(projectId);
      return {
        handled: true,
        content: [
          "Memoria actual del proyecto:",
          "",
          `- Objetivo: ${memory.objective || "sin definir"}`,
          `- Decisiones: ${memory.decisions.length}`,
          `- Errores: ${memory.errors.length}`,
          `- Versiones: ${memory.versions.length}`,
          `- Tareas pendientes: ${memory.pending.length}`,
          `- Restricciones: ${memory.restrictions.length}`
        ].join("\n")
      };
    }
    const remember = String(text).trim().match(/^(?:\/recordar\s+|recuerda\s+que\s+)([\s\S]+)$/i);
    if (remember) {
      if (!projectId) return { handled: true, content: "Conecta una carpeta antes de guardar memoria de proyecto." };
      const saved = this.memory.rememberProject(projectId, { type: "semantic", value: remember[1] });
      return { handled: true, content: `Guardado en la memoria de este proyecto: “${redact(saved.value)}”.` };
    }
    if (/^\/doctor$|^(?:revisa|diagnostica|diagnóstico|diagnostico) dorn/.test(normalized)) {
      return { handled: true, async: "doctor" };
    }
    const improveModel = String(text).match(/(?:mejora|mejorar|optimiza|optimizar|recomienda\s+mejoras\s+para)(?:\s+(?:el|este|un))?(?:\s+(?:modelo|archivo|pieza))?\s+["'`]?([^"'`\r\n]+?\.(?:obj|stl|ply|gltf|glb))["'`]?(?:\s|$)/i);
    if (improveModel) {
      if (!projectId) return { handled: true, content: "Conecta la carpeta que contiene el modelo antes de revisarlo." };
      return {
        handled: true,
        async: "geometry-recommend",
        projectId,
        relativePath: improveModel[1].trim()
      };
    }
    const centerModel = String(text).match(/(?:centra|centrar)(?:\s+(?:el|este|un))?(?:\s+(?:modelo|archivo|pieza))?\s+["'`]?([^"'`\r\n]+?\.obj)["'`]?(?:\s|$)/i);
    if (centerModel) {
      if (!projectId) return { handled: true, content: "Conecta la carpeta que contiene el OBJ antes de editarlo." };
      return {
        handled: true,
        async: "geometry-edit",
        projectId,
        relativePath: centerModel[1].trim(),
        operation: { center: true },
        suffix: "centrado"
      };
    }
    const scaleModel = String(text).match(/(?:escala|escalar)(?:\s+(?:el|este|un))?(?:\s+(?:modelo|archivo|pieza))?\s+["'`]?([^"'`\r\n]+?\.obj)["'`]?\s+(?:por|a)\s+(\d+(?:[.,]\d+)?)/i);
    if (scaleModel) {
      if (!projectId) return { handled: true, content: "Conecta la carpeta que contiene el OBJ antes de editarlo." };
      return {
        handled: true,
        async: "geometry-edit",
        projectId,
        relativePath: scaleModel[1].trim(),
        operation: { scale: Number(scaleModel[2].replace(",", ".")) },
        suffix: `escala-${scaleModel[2].replace(",", "-")}`
      };
    }
    const moveModel = String(text).match(/(?:mueve|mover|traslada|trasladar)(?:\s+(?:el|este|un))?(?:\s+(?:modelo|archivo|pieza))?\s+["'`]?([^"'`\r\n]+?\.obj)["'`]?\s+(?:a|por)\s+([+\-]?\d+(?:[.,]\d+)?)\s*[,; ]\s*([+\-]?\d+(?:[.,]\d+)?)\s*[,; ]\s*([+\-]?\d+(?:[.,]\d+)?)/i);
    if (moveModel) {
      if (!projectId) return { handled: true, content: "Conecta la carpeta que contiene el OBJ antes de editarlo." };
      return {
        handled: true,
        async: "geometry-edit",
        projectId,
        relativePath: moveModel[1].trim(),
        operation: {
          translation: moveModel.slice(2, 5).map((value) => Number(value.replace(",", ".")))
        },
        suffix: "trasladado"
      };
    }
    const visualModelPath = String(text).match(/(?:abre|abrir|visualiza|visualizar|muestra|mostrar)(?:\s+(?:el|este|un))?(?:\s+(?:modelo|archivo|pieza))?\s+["'`]?([^"'`\r\n]+?\.(?:obj|stl|ply|gltf|glb))["'`]?(?:\s|$)/i);
    if (visualModelPath) {
      if (!projectId) return { handled: true, content: "Conecta la carpeta que contiene el modelo antes de abrirlo." };
      if (!this.openStudio3d) return { handled: true, content: "El visor 3D no está disponible en este entorno." };
      return {
        handled: true,
        async: "studio3d-open",
        projectId,
        relativePath: visualModelPath[1].trim()
      };
    }
    const modelPath = String(text).match(/(?:analiza|analizar|revisa|revisar|inspecciona|inspeccionar)(?:\s+(?:el|este|un))?(?:\s+(?:modelo|archivo|pieza))?\s+["'`]?([^"'`\r\n]+?\.(?:obj|stl|ply|gltf|glb))["'`]?(?:\s|$)/i);
    if (modelPath) {
      if (!projectId) return { handled: true, content: "Conecta la carpeta que contiene el modelo antes de analizarlo." };
      return {
        handled: true,
        async: "geometry-inspect",
        projectId,
        relativePath: modelPath[1].trim()
      };
    }
    const table = String(text).match(/(?:crea|crear|genera|generar)(?:\s+un modelo de)?\s+una mesa industrial[\s\S]*?(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(?:mm|milimetros|milímetros)?/i);
    if (table) {
      if (!projectId) return { handled: true, content: "Conecta una carpeta para crear y versionar el modelo 3D." };
      return {
        handled: true,
        async: "create-table",
        projectId,
        parameters: {
          width: Number(table[1].replace(",", ".")),
          depth: Number(table[2].replace(",", ".")),
          height: Number(table[3].replace(",", "."))
        }
      };
    }
    if (/(?:prepara|crear|crea|genera)(?:r)?\s+(?:la configuracion de |la configuración de |un )?instalador/.test(normalized)) {
      if (!projectId) return { handled: true, content: "Conecta la carpeta del programa antes de preparar su instalador." };
      return { handled: true, async: "installer-template", projectId };
    }
    if (/(?:analiza|calcula|muestra)(?:r)?\s+(?:el )?(?:peso|tamano|tamaño)(?:\s+del)?\s+(?:proyecto|instalador|paquete)/.test(normalized)) {
      if (!projectId) return { handled: true, content: "Conecta la carpeta que quieres analizar." };
      return { handled: true, async: "installer-analyze", projectId };
    }
    if (/^\/puentes$|^(?:muestra|lista|dime)(?:me)?\s+(?:los )?(?:puentes|conectores)/.test(normalized)) {
      const connectors = this.bridge.list();
      return {
        handled: true,
        content: connectors.length
          ? ["Conectores DORN registrados:", "", ...connectors.map((connector) => `- **${connector.name}:** ${connector.enabled ? "activo" : "desactivado"} · ${connector.capabilities.join(", ")}`)].join("\n")
          : "No hay conectores externos registrados. Cuando entregues un adaptador autorizado de Cinema 4D u otra aplicación, DORN revisará sus capacidades antes de instalarlo."
      };
    }
    const helpMatch = String(text).trim().match(/^\/ayuda(?:\s+([\s\S]+))?$/i);
    const isHelpQuestion = /^(?:como|cómo|donde|dónde|por que|por qué|que significa|qué significa)\s+/.test(normalized);
    if (helpMatch || isHelpQuestion) {
      const query = (helpMatch?.[1] || text).trim();
      if (!query) {
        return {
          handled: true,
          content: [
            "Centro de aprendizaje DORN:",
            "",
            ...this.help.topics().map((topic) => `- **${topic.title}**`),
            "",
            "Escribe `/ayuda` seguido de tu pregunta."
          ].join("\n")
        };
      }
      const providerGuide = this.help.providerGuide(query);
      if (providerGuide) {
        return {
          handled: true,
          content: [
            `Guía local para **${providerGuide.name}**`,
            "",
            providerGuide.purpose,
            "",
            ...providerGuide.steps.map((step, index) => `${index + 1}. ${step}`),
            "",
            `- Base URL: \`${providerGuide.quickFields.baseUrl}\``,
            `- Ruta: \`${providerGuide.quickFields.endpoint}\``,
            `- Página oficial: ${providerGuide.officialUrl}`,
            `- Privacidad: ${providerGuide.privacyUrl}`,
            ...providerGuide.notes.map((note) => `- Nota: ${note}`)
          ].join("\n"),
          guide: providerGuide
        };
      }
      const results = this.help.search(query);
      return {
        handled: true,
        content: results.length
          ? [results[0].body, "", ...results.slice(1).map((result) => `También puede servirte: **${result.title}**.`)].join("\n")
          : "No encontré una guía local exacta. Ejecuta `/doctor` si se trata de un error o describe el proveedor, módulo y mensaje que ves."
      };
    }
    const providerError = String(text).trim().match(/^(?:\/error\s+|expl[ií]ca(?:me)?\s+(?:este\s+)?error\s+)([\s\S]+)$/i);
    if (providerError) {
      const diagnosis = this.help.diagnoseProviderError(providerError[1]);
      return {
        handled: true,
        content: [
          `Diagnóstico **${diagnosis.code}**: ${diagnosis.explanation}`,
          "",
          ...diagnosis.actions.map((action) => `- ${action}`)
        ].join("\n"),
        diagnosis
      };
    }
    const bridgeRun = String(text).match(/usa\s+(?:el\s+)?conector\s+([a-z0-9._-]+)\s+para\s+(analizar|inspeccionar|convertir|renderizar)\s+["'`]?([^"'`\r\n]+)["'`]?$/i);
    if (bridgeRun) {
      if (!projectId) return { handled: true, content: "Conecta primero la carpeta que contiene el archivo de entrada." };
      const operation = /analizar|inspeccionar/i.test(bridgeRun[2])
        ? "inspect-3d"
        : /convertir/i.test(bridgeRun[2])
          ? "convert-format"
          : "render-image";
      return {
        handled: true,
        async: "bridge-run",
        projectId,
        connectorId: bridgeRun[1],
        operation,
        relativePath: bridgeRun[3].trim()
      };
    }
    return { handled: false };
  }

  async completeTextCommand(command) {
    if (command.async === "suite-verify") {
      const report = this.verification();
      return {
        handled: true,
        content: [
          `Verificación interna de **DORN ${report.version}**:`,
          "",
          ...report.checks.map((check) => `- ${check.ok ? "✅" : "⚠️"} **${check.label}**${check.detail ? ` — ${check.detail}` : ""}`),
          "",
          `Resultado: ${report.passed}/${report.total} comprobaciones disponibles en este equipo.`
        ].join("\n"),
        report
      };
    }
    if (command.async === "recovery-backup") {
      const backup = this.services.recovery.createBackup({ suiteVersion: SUITE_VERSION });
      return {
        handled: true,
        content: [
          "Respaldo local creado y verificado.",
          "",
          `- Archivo: \`${backup.fileName}\``,
          `- Registros: ${backup.files}`,
          `- Tamaño de origen: ${(backup.sourceBytes / 1024).toFixed(1)} KB`,
          `- SHA-256: \`${backup.sha256}\``,
          "- Claves, tokens y credenciales: excluidos"
        ].join("\n"),
        backup
      };
    }
    if (command.async === "voice-speak") {
      const result = await this.services.voice.speak(command.text);
      return {
        handled: true,
        content: `Windows terminó de leer ${result.characters.toLocaleString("es-CL")} caracteres.`,
        result
      };
    }
    if (command.async === "image-generate") {
      const generated = await this.services.images.generate({ prompt: command.prompt });
      const slug = command.prompt
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64) || "imagen";
      const extension = generated.mimeType.includes("jpeg") ? "jpg" : generated.mimeType.includes("webp") ? "webp" : "png";
      return {
        handled: true,
        content: [
          `Imagen generada por **${generated.providerName}**.`,
          "",
          `- Modelo: ${generated.model}`,
          `- Tamaño: ${generated.size}`,
          `- Peso: ${(generated.bytes / 1024 ** 2).toFixed(2)} MB`,
          `- SHA-256: \`${generated.sha256}\``,
          command.projectId ? `- Salida propuesta: \`${relativePath}\`` : "- Guardado: conecta una carpeta de proyecto para conservarla como archivo independiente.",
          "",
          command.projectId
            ? "Revisa la vista previa y usa el panel local de aprobación para guardar la imagen."
            : "La vista previa aparece en esta conversación. No se escribió ningún archivo fuera de DORN."
        ].join("\n"),
        attachments: [{
          id: `generated-${generated.sha256.slice(0, 16)}`,
          type: "generated-image",
          name: `${slug}.${extension}`,
          mime: generated.mimeType,
          size: generated.bytes,
          sha256: generated.sha256,
          previewDataUrl: generated.bytes <= 6 * 1024 * 1024 ? `data:${generated.mimeType};base64,${generated.base64}` : null
        }],
        actions: command.projectId ? [{
          action: "write",
          relativePath,
          content: generated.base64,
          encoding: "base64"
        }] : []
      };
    }
    if (command.async === "collaboration-start") {
      const session = await this.services.collaboration.start({ audience: command.audience });
      return {
        handled: true,
        content: [
          `Sala de colaboración **${session.audience}** iniciada.`,
          "",
          `- Dirección: \`http://${session.host}:${session.port}\``,
          `- Token de sesión: \`${session.token}\``,
          "- API: `GET /api/messages` y `POST /api/messages` con `Authorization: Bearer <token>`",
          "",
          session.audience === "lan"
            ? "La red local no utiliza TLS. Comparte el token sólo con personas de confianza y detén la sala al terminar."
            : "La sala sólo acepta conexiones de este computador."
        ].join("\n"),
        session
      };
    }
    if (command.async === "collaboration-stop") {
      await this.services.collaboration.stop();
      return { handled: true, content: "La sala de colaboración fue detenida y dejó de aceptar conexiones." };
    }
    if (command.async === "doctor") {
      const report = await this.doctor.run();
      const installedTools = report.tools.filter((tool) => tool.installed).map((tool) => tool.command);
      const missingTools = report.tools.filter((tool) => !tool.installed).map((tool) => tool.command);
      return {
        handled: true,
        content: [
          "Diagnóstico de DORN completado.",
          "",
          `- Sistema: ${report.platform.os} ${report.platform.arch}`,
          `- RAM libre: ${(report.memory.freeBytes / 1024 ** 3).toFixed(1)} GB`,
          `- DORN Local: ${report.localRuntime.state}`,
          `- Proveedores configurados: ${report.providers.filter((provider) => provider.configured).length}/${report.providers.length}`,
          `- Herramientas detectadas: ${installedTools.join(", ") || "ninguna"}`,
          `- Herramientas opcionales ausentes: ${missingTools.join(", ") || "ninguna"}`,
          `- Advertencias: ${report.warnings.length ? report.warnings.join(" · ") : "ninguna"}`
        ].join("\n"),
        report
      };
    }
    if (command.async === "geometry-inspect") {
      const project = this.project(command.projectId);
      const report = this.geometry.inspect(project.rootPath, command.relativePath);
      const dimensions = report.measurements.boundingBox?.dimensions;
      return {
        handled: true,
        content: [
          `Análisis real de **${report.file.name}**:`,
          "",
          `- Formato: ${report.file.format}`,
          `- Tamaño: ${report.file.sizeBytes.toLocaleString("es-CL")} bytes`,
          `- Objetos: ${report.scene.objects || 0}`,
          `- Mallas: ${report.scene.meshes || 0}`,
          `- Vértices: ${(report.geometry.vertices || 0).toLocaleString("es-CL")}`,
          `- Triángulos: ${(report.geometry.triangles || 0).toLocaleString("es-CL")}`,
          `- Dimensiones: ${dimensions ? dimensions.map((value) => Number(value.toFixed(4))).join(" × ") : "no disponibles"} ${report.measurements.units}`,
          `- Advertencias: ${report.warnings.length ? report.warnings.join(" · ") : "ninguna detectada por el inspector disponible"}`
        ].join("\n"),
        report
      };
    }
    if (command.async === "geometry-recommend") {
      const project = this.project(command.projectId);
      const result = this.geometry.recommend(project.rootPath, command.relativePath);
      const lines = result.recommendations.length
        ? result.recommendations.map((recommendation) => `- **${recommendation.title}:** ${recommendation.reason}${recommendation.requiresApproval ? " Requiere aprobación." : ""}`)
        : ["- No se detectaron mejoras automáticas justificadas con la información disponible."];
      return {
        handled: true,
        content: [
          `Revisión geométrica de **${result.report.file.name}**:`,
          "",
          ...lines,
          "",
          "DORN no modificó el modelo."
        ].join("\n"),
        result
      };
    }
    if (command.async === "geometry-edit") {
      const project = this.project(command.projectId);
      const edit = this.geometry.prepareObjEdit(project.rootPath, command.relativePath, command.operation);
      const sourceName = path.parse(command.relativePath).name.replace(/[^a-z0-9._-]+/gi, "-");
      const outputPath = `DORN-3D/ediciones/${sourceName}-${command.suffix}.obj`;
      return {
        handled: true,
        content: [
          `Edición no destructiva preparada para **${path.basename(command.relativePath)}**.`,
          "",
          `- Vértices transformados: ${edit.verticesChanged.toLocaleString("es-CL")}`,
          `- Centro anterior: ${edit.before.center.map((value) => Number(value.toFixed(4))).join(", ")}`,
          `- Centro nuevo: ${edit.after.center.map((value) => Number(value.toFixed(4))).join(", ")}`,
          `- Salida propuesta: \`${outputPath}\``,
          "",
          "El original no se reemplazará. Revisa la vista previa y aprueba para crear la copia."
        ].join("\n"),
        edit: {
          operation: edit.operation,
          before: edit.before,
          after: edit.after,
          verticesChanged: edit.verticesChanged,
          source: edit.source
        },
        actions: [{
          action: "write",
          relativePath: outputPath,
          content: edit.content,
          encoding: "utf8"
        }]
      };
    }
    if (command.async === "studio3d-open") {
      const result = await this.openStudio3d(command.projectId, command.relativePath);
      return {
        handled: true,
        content: `Abrí **${result.fileName}** en DORN Studio 3D. El visor trabaja localmente y permite girar, desplazar, ampliar, seleccionar piezas, alternar rejilla y ver la malla.`,
        result
      };
    }
    if (command.async === "create-table") {
      const model = this.geometry.createIndustrialTable(command.parameters);
      const baseName = `mesa-industrial-${model.dimensions.width}x${model.dimensions.depth}x${model.dimensions.height}`;
      return {
        handled: true,
        content: [
          `Modelo paramétrico preparado: **${baseName}**.`,
          "",
          `- Medidas: ${model.dimensions.width} × ${model.dimensions.depth} × ${model.dimensions.height} mm`,
          `- Piezas: ${model.parts.length}`,
          `- Perfil: ${model.profile}`,
          `- Advertencias: ${model.warnings.join(" · ")}`
        ].join("\n"),
        actions: [
          {
            action: "write",
            relativePath: `DORN-3D/${baseName}.obj`,
            content: model.objContent,
            encoding: "utf8"
          },
          {
            action: "write",
            relativePath: `DORN-3D/${baseName}.bom.json`,
            content: JSON.stringify({
              type: model.type,
              units: model.units,
              dimensions: model.dimensions,
              material: model.material,
              profile: model.profile,
              parts: model.parts,
              billOfMaterials: model.billOfMaterials,
              warnings: model.warnings
            }, null, 2),
            encoding: "utf8"
          }
        ]
      };
    }
    if (command.async === "installer-template") {
      const project = this.project(command.projectId);
      const slug = String(project.name || "producto")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50) || "producto";
      const template = {
        ...this.installer.projectTemplate(),
        id: `com.dorn.${slug}`,
        name: project.name || "Producto DORN",
        publisher: "DORN",
        metadata: {
          generatedBy: "DORN AI Windows 3.0",
          projectKind: project.kind || "create"
        }
      };
      return {
        handled: true,
        content: [
          "Configuración de instalador preparada.",
          "",
          "- Formato: DORN Package transaccional",
          "- Integridad: SHA-256 por archivo y por paquete",
          "- Recuperación: copia previa y reversión automática",
          "- Desinstalación: conserva por defecto archivos modificados y datos del usuario",
          "- Distribución: admite fragmentos reanudables y reconstrucción verificada",
          "",
          "Revisa `dorn-installer.json` y luego pide: “analiza el peso del instalador”."
        ].join("\n"),
        actions: [{
          action: "write",
          relativePath: "dorn-installer.json",
          content: JSON.stringify(template, null, 2),
          encoding: "utf8"
        }]
      };
    }
    if (command.async === "installer-analyze") {
      const project = this.project(command.projectId);
      const configPath = path.join(project.rootPath, "dorn-installer.json");
      if (!fs.existsSync(configPath)) {
        return {
          handled: true,
          content: "No existe `dorn-installer.json`. Pide primero: “prepara un instalador para este proyecto”."
        };
      }
      const configuration = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const report = this.installer.analyzeSource(project.rootPath, configuration);
      const extensions = Object.entries(report.byExtension)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([extension, bytes]) => `- ${extension}: ${(bytes / 1024 ** 2).toFixed(2)} MB`);
      return {
        handled: true,
        content: [
          `Análisis del instalador de **${report.product.name}**:`,
          "",
          `- Archivos: ${report.fileCount.toLocaleString("es-CL")}`,
          `- Peso sin comprimir: ${(report.totalBytes / 1024 ** 2).toFixed(2)} MB`,
          "- Distribución por tipo:",
          ...extensions
        ].join("\n"),
        report
      };
    }
    if (command.async === "bridge-run") {
      const project = this.project(command.projectId);
      const result = await this.bridge.run(
        command.connectorId,
        command.operation,
        project.rootPath,
        { relativePath: command.relativePath }
      );
      return {
        handled: true,
        content: [
          `${result.application} completó **${result.operation}** en ${(result.durationMs / 1000).toFixed(1)} s.`,
          "",
          result.message,
          "",
          ...result.artifacts.map((artifact) => `- ${artifact.name} · ${(artifact.sizeBytes / 1024 ** 2).toFixed(2)} MB · SHA-256 \`${artifact.sha256.slice(0, 16)}…\``),
          "",
          "Los resultados permanecen aislados. DORN pedirá aprobación antes de copiarlos al proyecto."
        ].join("\n"),
        result
      };
    }
    return command;
  }

  registerIpc(handle) {
    handle("dorn:suite_status", () => this.status());
    handle("dorn:suite_verify", () => this.verification());
    handle("dorn:suite_products", () => this.products());
    handle("dorn:suite_modes_list", () => this.modeManager.list());
    handle("dorn:suite_mode_current", (_event, projectId) => this.modeManager.current(projectId || null));
    handle("dorn:suite_mode_select", (_event, modeId, projectId) => this.modeManager.select(String(modeId), projectId || null));
    handle("dorn:suite_response_strategies", () => this.modeManager.strategies());
    handle("dorn:suite_response_strategy", (_event, projectId) => this.modeManager.strategy(projectId || null));
    handle("dorn:suite_response_strategy_select", (_event, strategyId, projectId) => this.modeManager.selectStrategy(String(strategyId), projectId || null));
    handle("dorn:suite_preferences_get", () => this.preferences.settings());
    handle("dorn:suite_preferences_configure", (_event, patch) => this.preferences.configure(patch || {}));
    handle("dorn:suite_workspace_suggest", (_event, text, currentWorkspace) => this.preferences.suggestWorkspace(String(text), String(currentWorkspace || "create")));
    handle("dorn:suite_prompt_explorer_catalog", (_event, filters) => this.promptExplorer.catalog(filters || {}));
    handle("dorn:suite_prompt_explorer_get", (_event, promptId) => this.promptExplorer.get(String(promptId)));
    handle("dorn:suite_prompt_explorer_build", (_event, promptId, input) => this.promptExplorer.build(String(promptId), input || {}));
    handle("dorn:suite_prompt_explorer_favorite", (_event, promptId, favorite) => this.promptExplorer.setFavorite(String(promptId), favorite === true));
    handle("dorn:suite_prompt_explorer_recent", () => this.promptExplorer.recent());
    handle("dorn:suite_memory_settings", () => this.memory.settings());
    handle("dorn:suite_memory_configure", (_event, patch) => this.memory.configure(patch || {}));
    handle("dorn:suite_memory_project", (_event, projectId) => this.memory.getProject(String(projectId)));
    handle("dorn:suite_memory_remember", (_event, projectId, entry) => this.memory.rememberProject(String(projectId), entry || {}));
    handle("dorn:suite_memory_search", (_event, projectId, query, limit) => this.memory.search(String(projectId), String(query), Number(limit || 8)));
    handle("dorn:suite_memory_remove", (_event, projectId, type, entryId) => this.memory.remove(String(projectId), String(type), entryId || null));
    handle("dorn:suite_memory_export", () => this.memory.exportAll());
    handle("dorn:suite_memory_graph_add", (_event, relation) => this.memory.addGraphRelation(relation || {}));
    handle("dorn:suite_agents_roles", () => this.agents.roles());
    handle("dorn:suite_agents_plan", (_event, request) => this.agents.plan(request || {}));
    handle("dorn:suite_agents_active", () => this.agents.activeTasks());
    handle("dorn:suite_plugins_list", () => this.plugins.list());
    handle("dorn:suite_plugin_inspect", () => this.inspectPluginDialog());
    handle("dorn:suite_plugin_install", (_event, token, permissions) => this.installPlugin(String(token), Array.isArray(permissions) ? permissions : []));
    handle("dorn:suite_plugin_enable", (_event, pluginId, enabled) => this.plugins.setEnabled(String(pluginId), Boolean(enabled)));
    handle("dorn:suite_plugin_remove", (_event, pluginId, removeData) => this.plugins.remove(String(pluginId), Boolean(removeData)));
    handle("dorn:suite_plugin_invoke", (_event, pluginId, command, input) => this.plugins.invoke(String(pluginId), String(command), input));
    handle("dorn:suite_3d_formats", () => this.geometry.formats());
    handle("dorn:suite_3d_inspect", (_event, projectId, relativePath) => {
      const project = this.project(String(projectId));
      return this.geometry.inspect(project.rootPath, String(relativePath));
    });
    handle("dorn:suite_3d_recommend", (_event, projectId, relativePath) => {
      const project = this.project(String(projectId));
      return this.geometry.recommend(project.rootPath, String(relativePath));
    });
    handle("dorn:suite_3d_prepare_edit", (_event, projectId, relativePath, operation) => {
      const project = this.project(String(projectId));
      return this.geometry.prepareObjEdit(project.rootPath, String(relativePath), operation || {});
    });
    handle("dorn:suite_3d_create_table", (_event, parameters) => this.geometry.createIndustrialTable(parameters || {}));
    handle("dorn:suite_doctor", () => this.doctor.run());
    handle("dorn:suite_installer_template", () => this.installer.projectTemplate());
    handle("dorn:suite_installer_analyze", (_event, projectId, configuration) => {
      const project = this.project(String(projectId));
      return this.installer.analyzeSource(project.rootPath, configuration || {});
    });
    handle("dorn:suite_installer_verify", (_event, productId) => this.installer.verifyInstallation(String(productId)));
    handle("dorn:suite_installer_compare", (_event, leftManifest, rightManifest) => this.installer.compare(leftManifest, rightManifest));
    handle("dorn:suite_installer_deduplicate", (_event, manifests) => this.installer.analyzeDeduplication(Array.isArray(manifests) ? manifests : []));
    handle("dorn:suite_bridge_list", () => this.bridge.list());
    handle("dorn:suite_bridge_inspect", (_event, manifest) => this.bridge.inspect(manifest || {}));
    handle("dorn:suite_bridge_register", (_event, manifest, permissions) => this.bridge.register(manifest || {}, Array.isArray(permissions) ? permissions : []));
    handle("dorn:suite_bridge_enable", (_event, connectorId, enabled) => this.bridge.setEnabled(String(connectorId), Boolean(enabled)));
    handle("dorn:suite_bridge_remove", (_event, connectorId) => this.bridge.remove(String(connectorId)));
    handle("dorn:suite_bridge_run", (_event, connectorId, operation, projectId, input, options) => {
      const project = this.project(String(projectId));
      return this.bridge.run(String(connectorId), String(operation), project.rootPath, input || {}, options || {});
    });
    handle("dorn:suite_help_topics", () => this.help.topics());
    handle("dorn:suite_help_search", (_event, query, limit) => this.help.search(String(query), Number(limit || 5)));
    handle("dorn:suite_help_provider", (_event, query) => this.help.providerGuide(String(query)));
    handle("dorn:suite_help_diagnose_provider", (_event, errorText) => this.help.diagnoseProviderError(String(errorText)));
    handle("dorn:suite_model_profiles", () => this.modelProfiles.list());
    handle("dorn:suite_model_profile", (_event, providerId, modelName) => this.modelProfiles.get(String(providerId), String(modelName)));
    handle("dorn:suite_model_profile_save", (_event, providerId, modelName, patch) => this.modelProfiles.save(String(providerId), String(modelName), patch || {}));
    handle("dorn:suite_account_status", () => this.services.recovery.profileStatus());
    handle("dorn:suite_account_local_profile", (_event, patch) => this.services.recovery.configureLocalProfile(patch || {}));
    handle("dorn:suite_recovery_list", () => this.services.recovery.listBackups());
    handle("dorn:suite_recovery_create", (_event, passphrase) => this.services.recovery.createBackup({ passphrase: String(passphrase || ""), suiteVersion: SUITE_VERSION }));
    handle("dorn:suite_recovery_verify", (_event, filePath, passphrase) => this.services.recovery.verifyBackup(String(filePath), String(passphrase || "")));
    handle("dorn:suite_recovery_restore", (_event, filePath, passphrase, confirmation) => this.services.recovery.restoreBackup(String(filePath), String(passphrase || ""), confirmation === true));
    handle("dorn:suite_telemetry_status", () => this.services.telemetry.status());
    handle("dorn:suite_telemetry_configure", (_event, patch) => this.services.telemetry.configure(patch || {}));
    handle("dorn:suite_voice_status", () => this.services.voice.status());
    handle("dorn:suite_voice_speak", (_event, text, options) => this.services.voice.speak(String(text), options || {}));
    handle("dorn:suite_voice_stop", () => this.services.voice.stop());
    handle("dorn:suite_image_providers", () => this.services.images.candidates());
    handle("dorn:suite_image_generate", (_event, options) => this.services.images.generate(options || {}));
    handle("dorn:suite_collaboration_status", () => this.services.collaboration.status());
    handle("dorn:suite_collaboration_start", (_event, options) => this.services.collaboration.start(options || {}));
    handle("dorn:suite_collaboration_stop", () => this.services.collaboration.stop());
    handle("dorn:suite_collaboration_messages", () => structuredClone(this.services.collaboration.state.messages));
    handle("dorn:suite_collaboration_post", (_event, message) => this.services.collaboration.appendMessage(message || {}));
  }

  stop() {
    return this.services.stop();
  }
}

module.exports = {
  SUITE_VERSION,
  MODULES,
  DornSuiteCore
};
