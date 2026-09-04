"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const test = require("node:test");

const {
  GOLDEN_FILES,
  containsInlineCode,
  generateWebGoldenProject,
  normalizeBrief,
  validateWebGoldenFiles,
  writeWebGoldenFiles
} = require("../out/main/dorn-core/web-golden-project.js");

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), "dorn-web-golden-")); }

test("el autor crea un sitio profesional determinista con ocho archivos y tres direcciones visuales", () => {
  const first = generateWebGoldenProject({ siteName: "DORN Forge", headline: "Diseñar. Construir. Verificar." });
  const second = generateWebGoldenProject({ siteName: "DORN Forge", headline: "Diseñar. Construir. Verificar." });
  assert.deepEqual(first.files, second.files);
  assert.deepEqual(Object.keys(first.files).sort(), [...GOLDEN_FILES].sort());
  assert.equal(first.report.passed, true);
  const contract = JSON.parse(first.files["design-contract.json"]);
  assert.equal(contract.directions.length, 3);
  assert.ok(contract.directions.some((direction) => direction.id === contract.selectedDirection));
  assert.deepEqual(contract.externalRuntimeDependencies, []);
});

test("el contenido del usuario se escapa y nunca entra como HTML, script o ruta", () => {
  const project = generateWebGoldenProject({
    siteName: `<img src=x onerror=alert(1)>`,
    headline: `</h1><script>fetch("https://evil.invalid")</script><h1>`,
    features: [{ title: "<svg/onload=alert(1)>", copy: "Texto\u0000control" }]
  });
  assert.equal(containsInlineCode(project.files["index.html"]), false);
  assert.doesNotMatch(project.files["index.html"], /<script>fetch|<svg\/onload/i);
  assert.match(project.files["index.html"], /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(validateWebGoldenFiles(project.files).passed, true);
});

test("la verificación hostil rechaza scripts inline, red, eval y pérdida de accesibilidad", () => {
  const cases = [
    ["index.html", (value) => value.replace("<main id=\"contenido\">", "<main>")],
    ["index.html", (value) => value.replace("</body>", "<script>alert(1)</script></body>")],
    ["index.html", (value) => value.replace("./assets/system-map.svg", "https://evil.invalid/asset.svg")],
    ["styles.css", (value) => value.replace(/@media \(prefers-reduced-motion:[\s\S]*$/, "")],
    ["app.js", (value) => `${value}\neval(\"1\");\n`],
    ["assets/system-map.svg", (value) => value.replace("</svg>", '<script href="https://evil.invalid/x.js"/></svg>')]
  ];
  for (const [name, mutate] of cases) {
    const files = structuredClone(generateWebGoldenProject().files);
    files[name] = mutate(files[name]);
    assert.equal(validateWebGoldenFiles(files).passed, false, `Mutación no detectada: ${name}`);
  }
});

test("la escritura no sobrescribe archivos existentes y rechaza symlinks de directorio", () => {
  const project = generateWebGoldenProject();
  const root = temp();
  writeWebGoldenFiles(root, project.files);
  assert.throws(() => writeWebGoldenFiles(root, project.files), (error) => error.code === "WEB_GOLDEN_TARGET_EXISTS");

  const linkedRoot = temp();
  const external = temp();
  fs.symlinkSync(external, path.join(linkedRoot, "assets"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => writeWebGoldenFiles(linkedRoot, project.files), (error) => error.code === "WEB_GOLDEN_DIRECTORY_UNSAFE");
});

test("el verificador independiente generado pasa desde una carpeta limpia", () => {
  const root = temp();
  const project = generateWebGoldenProject({ siteName: "Golden Independent" });
  writeWebGoldenFiles(root, project.files);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const result = childProcess.spawnSync(process.execPath, ["--test", "tests/golden.test.cjs"], {
    cwd: root, encoding: "utf8", env: environment, shell: false, timeout: 20_000, windowsHide: true
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /pass 1/);
});

test("el brief se acota sin perder la intención principal", () => {
  const brief = normalizeBrief({ siteName: " X ".repeat(200), features: Array.from({ length: 20 }, (_, index) => ({ title: `F${index}`, copy: "C" })) });
  assert.ok(brief.siteName.length <= 80);
  assert.equal(brief.features.length, 6);
  assert.equal(brief.features[0].title, "F0");
});
