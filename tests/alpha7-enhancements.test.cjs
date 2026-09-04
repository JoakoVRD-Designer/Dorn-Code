"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ModeManager, RESPONSE_STRATEGIES } = require("../out/main/dorn-suite/modes-memory");
const { normalizeAppearance } = require("../out/main/dorn-suite/appearance-store");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("modo de selección y estrategia de respuesta son decisiones independientes", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-strategy-"));
  try {
    fs.writeFileSync(path.join(stateRoot, "modes.json"), JSON.stringify({
      globalMode: "team",
      projects: {},
      schemaVersion: 2,
      updatedAt: new Date().toISOString()
    }));
    const manager = new ModeManager(stateRoot);
    assert.equal(manager.current().id, "automatic");
    assert.equal(manager.strategy().id, "multi");
    assert.deepEqual(Object.keys(RESPONSE_STRATEGIES), ["single", "multi"]);
    assert.equal(manager.list().some((mode) => mode.id === "team"), false);
    manager.select("manual");
    manager.selectStrategy("single");
    const restored = new ModeManager(stateRoot);
    assert.equal(restored.current().id, "manual");
    assert.equal(restored.strategy().id, "single");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("Varias IAs requiere confirmación, muestra el equipo y limita proveedores distintos", () => {
  const main = read("out/main/index.js");
  const renderer = read("out/renderer/assets/index-CBtOwcb-.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const modes = read("out/main/dorn-suite/modes-memory.js");
  assert.match(main, /collaborationCandidates\(primaryId, limit = 4/);
  assert.match(main, /seenGroups\.has\(key\)/);
  assert.match(main, /Math\.min\(4, Number\(limit\)/);
  assert.match(main, /Nada se ejecutará sin tu confirmación/);
  assert.match(main, /request\.multiAiConfirmed !== true/);
  assert.match(renderer, /mode\.id === "manual" \|\| recommendation\.collaboration === true/);
  assert.match(renderer, /multiAiConfirmed: resolved\.recommendation\?\.collaboration === true/);
  assert.match(renderer, /route-collaboration/);
  assert.match(renderer, /Confirmar hasta/);
  assert.match(modes, /Una IA por respuesta/);
  assert.match(modes, /Varias IAs por respuesta/);
  assert.match(center, /Independiente del modo de selección/);
});

test("el catálogo añade APIs utilizables con recursos oficiales y retira servicios cerrados", () => {
  const main = read("out/main/index.js");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  for (const provider of ["SambaNova Cloud", "DeepInfra", "Nebius Token Factory", "AI/ML API", "Novita AI", "SiliconFlow", "LiteLLM Gateway", "Open WebUI Gateway"]) {
    assert.match(center, new RegExp(provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const endpoint of ["api.sambanova.ai/v1", "api.deepinfra.com/v1/openai", "api.tokenfactory.nebius.com/v1", "api.aimlapi.com/v1", "api.novita.ai/openai", "api.siliconflow.com/v1"]) {
    assert.match(main, new RegExp(endpoint.replace(/[.]/g, "\\.")));
  }
  assert.match(center, /AI_PROVIDER_RESOURCES/);
  assert.match(center, /Obtener clave/);
  assert.match(center, /Documentación/);
  assert.doesNotMatch(center, /id: "github-models"/);
});

test("Personalización ofrece cinco intensidades y sanea valores desconocidos", () => {
  for (const intensity of ["very-soft", "soft", "balanced", "dynamic", "aggressive"]) {
    assert.equal(normalizeAppearance({ motionIntensity: intensity }).motionIntensity, intensity);
  }
  assert.equal(normalizeAppearance({ motionIntensity: "explosive" }).motionIntensity, "balanced");
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const css = read("out/renderer/vendor/dorn-control-center.css");
  assert.match(center, /Muy suave/);
  assert.match(center, /Agresivo/);
  assert.match(center, /panel\.style\.animation = "none"/);
  assert.match(css, /data-dorn-motion-intensity="aggressive"/);
  assert.match(css, /data-dorn-window-effect="default"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("el instalador incluye bosque propio y movimiento nativo sin debilitar el hash", () => {
  const source = read("installer/native/dorn-installer.c");
  const resources = read("installer/native/dorn-installer.rc");
  const asarBuilder = read("scripts/build-app-asar.cjs");
  assert.match(resources, /dorn-installer-forest\.bmp/);
  assert.match(source, /DORN_ANIMATION_TIMER/);
  assert.match(source, /g_particles/);
  assert.match(source, /StretchBlt/);
  assert.match(source, /DORN_TRAILER_MAGIC "DORNZIP3"/);
  assert.match(source, /hash_file_range/);
  assert.match(asarBuilder, /fs\.rmSync\(path\.join\(target, "output"\)/);
  assert.ok(fs.statSync(path.join(root, "installer/assets/dorn-installer-forest.png")).size > 500000);
  assert.ok(fs.statSync(path.join(root, "installer/assets/dorn-installer-forest.bmp")).size > 1000000);
});

test("el editable puede probarse sin una carpeta externa de DORN Admin", () => {
  const integration = read("tests/alpha5.test.cjs");
  const packager = read("scripts/package-editable-two-zips.cjs");
  assert.match(integration, /adminIntegrationAvailable/);
  assert.match(integration, /skip: !adminIntegrationAvailable/);
  assert.doesNotMatch(integration, /require\("\.\.\/\.\.\/DORN_Admin_Permanent/);
  assert.match(packager, /childRelative\.startsWith\(`\$\{installerOutput\}\$\{path\.sep\}`\)/);
  assert.match(packager, /finalInstallerOutput/);
});
