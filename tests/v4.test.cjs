"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const resourceRoot = path.resolve(process.env.DORN_TEST_RESOURCES_PATH || path.join(root, "resources"));

test("v4 conserva el menú robusto y mueve catálogo a Modelos y APIs", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  assert.match(renderer, /Modelos y APIs/);
  assert.match(renderer, /Catálogo y recomendaciones/);
  assert.match(renderer, /window\.dornControlCenter\?\.open\("catalog"\)/);
  assert.doesNotMatch(renderer, /" DORN Local"\n/);
});

test("el panel derecho comienza cerrado y persiste la decisión", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  assert.match(renderer, /dorn:context-panel:v1/);
  assert.match(renderer, /=== "open"/);
  assert.match(renderer, /contextOpen \? "open" : "closed"/);
});

test("proyectos y conversaciones tienen eliminación directa visible", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const css = read("out/renderer/assets/index-BPpPUW8P.css");
  assert.match(renderer, /onRemoveProject/);
  assert.match(renderer, /window\.dorn\.projects\.remove/);
  assert.match(renderer, /conversation-delete/);
  assert.match(css, /\.project-remove/);
  assert.match(css, /\.conversation-delete/);
});

test("adjuntos duplicados se rechazan y las imágenes tienen vista previa", () => {
  const main = read("out/main/index.js");
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  assert.match(main, /result\.sha256/);
  assert.match(main, /previewDataUrl/);
  assert.match(renderer, /Esa imagen ya está adjunta/);
  assert.match(renderer, /message-image-preview/);
  assert.match(renderer, /image-attachment/);
});

test("Design envía una imagen a DORN AI y añade pincel, línea e imagen", () => {
  const html = read("out/design/index.html");
  const app = read("out/design/app.js");
  assert.match(html, /data-tool="brush"/);
  assert.match(html, /data-tool="line"/);
  assert.match(html, /data-action="import-image"/);
  assert.match(app, /createPngDataUrl/);
  assert.match(app, /imageDataUrl/);
  assert.doesNotMatch(app, /Analiza este proyecto de DORN Design.*JSON\.stringify/s);
});

test("Education implementa enseñanza, alternativas A-E y progreso local", () => {
  const html = read("out/education/index.html");
  const app = read("out/education/app.js");
  assert.match(html, /DORN Education/);
  assert.match(html, /Aprende antes de responder/i);
  assert.match(app, /const LETTERS = \["A", "B", "C", "D", "E"\]/);
  assert.match(app, /preguntas incluidas son originales|simulacro original/i);
  assert.match(app, /localStorage\.setItem/);
  assert.match(html, /Corrector de clavijeros PAES/);
  assert.match(html, /PERFIL ADAPTATIVO/);
  assert.match(app, /DORN_PAES_2026/);
  assert.match(app, /scoreTable/);
  assert.match(app, /Correcto\. ✓|incorrecta\. ×/);
});

