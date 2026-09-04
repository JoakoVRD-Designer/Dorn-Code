"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ModeManager } = require("../out/main/dorn-suite/modes-memory");
const { PreferenceEngine } = require("../out/main/dorn-suite/preference-engine");
const { AppearanceStore } = require("../out/main/dorn-suite/appearance-store");
const richRender = require("../out/renderer/vendor/dorn-rich-render");
const { inspectPe } = require("../scripts/verify-windows-runtime.cjs");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const resourceRoot = path.resolve(process.env.DORN_TEST_RESOURCES_PATH || path.join(root, "resources"));

test("la versión de paquete es 4.0.0 alpha 7", () => {
  assert.equal(JSON.parse(read("package.json")).version, "4.0.0-alpha.7");
});

test("el arranque temprano registra fallos anteriores a la interfaz", () => {
  const packageJson = JSON.parse(read("package.json"));
  const bootstrap = read("out/main/bootstrap.js");
  assert.equal(packageJson.main, "./out/main/bootstrap.js");
  assert.match(bootstrap, /dorn-bootstrap\.log/);
  assert.match(bootstrap, /require\("\.\/index\.js"\)/);
  assert.match(bootstrap, /showErrorBox/);
});

test("el verificador PE acepta los binarios x64 completos de DORN Local", () => {
  const pe = inspectPe(path.join(resourceRoot, "local-ai/runtime/llama-server.exe"));
  assert.equal(pe.machine, 0x8664);
  assert.equal(pe.optionalMagic, 0x20b);
  assert.equal(pe.complete, true);
  assert.equal(pe.requiredSize, pe.size);
});

test("el verificador de publicación rechaza ejecutables Electron truncados", () => {
  const verifier = read("scripts/verify-windows-runtime.cjs");
  assert.match(verifier, /sus secciones requieren al menos/);
  assert.match(verifier, /MIN_ELECTRON_EXE_BYTES/);
  assert.match(verifier, /ELECTRON-RUNTIME\.json/);
});

test("el smoke de arranque cubre SQLite, Suite Core y creación de ventanas", () => {
  const smoke = read("scripts/smoke-main-process.cjs");
  assert.match(smoke, /Base de datos lista/);
  assert.match(smoke, /DORN Suite Core 4\\\.0\\\.0-alpha\\\.3 listo/);
  assert.match(smoke, /require\("\.\.\/out\/main\/bootstrap\.js"\)/);
});

test("el inicio recuperado de v0.4 usa los recursos reales en editable y portable", () => {
  const main = read("out/main/index.js");
  const splash = fs.readFileSync(path.join(resourceRoot, "startup/splash.html"), "utf8");
  assert.match(main, /function startupAssetPath\(filename\)/);
  assert.match(main, /"resources", "startup", filename/);
  assert.match(main, /setVisibleOnAllWorkspaces\(true/);
  assert.match(main, /const STARTUP_SPLASH_DURATION_MS = 7000/);
  assert.match(main, /splashDeadline = Date\.now\(\) \+ STARTUP_SPLASH_DURATION_MS/);
  assert.match(main, /setTimeout\(revealMainAfterIntro, STARTUP_SPLASH_DURATION_MS\)/);
  assert.match(main, /createStartupSplash\(settings, appearanceStore\.palette\(\)\)/);
  assert.match(splash, /aria-label="DORN"/);
  assert.match(splash, /window\.dornPlayStartupSound/);
  assert.match(splash, /window-out \.3s 6\.7s ease forwards/);
  assert.match(splash, /loading-dots/);
  assert.ok(fs.statSync(path.join(resourceRoot, "startup/dorn-startup.wav")).size > 500e3);
});

test("las preferencias controlan por separado animación y sonido de inicio", () => {
  const main = read("out/main/index.js");
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  assert.match(main, /settings\.introAnimation === false/);
  assert.match(main, /settings\.introSound !== false/);
  assert.match(renderer, /Animación de inicio DORN/);
  assert.match(renderer, /Firma sonora de inicio/);
  assert.match(renderer, /introAnimation: event\.target\.checked/);
  assert.match(renderer, /introSound: event\.target\.checked/);
});

test("el desarrollo editable utiliza el runtime local incluido en resources", () => {
  const main = read("out/main/index.js");
  assert.match(main, /electron\.app\.getAppPath\(\), "resources", "local-ai"/);
  assert.doesNotMatch(main, /electron\.app\.getAppPath\(\), "vendor", "local-ai"/);
});

test("el editable reconstruye app.asar con dependencias de producción limpias", () => {
  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));
  const builder = read("scripts/build-app-asar.cjs");
  assert.equal(packageJson.scripts["pack:asar"], "node scripts/build-app-asar.cjs");
  assert.equal(packageJson.devDependencies.electron, "37.2.6");
  assert.equal(packageLock.packages["node_modules/electron"].version, "37.2.6");
  assert.match(builder, /\["ci", "--omit=dev"/);
  assert.match(builder, /asar\.createPackage/);
  assert.doesNotMatch(builder, /resources\/local-ai/);
});

