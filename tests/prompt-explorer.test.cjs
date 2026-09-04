"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  BUILTIN_PROMPTS,
  EXTERNAL_REFERENCE,
  PROMPT_EXPLORER_SCHEMA,
  PromptExplorer
} = require("../out/main/dorn-suite/prompt-explorer");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sha256 = (relativePath) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");

test("Prompt Explorer ofrece un catálogo original, local, filtrable y acotado", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-prompt-explorer-"));
  try {
    const explorer = new PromptExplorer(stateRoot);
    const catalog = explorer.catalog();
    assert.equal(catalog.schema, PROMPT_EXPLORER_SCHEMA);
    assert.equal(catalog.source, "DORN_BUILTIN_ORIGINAL");
    assert.equal(catalog.externalReference, EXTERNAL_REFERENCE);
    assert.equal(catalog.offline, true);
    assert.equal(catalog.total, 12);
    assert.equal(BUILTIN_PROMPTS.length, 12);
    assert.ok(catalog.categories.includes("Presentation"));
    assert.deepEqual(explorer.catalog({ query: "presentación" }).entries.map((entry) => entry.id), ["cinematic-deck-system"]);
    assert.deepEqual(explorer.catalog({ category: "Game UI" }).entries.map((entry) => entry.id), ["immersive-game-hud"]);
    assert.equal(explorer.catalog({ limit: 99999 }).entries.length, 12);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("favoritos y uso reciente persisten sin aceptar identificadores desconocidos", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-prompt-state-"));
  try {
    const first = new PromptExplorer(stateRoot);
    assert.deepEqual(first.setFavorite("desktop-creation-studio", true), {
      id: "desktop-creation-studio",
      favorite: true,
      count: 1
    });
    first.build("desktop-creation-studio", { brief: "Editor CAD profesional" });
    const restored = new PromptExplorer(stateRoot);
    assert.equal(restored.get("desktop-creation-studio").favorite, true);
    assert.equal(restored.catalog({ favoritesOnly: true }).matched, 1);
    assert.equal(restored.recent()[0].id, "desktop-creation-studio");
    assert.throws(() => restored.get("../../fuera"), /no existe/i);
    assert.throws(() => restored.setFavorite("desconocido", true), /no existe/i);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("preparar un prompt reemplaza variables, limita entradas y nunca lo ejecuta", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-prompt-build-"));
  try {
    const explorer = new PromptExplorer(stateRoot);
    const result = explorer.build("editorial-launch", {
      brief: `Una plataforma de ingeniería\u0000${"X".repeat(9000)}`,
      platform: "Windows y web",
      framework: "React",
      theme: "plateado técnico"
    });
    assert.match(result.prompt, /Una plataforma de ingeniería/);
    assert.match(result.prompt, /Windows y web/);
    assert.match(result.prompt, /React/);
    assert.match(result.prompt, /plateado técnico/);
    assert.doesNotMatch(result.prompt, /\{\{(?:brief|platform|framework|theme)\}\}/);
    assert.doesNotMatch(result.prompt, /\u0000/);
    assert.ok(result.values.brief.length <= 8000);
    assert.equal(result.provenance.executed, false);
    assert.equal(result.provenance.source, "DORN_BUILTIN_ORIGINAL");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("la integración está dentro de Configuración y sólo cruza IPC declarativo", () => {
  const center = read("out/renderer/vendor/dorn-control-center.js");
  const css = read("out/renderer/vendor/dorn-control-center.css");
  const preload = read("out/preload/index.js");
  const suite = read("out/main/dorn-suite/suite-core.js");
  assert.match(center, /navButton\("prompt-explorer", "Prompt Explorer"\)/);
  assert.match(center, /data-page="prompt-explorer"/);
  assert.match(center, /catálogo original DORN/);
  assert.match(center, /Aún no se ha enviado ni ejecutado/);
  assert.match(center, /noopener noreferrer/);
  assert.doesNotMatch(center, /<iframe[^>]+uiprompt\.art/i);
  assert.match(css, /\.dorn-prompt-layout/);
  assert.match(css, /\.dorn-prompt-card/);
  assert.match(preload, /promptExplorer:\s*\{/);
  assert.match(preload, /dorn:suite_prompt_explorer_catalog/);
  assert.match(suite, /new PromptExplorer\(this\.stateRoot\)/);
  assert.match(suite, /dorn:suite_prompt_explorer_build/);
});

test("la presentación aportada conserva la historia visual y el splash sigue siendo el original 4.0", () => {
  assert.equal(
    sha256("verification/ui-references/DORN_Presentacion_Animada.html"),
    "6895ae5e0a97fcbf1a0398611b07fd5e42163cfbf0eb4ceac82f87ab4a76731e"
  );
  const splash = read("resources/startup/splash.html");
  assert.equal(
    sha256("resources/startup/splash.html"),
    "0ea4b7bd85888af4e43fa91a0297d68d3ea4def6f0483603c9cba45a3502df15"
  );
  assert.match(splash, /font-size:\s*clamp\(128px, 18vw, 190px\)/);
  assert.match(splash, /letter:nth-child\(4\)/);
  assert.match(splash, /window-out \.3s 6\.7s ease forwards/);
  assert.match(splash, /loading-dots/);
  assert.match(splash, /aria-label="DORN"/);
  assert.doesNotMatch(splash, /<img\b|dorn-logo|fonts\.googleapis|fonts\.gstatic/i);
});