test("Machine sólo muestra productos físicos oficiales de DORN", () => {
  const html = read("out/machine/index.html");
  const app = read("out/machine/app.js");
  assert.match(html, /DORN Machine/);
  assert.match(html, /sólo mostrará hardware publicado y firmado por DORN/i);
  assert.match(html, /Conectores de hardware/);
  assert.match(app, /OFFICIAL_DORN_PRODUCTS = Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(app, /localStorage|Añadir dispositivo|crypto\.randomUUID/);
  assert.match(app, /parada de emergencia/);
});

test("las aprobaciones de chat usan un panel local y no frases con tokens", () => {
  const actions = read("out/main/dorn-v3-chat-actions.js");
  const main = read("out/main/index.js");
  const preload = read("out/preload/index.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  assert.doesNotMatch(actions, /APROBAR CAMBIOS|CANCELAR CAMBIOS/);
  assert.match(actions, /decisión es local y no consume tokens/i);
  assert.match(main, /dorn:chat_pending_decide/);
  assert.match(preload, /decide: \(conversationId, decision\)/);
  assert.match(center, /Sí a todas las siguientes/);
  assert.match(center, /data-approval-next/);
  assert.match(center, /DECISIÓN LOCAL · 0 TOKENS/);
});

test("el instalador permite elegir productos y conserva DORN AI obligatorio", () => {
  const installer = read("installer/dorn-installer.nsi");
  assert.match(installer, /DORN AI es obligatorio/);
  assert.match(installer, /DesignCheckbox/);
  assert.match(installer, /EducationCheckbox/);
  assert.match(installer, /MachineCheckbox/);
  assert.match(installer, /EditorCheckbox/);
  assert.match(installer, /dorn-products\.ini/);
  assert.match(installer, /resources\\startup\\icons\\education\.ico/);
});

test("los productos se abren desde accesos directos con animación temática", () => {
  const main = read("out/main/index.js");
  const splash = fs.readFileSync(path.join(resourceRoot, "startup/splash.html"), "utf8");
  const installer = read("installer/dorn-installer.nsi");
  assert.match(main, /--product=/);
  assert.match(main, /education:/);
  assert.match(main, /machine:/);
  assert.match(splash, /data-product="design"/);
  assert.match(splash, /ADAPTIVE LEARNING SYSTEM/);
  assert.match(installer, /DORN Education\.lnk/);
  assert.match(installer, /DORN Machine\.lnk/);
});

test("la apariencia segura alcanza inicio y productos sin fondos saturados", () => {
  const store = read("out/main/dorn-suite/appearance-store.js");
  const appearance = read("out/renderer/vendor/dorn-appearance.js");
  const main = read("out/main/index.js");
  assert.match(store, /safeCustomPalette/);
  assert.match(appearance, /safeCustomPalette/);
  assert.match(main, /appearanceStore\.palette\(\)/);
  assert.match(main, /accent: appearance\?\.accent/);
});

test("scripts viven en Desarrollador y exigen vista previa", () => {
  const center = read("out/renderer/vendor/dorn-control-center.js");
  assert.match(center, /data-page="developer"/);
  assert.match(center, /dorn\.v3\.terminal\.preview/);
  assert.match(center, /dorn\.v3\.terminal\.execute/);
  assert.match(center, /VISTA PREVIA — AÚN NO EJECUTADO/);
});

test("la enciclopedia mundial se integra como referencia y no como descarga fingida", () => {
  const html = read("out/renderer/index.html");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const catalog = JSON.parse(read("resources/catalog/dorn-ai-encyclopedia.json"));
  assert.match(html, /dorn-ai-encyclopedia\.js/);
  assert.equal(catalog.stats.entries, 984);
  assert.equal(catalog.stats.sections, 43);
  assert.ok(catalog.entries.every((entry) => entry.needsVerification === true));
  assert.match(center, /Enciclopedia mundial/);
  assert.match(center, /REFERENCIA · REQUIERE VERIFICACIÓN/);
  assert.match(center, /no la marca como descargable ni conectable/i);
});

test("automático vuelve a recomendar con la lista vigente en cada envío", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const main = read("out/main/index.js");
  assert.match(renderer, /const recommendation = await window\.dorn\.chat\.recommend\(content, workspace\)/);
  assert.match(renderer, /mode\.id === "manual"/);
  assert.match(main, /const available = providers\.list\(\)\.filter/);
  assert.match(main, /recommendProvider\(available/);
});

test("Configuración usa sólo el Centro DORN grande para conexiones", () => {
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  assert.match(renderer, /window\.dornOpenProviderSettings = \(\) => window\.dornControlCenter\?\.open\("connections"\)/);
  assert.match(center, /data-page="connections"/);
  assert.match(center, /Éste es el único menú de conexiones de DORN/);
  assert.match(center, /window\.dorn\.providers\.save/);
  assert.match(center, /window\.dorn\.providers\.test/);
});

test("cada ficha de IA recibe una identidad visual estable de DORN", () => {
  const html = read("out/renderer/index.html");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const css = read("out/renderer/vendor/dorn-control-center.css");
  const brands = JSON.parse(read("resources/catalog/ai-logos/MANIFEST.json"));
  assert.match(html, /dorn-ai-brand-assets\.js/);
  assert.equal(brands.license, "CC0-1.0");
  assert.ok(Object.keys(brands.aliases).length >= 17);
  assert.match(center, /const aiAvatar =/);
  assert.match(center, /aiAvatar\(model\.label, model\.id, "LOCAL", model\.publisher\)/);
  assert.match(center, /aiAvatar\(entry\.name, entry\.id, "REF", entry\.company\)/);
  assert.match(css, /\.dorn-ai-avatar/);
  assert.match(css, /\.dorn-ai-avatar img/);
});