test("el instalador evita truncar el ejecutable grande y verifica su tamaño", () => {
  const shellBuilder = read("installer/build-installer.sh");
  const windowsBuilder = read("installer/build-installer.ps1");
  const nsis = read("installer/dorn-installer.nsi");
  assert.match(shellBuilder, /split -b 16m/);
  assert.match(shellBuilder, /part_count" -ne 13/);
  assert.match(shellBuilder, /part_sha256/);
  assert.match(shellBuilder, /part_bytes/);
  assert.match(windowsBuilder, /DORN_AI_EXE\.part/);
  assert.match(windowsBuilder, /DORN_AI_EXE\.verify/);
  assert.match(windowsBuilder, /verifyHash -ne \$exeHash/);
  assert.match(nsis, /copy \/B/);
  assert.match(nsis, /DORN_AI_EXE\.part012/);
  assert.match(nsis, /DORN_EXE_SIZE/);
  assert.match(nsis, /SetCompressor lzma/);
  assert.doesNotMatch(nsis, /SetCompressor \/SOLID/);
  assert.match(nsis, /esta aplicación no puede ejecutarse en este equipo/);
});

test("las dependencias completas necesarias para arrancar se pueden cargar", () => {
  for (const dependency of ["archiver", "electron-updater", "extract-zip", "zod"]) {
    assert.doesNotThrow(() => require(dependency), `No se pudo cargar ${dependency}`);
  }
});

test("una instalación nueva comienza en modo automático", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-mode-"));
  try {
    const manager = new ModeManager(stateRoot);
    assert.equal(manager.current().id, "automatic");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("el modo seleccionado persiste", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-mode-"));
  try {
    new ModeManager(stateRoot).select("automatic");
    assert.equal(new ModeManager(stateRoot).current().id, "automatic");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("volver a automático limpia modos antiguos por proyecto", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-mode-"));
  try {
    const manager = new ModeManager(stateRoot);
    manager.select("manual", "proyecto-1");
    assert.equal(manager.current("proyecto-1").id, "manual");
    manager.select("automatic");
    assert.equal(manager.current("proyecto-1").id, "automatic");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("el renderer diferencia flujo automático y manual", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  assert.match(renderer, /mode\.id === "manual"/);
  assert.match(renderer, /dispatchSend\(resolved, recommendation\.providerId\)/);
  assert.match(renderer, /dispatchSend\(pending, selectedProvider\)/);
});

test("el centro de control queda cargado bajo CSP local", () => {
  const html = read("out/renderer/index.html");
  assert.match(html, /dorn-control-center\.css/);
  assert.match(html, /dorn-control-center\.js/);
});

test("el centro elimina el Asistente separado y conserva los espacios del producto", () => {
  const script = read("out/renderer/vendor/dorn-control-center.js");
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  assert.doesNotMatch(script, /data-page="assistant"|data-page-target="assistant"/);
  for (const kind of ["create", "engineering", "learn", "analyze", "automate"]) assert.match(renderer, new RegExp(`id: "${kind}"`));
});

test("la interfaz declara veinte paletas y accesibilidad", () => {
  const script = read("out/renderer/vendor/dorn-appearance.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const themes = [
    "graphite", "titanium", "midnight", "amber", "emerald", "violet", "crimson",
    "arctic", "cobalt", "ocean", "cyan", "teal", "forest", "lime", "copper",
    "bronze", "rose", "magenta", "indigo", "sand"
  ];
  for (const theme of themes) {
    assert.match(script, new RegExp(`\\b${theme}:`));
    assert.match(center, new RegExp(`\\["${theme}"`));
  }
  assert.equal(themes.length, 20);
  assert.match(center, /Densidad:/);
  assert.match(center, /Movimiento:/);
  assert.match(center, /Contraste:/);
});

test("la guía conserva identidad, emergencia y límites honestos", () => {
  const main = read("out/main/index.js");
  assert.match(main, /Joaquín Maximiliano Verdejo Pinto/);
  assert.match(main, /freno de emergencia/);
  assert.match(main, /nunca afirmes que ejecutaste algo que no realizaste/i);
});

test("las preferencias especializadas comienzan desactivadas", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-preferences-"));
  try {
    const settings = new PreferenceEngine(stateRoot).settings();
    assert.equal(settings.personality, "direct");
    assert.equal(settings.learning, false);
    assert.equal(settings.engineering, false);
    assert.equal(settings.gamers, false);
    assert.equal(settings.keepLocalWarm, false);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("las preferencias cambian el prompt y persisten", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-preferences-"));
  try {
    const engine = new PreferenceEngine(stateRoot);
    engine.configure({ personality: "mentor", learning: true, gamers: true, developerMode: true });
    const restored = new PreferenceEngine(stateRoot);
    assert.equal(restored.settings().personality, "mentor");
    assert.match(restored.promptFragment(), /MODO GAMERS/);
    assert.match(restored.promptFragment(), /No evadas anti-cheat/);
    assert.match(restored.promptFragment(), /vista previa, aprobación y registro/);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("DORN sugiere espacios sin mover chats silenciosamente", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-preferences-"));
  try {
    const engine = new PreferenceEngine(stateRoot);
    engine.configure({ learning: true });
    const suggestion = engine.suggestWorkspace("Prepárame una prueba tipo PAES", "create");
    assert.equal(suggestion.id, "learn");
    assert.equal(suggestion.enabled, true);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("el renderizador reserva matemáticas imaginarias en línea y bloque", () => {
  const sample = String.raw`$$i = \\sqrt{-1}$$ y $i^2=-1$`;
  const result = richRender._private.reserveMath(sample);
  assert.equal(result.values.length, 2);
  assert.match(result.values[0].formula, /sqrt/);
  assert.equal(result.values[0].display, true);
  assert.equal(result.values[1].display, false);
});

test("el centro v4 integra preferencias, productos y desarrollador sin Installer Studio", () => {
  const script = read("out/renderer/vendor/dorn-control-center.js");
  const css = read("out/renderer/vendor/dorn-control-center.css");
  assert.match(script, /ALPHA INTERNA/);
  assert.match(script, /navButton\("preferences", "Preferencias"\)/);
  assert.match(script, /navButton\("products", "Productos"\)/);
  assert.match(script, /navButton\("plugins", "Plugins"\)/);
  assert.match(script, /navButton\("developer", "Desarrollador"\)/);
  assert.doesNotMatch(script, /data-tab="installer"/);
  assert.match(script, /Plugins para DORN 5\.0/);
  assert.match(css, /grid-template-columns: 232px minmax\(0, 1fr\)/);
  assert.match(css, /flex-direction: column/);
});

test("el campo del chat conserva textos largos y crece hasta 320 px", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const css = read("out/renderer/assets/index-BPpPUW8P.css");
  assert.match(renderer, /Math\.min\(target\.scrollHeight, 320\)/);
  assert.match(renderer, /wrap: "soft"/);
  assert.match(css, /max-height: 320px/);
  assert.match(css, /white-space: pre-wrap/);
});

test("DORN Local puede precargarse sin eliminar sus límites de seguridad", () => {
  const main = read("out/main/index.js");
  assert.match(main, /preferences\.settings\(\)\.keepLocalWarm/);
  assert.match(main, /localRuntime\.ensureReady\(\)/);
  assert.match(main, /Las acciones críticas siempre requieren confirmación/);
});

test("la matriz conserva exactamente 152 puntos y 3 pendientes", () => {
  const data = JSON.parse(read("dorn-v3-requirements.json"));
  const requirements = data.requirements || data.items || data;
  assert.equal(requirements.length, 152);
  assert.equal(requirements.filter((item) => item.status === "pending").length, 3);
  assert.equal(requirements.filter((item) => item.status === "partial-alpha.6").length, 10);
  assert.equal(requirements.filter((item) => item.status === "partial-alpha.7").length, 7);
});

test("los contratos CAD son JSON válido y no fingen motores instalados", () => {
  const schema = JSON.parse(read("sdk/bridge/cad-operation.schema.json"));
  const matrix = JSON.parse(read("sdk/bridge/connector-capability-matrix.json"));
  assert.equal(schema.title, "DORN CAD Bridge Operation");
  assert.equal(matrix.connectors.length, 5);
  assert.ok(matrix.connectors.every((connector) => connector.status !== "active"));
});

test("el catálogo unifica modelos locales y un registro amplio de conectores orientados", () => {
  const script = read("out/renderer/vendor/dorn-control-center.js");
  assert.match(script, /navButton\("catalog", "Catálogo IA"\)/);
  assert.match(script, /data-model-search/);
  assert.match(script, /data-model-compatibility/);
  assert.match(script, /AI_CONNECTORS/);
  for (const provider of ["OpenAI", "Google Gemini", "Anthropic Claude", "xAI Grok", "DeepSeek", "LM Studio"]) {
    assert.match(script, new RegExp(provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const catalogSection = script.slice(script.indexOf("const AI_CONNECTORS"), script.indexOf("const PROVIDERS"));
  assert.ok((catalogSection.match(/{ id:/g) || []).length >= 25);
});

test("la instalación local conserva selección, reanudación y verificación", () => {
  const main = read("out/main/index.js");
  assert.match(main, /installedModelIds/);
  assert.match(main, /partialModelPath/);
  assert.match(main, /fileSha256/);
  assert.match(main, /no superó la verificación SHA-256/);
  assert.match(main, /dorn:local_runtime_download/);
});

test("DORN Lite queda separado del catálogo de modelos de DORN AI", () => {
  const main = read("out/main/index.js");
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(resourceRoot, "local-ai/manifest.json"), "utf8")
  );
  assert.match(main, /label: "Qwen3 0\.6B Q8_0"/);
  assert.match(main, /label: "Qwen3 1\.7B Q8_0"/);
  assert.doesNotMatch(main, /label: "DORN Lite"/);
  assert.doesNotMatch(main, /label: "DORN Compact"/);
  assert.doesNotMatch(renderer, /DORN Lite · Qwen3/);
  assert.equal(manifest.models[0].displayName, "Qwen3 0.6B Q8_0");
  assert.equal(manifest.models[1].displayName, "Qwen3 1.7B Q8_0");
});

test("DORN Design define documento, herramientas y exportación real", () => {
  const html = read("out/design/index.html");
  const app = read("out/design/app.js");
  assert.match(html, /DORN Design/);
  assert.match(app, /dorn-design\/1/);
  assert.match(app, /data-action='export-svg'/);
  assert.match(app, /data-action='export-png'/);
  assert.match(app, /sendToDorn/);
  assert.match(app, /history/);
});

test("DORN Editor define proyecto audiovisual no destructivo", () => {
  const html = read("out/editor/index.html");
  const app = read("out/editor/app.js");
  assert.match(html, /media-src 'self' file: blob:/);
  assert.match(app, /dorn-editor\/1/);
  assert.match(app, /splitSelected/);
  assert.match(app, /subtitles/);
  assert.match(app, /serializableProject/);
  assert.doesNotMatch(app, /ffmpeg|execFile|spawn\(/i);
});

test("las ventanas de productos están aisladas y autorizan rutas explícitas", () => {
  const main = read("out/main/index.js");
  const preload = read("out/preload/product.js");
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /authorizedPaths: new Set/);
  assert.match(main, /La ruta de guardado no fue autorizada/);
  assert.doesNotMatch(preload, /require\("node:fs"\)|require\("node:child_process"\)/);
});

test("Design y Editor pueden entregar contexto estructurado a DORN AI", () => {
  const main = read("out/main/index.js");
  const preload = read("out/preload/index.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  assert.match(main, /dorn:product_send_to_dorn/);
  assert.match(main, /dorn:product_prompt/);
  assert.match(preload, /onProductPrompt/);
  assert.match(center, /placeProductPrompt/);
});

test("el SDK de Installer Studio declara hooks y permisos sin fingir un host activo", () => {
  const schema = JSON.parse(read("sdk/installer-plugins/dorn-installer-plugin.schema.json"));
  const notes = read("sdk/installer-plugins/README.md");
  assert.equal(schema.title, "DORN Installer Studio Plugin Manifest");
  assert.ok(schema.properties.hooks.items.enum.includes("transform-manifest"));
  assert.ok(schema.properties.permissions.items.enum.includes("publish:external"));
  assert.match(notes, /host de ejecución específico.*pendiente/i);
  assert.match(notes, /Ningún plugin.*carga automáticamente/i);
});

test("las acciones de respuesta están conectadas a APIs aisladas", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const preload = read("out/preload/index.js");
  for (const label of ["Regenerar en una rama", "Escuchar", "Respuesta útil", "Respuesta incorrecta", "Guardar como Markdown"]) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(preload, /messages: \{/);
  assert.match(preload, /dorn:message_feedback/);
  assert.match(preload, /dorn:message_export/);
});

test("editar y regenerar crean ramas sin alterar el original", () => {
  const main = read("out/main/index.js");
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  assert.match(main, /branchConversation\(id, anchorMessageId\)/);
  assert.match(main, /source\.messages\.slice\(0, anchorIndex\)/);
  assert.match(main, /branch_parent_id/);
  assert.match(renderer, /Rama segura creada/);
  assert.match(renderer, /la conversación original se conserva/);
  assert.match(renderer, /dispatchSend\(resolved, recommendation\.providerId, branch\)/);
});

test("el historial permite buscar, anclar, archivar, duplicar y exportar", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  for (const label of ["Buscar conversaciones", "Cambiar el nombre", "Anclar", "Archivar", "Duplicar", "Exportar Markdown", "Exportar proyecto JSON"]) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(renderer, /conversations\.list\(\{ archived: true \}\)/);
});

test("la migración de historial conserva bases alpha anteriores", () => {
  const main = read("out/main/index.js");
  assert.match(main, /PRAGMA table_info\(conversations\)/);
  assert.match(main, /ALTER TABLE conversations ADD COLUMN archived/);
  assert.match(main, /ALTER TABLE conversations ADD COLUMN pinned/);
  assert.match(main, /ALTER TABLE conversations ADD COLUMN branch_parent_id/);
  assert.match(main, /ALTER TABLE messages ADD COLUMN feedback/);
  assert.match(main, /PRAGMA user_version = 4/);
});

test("el borrado de conversación requiere confirmación y no promete borrar proyectos", () => {
  const main = read("out/main/index.js");
  assert.match(main, /showMessageBox\(mainWindow/);
  assert.match(main, /Los archivos del proyecto no se modificarán/);
  assert.match(main, /buttons: \["Cancelar", "Eliminar"\]/);
  assert.doesNotMatch(read("out/preload/index.js"), /showMessageBox|node:fs/);
});

test("la exportación de conversación usa formatos versionados", () => {
  const main = read("out/main/index.js");
  assert.match(main, /schema: "dorn-conversation\/1"/);
  assert.match(main, /conversationMarkdown\(conversation\)/);
  assert.match(main, /showSaveDialog\(mainWindow/);
  assert.match(main, /mode: 384/);
});

test("los estilos diferencian menús de conversación y respuesta", () => {
  const css = read("out/renderer/assets/index-BPpPUW8P.css");
  assert.match(css, /\.conversation-search/);
  assert.match(css, /\.conversation-menu/);
  assert.match(css, /\.message-menu/);
  assert.match(css, /\.message-actions button\.active\.incorrect/);
});

test("el perfil Gamers conserva opciones profesionales y comienza desactivado", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-gamer-"));
  try {
    const settings = new PreferenceEngine(stateRoot).settings();
    assert.equal(settings.gamers, false);
    assert.equal(settings.gamerGoal, "play");
    assert.equal(settings.gamerLevel, "regular");
    assert.equal(settings.gamerEngine, undefined);
    assert.equal(settings.gamerPlatform, "windows");
    assert.equal(settings.gamerPerformance, true);
    assert.equal(settings.gamerTesting, true);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("Gamers persiste plataforma y prioridades de jugador en el prompt", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-gamer-"));
  try {
    new PreferenceEngine(stateRoot).configure({
      gamers: true,
      gamerGoal: "optimize",
      gamerLevel: "competitive",
      gamerPlatform: "multiplatform",
      gamerGraphics: true,
      gamerModding: true
    });
    const restored = new PreferenceEngine(stateRoot);
    assert.equal(restored.settings().gamerEngine, undefined);
    assert.match(restored.promptFragment(), /plataforma multiplataforma/);
    assert.match(restored.promptFragment(), /calidad gráfica/);
    assert.match(restored.promptFragment(), /modding autorizado/);
    assert.match(restored.promptFragment(), /No evadas anti-cheat/);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("Gamers rechaza objetivos, niveles y plataformas fuera del contrato", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-gamer-"));
  try {
    const engine = new PreferenceEngine(stateRoot);
    assert.throws(() => engine.configure({ gamerGoal: "crear-juego" }), /objetivo gamer/i);
    assert.throws(() => engine.configure({ gamerLevel: "sin-limites" }), /nivel gamer/i);
    assert.throws(() => engine.configure({ gamerPlatform: "sin-limites" }), /plataforma gamer/i);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("preferencias antiguas reciben las opciones Gamers nuevas sin perder datos", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-gamer-migration-"));
  try {
    fs.writeFileSync(path.join(stateRoot, "preferences.json"), JSON.stringify({ personality: "mentor", learning: true, gamers: true, gamerGoal: "create", gamerLevel: "advanced", gamerEngine: "unreal" }));
    const settings = new PreferenceEngine(stateRoot).settings();
    assert.equal(settings.personality, "mentor");
    assert.equal(settings.learning, true);
    assert.equal(settings.gamers, true);
    assert.equal(settings.gamerGoal, "play");
    assert.equal(settings.gamerLevel, "competitive");
    assert.equal(settings.gamerEngine, undefined);
    assert.equal(settings.gamerAccessibility, true);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("Configuración expone accesos visibles a Gamers y Personalización", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  assert.match(renderer, /dornControlCenter\?\.open\("gamers"\)/);
  assert.match(renderer, /dornControlCenter\?\.open\("colors"\)/);
  assert.match(center, /navButton\("gamers", "Gamers"\)/);
  assert.match(center, /navButton\("colors", "Personalización"\)/);
  assert.match(center, /Guardar perfil Gamers/);
});

test("Personalización admite HEX libre, contraste e intercambio versionado", () => {
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const appearance = read("out/renderer/vendor/dorn-appearance.js");
  assert.match(appearance, /function normalizeHex/);
  assert.match(appearance, /function contrastRatio/);
  assert.match(center, /\["accent", "Acento"\]/);
  assert.match(center, /\["background", "Fondo"\]/);
  assert.match(center, /data-palette-hex="\$\{key\}"/);
  assert.match(center, /data-palette-preview/);
  assert.match(center, /schema: "dorn-palette\/1"/);
  assert.match(center, /data-import-colors-file/);
});

test("la paleta se conecta a las variables del núcleo y no sólo al panel", () => {
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const appearance = read("out/renderer/vendor/dorn-appearance.js");
  const css = read("out/renderer/vendor/dorn-control-center.css");
  const html = read("out/renderer/index.html");
  for (const variable of ["--bg", "--panel", "--panel-2", "--panel-3", "--text", "--muted", "--accent"]) {
    assert.match(appearance, new RegExp(variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(center, /appearanceApi\.apply/);
  assert.match(css, /\.app-layout/);
  assert.match(css, /\.settings-window/);
  assert.match(css, /\.composer-area/);
  assert.ok(html.indexOf("index-BPpPUW8P.css") < html.indexOf("dorn-control-center.css"));
});

test("Gamers y Personalización mantienen límites de seguridad explícitos", () => {
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const engine = read("out/main/dorn-suite/preference-engine.js");
  assert.match(center, /no evade anti-cheat/i);
  assert.match(center, /vista previa, aprobación e historial/i);
  assert.match(engine, /licencias ni controles de acceso/i);
  assert.doesNotMatch(center, /desactivar anti-cheat|bypass anti-cheat/i);
});

test("la apariencia compartida persiste de forma atómica", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-appearance-"));
  try {
    const store = new AppearanceStore(stateRoot);
    assert.equal(store.get().theme, "graphite");
    store.save({
      theme: "custom",
      density: "compact",
      motion: "reduced",
      contrast: "high",
      customPalette: {
        accent: "#123456",
        background: "#010203",
        panel: "#111213",
        surface: "#212223",
        text: "#fafafa",
        muted: "#a0a0a0"
      }
    });
    const restored = new AppearanceStore(stateRoot);
    assert.equal(restored.get().schema, "dorn-appearance/2");
    assert.equal(restored.get().theme, "custom");
    assert.equal(restored.get().density, "compact");
    assert.equal(restored.get().customPalette.accent, "#123456");
    assert.notEqual(restored.backgroundColor(), "#010203");
    assert.match(restored.backgroundColor(), /^#[0-9a-f]{6}$/);
    assert.equal(fs.existsSync(path.join(stateRoot, "dorn-appearance.json")), true);
    assert.equal(fs.readdirSync(stateRoot).some((name) => name.endsWith(".tmp")), false);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("el almacén de apariencia sanea temas y colores inválidos", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-appearance-safe-"));
  try {
    const saved = new AppearanceStore(stateRoot).save({
      theme: "<script>",
      density: "microscópica",
      motion: "forzada",
      customPalette: { accent: "url(javascript:alert(1))", background: "#abc" }
    });
    assert.equal(saved.theme, "graphite");
    assert.equal(saved.density, "comfortable");
    assert.equal(saved.motion, "full");
    assert.equal(saved.customPalette.accent, "#c8d0d8");
    assert.equal(saved.customPalette.background, "#aabbcc");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("Personalización permite una imagen local compartida sin aceptar rutas ni formatos arbitrarios", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-appearance-image-"));
  const imagePath = path.join(stateRoot, "fondo.png");
  try {
    const store = new AppearanceStore(stateRoot);
    fs.writeFileSync(imagePath, Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(40, 1)
    ]));
    const imported = store.importBackground(imagePath);
    const saved = store.save({
      ...imported,
      backgroundFit: "contain",
      backgroundStrength: 68,
      backgroundBlur: 7
    });
    assert.equal(saved.backgroundMode, "image");
    assert.match(saved.backgroundImage, /^dorn-background:\/\/current\/asset\?v=[a-f0-9]{12}$/);
    assert.equal(saved.backgroundFileName, "background.png");
    assert.equal(fs.existsSync(store.backgroundFile()), true);
    assert.equal(saved.backgroundFit, "contain");
    assert.equal(saved.backgroundStrength, 68);
    assert.equal(saved.backgroundBlur, 7);
    const rejected = store.save({ backgroundMode: "image", backgroundImage: "file:///C:/secreto.png" });
    assert.equal(rejected.backgroundMode, "color");
    assert.equal(rejected.backgroundImage, "");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const appearance = read("out/renderer/vendor/dorn-appearance.js");
  const sharedCss = read("out/renderer/vendor/dorn-appearance.css");
  assert.match(center, /Fondo con imagen/);
  assert.match(center, /PNG, JPG, GIF, WebP, AVIF, BMP o ICO/);
  assert.match(center, /máximo 48 MB/);
  assert.match(appearance, /dataset\.dornBackground/);
  assert.match(sharedCss, /data-dorn-background="image"/);
  for (const product of ["renderer", "design", "editor", "education", "machine", "studio3d"]) {
    assert.match(read(`out/${product}/index.html`), /dorn-appearance\.css/);
  }
});

test("DORN AI, Design, Editor y Studio3D cargan el mismo módulo de apariencia", () => {
  const mainHtml = read("out/renderer/index.html");
  const shared = read("out/renderer/vendor/dorn-appearance.js");
  assert.match(mainHtml, /vendor\/dorn-appearance\.js/);
  for (const product of ["design", "editor", "studio3d"]) {
    assert.match(read(`out/${product}/index.html`), /\.\.\/renderer\/vendor\/dorn-appearance\.js/);
  }
  assert.match(shared, /dorn:appearance-changed/);
  assert.match(shared, /appearanceBridge\.onChange/);
  assert.match(shared, /normalizeBackgroundImage/);
  assert.match(shared, /appearanceBridge\.get\(\)/);
  assert.match(shared, /appearanceBridge\.onChange/);
  assert.match(shared, /bridge\(\)\?\.save\(appearance\)/);
});

test("el proceso principal valida y difunde la apariencia a ventanas aisladas", () => {
  const main = read("out/main/index.js");
  assert.match(main, /new AppearanceStore\(userDataPath\)/);
  assert.match(main, /dorn:appearance_get/);
  assert.match(main, /dorn:appearance_save/);
  assert.match(main, /BrowserWindow\.getAllWindows\(\)/);
  assert.match(main, /dorn:appearance_changed/);
  for (const preload of ["index", "product", "studio3d"]) {
    const source = read(`out/preload/${preload}.js`);
    assert.match(source, /appearance: \{/);
    assert.match(source, /dorn:appearance_get/);
    assert.match(source, /dorn:appearance_save/);
    assert.match(source, /dorn:appearance_changed/);
  }
});

test("el modo automático no selecciona el modelo local antes de descargarlo", () => {
  const main = read("out/main/index.js");
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  assert.match(main, /provider\.protocol !== "dorn-local" \|\| localInstalled/);
  assert.match(main, /Entra a Configuración y agrega tus IAs antes de enviar/);
  assert.match(renderer, /DORN no activa uno por defecto/);
  assert.match(renderer, /Ir a Modelos y APIs/);
});

test("la generación de imágenes usa un motor dedicado y muestra la vista previa en el chat", () => {
  const main = read("out/main/index.js");
  const suite = read("out/main/dorn-suite/suite-core.js");
  const services = read("out/main/dorn-suite/platform-services.js");
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const css = read("out/renderer/assets/index-BPpPUW8P.css");
  assert.match(main, /key: "openai-images"/);
  assert.match(main, /model: "gpt-image-2"/);
  assert.match(main, /endpoint: "\/images\/generations"/);
  assert.match(services, /provider\.capabilities\.includes\("image"\)/);
  assert.match(services, /\\\/images\\\//);
  assert.match(suite, /type: "generated-image"/);
  assert.match(suite, /previewDataUrl/);
  assert.match(suite, /No se escribió ningún archivo fuera de DORN/);
  assert.match(renderer, /assistant-generated-media/);
  assert.match(css, /\.assistant-generated-media img/);
});

test("voz continua y dictado usan el motor local de Windows", () => {
  const services = read("out/main/dorn-suite/platform-services.js");
  const main = read("out/main/index.js");
  const preload = read("out/preload/index.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  assert.match(services, /SpeechRecognitionEngine/);
  assert.match(services, /DictationGrammar/);
  assert.match(services, /System\.Speech\.Synthesis/);
  assert.match(main, /dorn:voice_recognition_start/);
  assert.match(preload, /startRecognition/);
  assert.match(center, /data-dorn-dictation/);
  assert.match(center, /voiceConversation/);
  assert.match(center, /voiceWake/);
});

test("CMD y PowerShell se confirman en una ventana compacta con Sí, No y menú", () => {
  const main = read("out/main/index.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const css = read("out/renderer/vendor/dorn-control-center.css");
  assert.match(main, /decision === "approve-next"/);
  assert.match(center, /data-approval-next/);
  assert.match(center, /Sí a todas las siguientes/);
  assert.match(center, /confirmConsoleExecution/);
  assert.match(center, /data-confirm-more/);
  assert.match(css, /dorn-approval-compact/);
  assert.match(css, /dorn-approval-more-menu/);
});

test("el menú abre únicamente el servidor oficial de Discord mediante el proceso principal", () => {
  const main = read("out/main/index.js");
  const preload = read("out/preload/index.js");
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const css = read("out/renderer/assets/index-BPpPUW8P.css");
  assert.match(main, /handle\("dorn:open_discord"/);
  assert.match(main, /https:\/\/discord\.gg\/qTBNR8du4K/);
  assert.match(main, /electron\.shell\.openExternal\(discordUrl\)/);
  assert.match(preload, /openDiscord: \(\) => electron\.ipcRenderer\.invoke\("dorn:open_discord"\)/);
  assert.match(renderer, /Comunidad DORN en Discord/);
  assert.match(renderer, /window\.dorn\.links\.openDiscord\(\)/);
  assert.match(css, /\.discord-link:hover/);
  assert.match(css, /drop-shadow\(0 0 7px rgba\(255,255,255/);
});

test("las tres aplicaciones opcionales aplican color, densidad y movimiento reducido", () => {
  for (const stylesheet of ["out/design/style.css", "out/editor/style.css", "out/studio3d/studio3d.css"]) {
    const css = read(stylesheet);
    assert.match(css, /--dorn-background/);
    assert.match(css, /--dorn-panel/);
    assert.match(css, /--dorn-accent/);
    assert.match(css, /data-dorn-density="compact"/);
    assert.match(css, /data-dorn-motion="reduced"/);
  }
});

test("Studio3D sincroniza también WebGL, rejilla y selección", () => {
  const studio = read("out/studio3d/studio3d.js");
  assert.match(studio, /function applyStudioAppearance/);
  assert.match(studio, /renderer\.setClearColor/);
  assert.match(studio, /function rebuildGrid/);
  assert.match(studio, /rimLight\.color\.set/);
  assert.match(studio, /selectionBox\.material\.color\.set/);
  assert.match(studio, /dorn:appearance-changed/);
});

test("el comando proyecto fija una ruta real antes de continuar el mensaje", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const main = read("out/main/index.js");
  const css = read("out/renderer/assets/index-BPpPUW8P.css");
  assert.ok(renderer.includes("const projectCommandMatch = prompt.match(/^\\/?proyecto"));
  assert.match(renderer, /selectProjectCommand = async \(project\)/);
  assert.match(renderer, /conversations\.create\(project\.id\)/);
  assert.match(renderer, /Proyecto “\$\{project\.name\}” fijado/);
  assert.match(renderer, /El mensaje indica qué hacer; esta vinculación fija la ruta y las herramientas/);
  assert.match(main, /Ruta de trabajo autorizada: \$\{project\.rootPath\}/);
  assert.match(main, /El mensaje del usuario define QUÉ debe hacerse; esta vinculación interna define DÓNDE debe realizarse/);
  assert.match(main, /ubícalo dentro de la raíz autorizada usando rutas relativas/);
  assert.match(main, /Usa únicamente esta ruta para las acciones de archivos y terminal/);
  assert.match(css, /\.project-command-menu/);
  assert.match(css, /\.project-context-row/);
});

test("cerrar un producto no consulta webContents después de destruir la ventana", () => {
  const main = read("out/main/index.js");
  assert.match(main, /const studioWindowId = studioWindow\.webContents\.id/);
  assert.match(main, /studio3dWindows\.delete\(studioWindowId\)/);
  assert.match(main, /const productWindowId = productWindow\.webContents\.id/);
  assert.match(main, /productWindows\.delete\(productWindowId\)/);
  assert.doesNotMatch(main, /on\("closed", \(\) => studio3dWindows\.delete\(studioWindow\.webContents\.id\)\)/);
  assert.doesNotMatch(main, /productWindows\.delete\(productWindow\.webContents\.id\)/);
});

test("los conectores nuevos completan servidor, ruta y autenticación", () => {
  const main = read("out/main/index.js");
  const help = read("out/main/dorn-suite/help-center.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  for (const preset of ["together", "fireworks", "cerebras", "perplexity", "nvidia-nim", "zai-glm"]) {
    assert.match(main, new RegExp(`key: "${preset}"`));
  }
  for (const baseUrl of ["api.together.ai/v1", "api.fireworks.ai/inference/v1", "api.cerebras.ai/v1", "api.perplexity.ai", "integrate.api.nvidia.com/v1", "api.z.ai/api/paas/v4"]) {
    assert.match(main, new RegExp(baseUrl.replace(/[.]/g, "\\.")));
  }
  assert.match(help, /Carga los modelos realmente disponibles para tu cuenta/);
  assert.match(center, /AI_PRESET_KEYS/);
  assert.match(center, /Web oficial/);
});

test("voz convierte dictado y WAV a texto en DORN AI y Education", () => {
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const education = read("out/education/app.js");
  assert.match(center, /dataset\.dornAudioTranscription/);
  assert.match(center, /transcribeAudio\("es-CL"\)/);
  assert.match(center, /data-voice-diagnostics/);
  assert.match(education, /event\.type === "text"/);
  assert.doesNotMatch(education, /event\.type === "recognized"/);
});

test("todas las entradas antiguas de Configuración abren el Centro DORN grande", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  assert.match(renderer, /identity: "preferences"/);
  assert.match(renderer, /providers: "connections"/);
  assert.match(renderer, /local: "catalog"/);
  assert.match(renderer, /set\(\{ settingsOpen: false, settingsTab \}\)/);
  assert.match(renderer, /window\.dornControlCenter\?\.open\(destination\)/);
});

test("el instalador nativo conserva diseño, selección, hash y desinstalación editable", () => {
  const native = read("installer/native/dorn-installer.c");
  const builder = read("scripts/build-native-installer.cjs");
  const verifier = read("scripts/verify-native-installer.cjs");
  const shell = read("installer/build-native-installer.sh");
  assert.match(native, /DORN_TRAILER_MAGIC "DORNZIP3"/);
  assert.match(native, /BCryptFinishHash/);
  assert.match(native, /DORN Design/);
  assert.match(native, /DORN Editor/);
  assert.match(native, /DORN Education/);
  assert.match(native, /DORN Machine/);
  assert.match(native, /DORN AI Uninstall\.exe/);
  assert.match(native, /%LOCALAPPDATA%|CSIDL_LOCAL_APPDATA/);
  assert.match(native, /finally \{if\(Test-Path -LiteralPath \$stage\)/);
  assert.match(native, /wchar_t error\[512\] = \{0\}/);
  assert.match(builder, /archiveHash\.copy\(trailer, 24\)/);
  assert.match(verifier, /comparePortableFiles/);
  assert.doesNotMatch(verifier, /compareCriticalFiles/);
  assert.match(verifier, /verifyPortable\(extracted\)/);
  assert.match(shell, /x86_64-windows-gnu/);
});
