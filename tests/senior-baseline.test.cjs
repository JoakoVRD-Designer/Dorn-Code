"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const baselinePath = path.join(root, "verification", "ui-4.0-baseline.json");
const ledgerPath = path.join(root, "verification", "ui-4.0-change-ledger.json");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function icoSizes(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.ok(bytes.length >= 6, `ICO truncado: ${filePath}`);
  assert.equal(bytes.readUInt16LE(0), 0, `Encabezado ICO reservado inválido: ${filePath}`);
  assert.equal(bytes.readUInt16LE(2), 1, `El recurso no es un ICO: ${filePath}`);
  const count = bytes.readUInt16LE(4);
  assert.ok(count > 0 && bytes.length >= 6 + count * 16, `Directorio ICO truncado: ${filePath}`);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = bytes[offset] === 0 ? 256 : bytes[offset];
    const height = bytes[offset + 1] === 0 ? 256 : bytes[offset + 1];
    assert.equal(width, height, `Entrada ICO no cuadrada: ${filePath}`);
    sizes.push(width);
  }
  return [...new Set(sizes)].sort((left, right) => right - left);
}

function currentProtectedFiles(entries) {
  const output = [];
  const visit = (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const stat = fs.lstatSync(absolutePath);
    assert.equal(stat.isSymbolicLink(), false, `Symlink no permitido en superficie protegida: ${relativePath}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolutePath).sort((left, right) => left.localeCompare(right))) {
        visit(path.posix.join(relativePath.split(path.sep).join(path.posix.sep), name));
      }
    } else if (stat.isFile()) {
      output.push(relativePath.split(path.sep).join(path.posix.sep));
    }
  };
  for (const entry of entries) visit(entry);
  return output.sort((left, right) => left.localeCompare(right));
}

test("la identidad visual 4.0 sólo cambia mediante un ledger explícito y verificable", () => {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  assert.equal(baseline.schema, "dorn.ui-baseline/1");
  assert.equal(ledger.schema, "dorn.ui-change-ledger/1");
  assert.equal(baseline.requirements.startupDurationMs, 7000);
  assert.equal(baseline.requirements.startupDurationMandatory, true);

  const baselineByPath = new Map(baseline.files.map((entry) => [entry.path, entry]));
  const ledgerByPath = new Map(ledger.entries.map((entry) => [entry.path, entry]));
  const currentPaths = currentProtectedFiles(baseline.protectedEntries);
  const allPaths = new Set([...baselineByPath.keys(), ...currentPaths]);

  for (const relativePath of [...allPaths].sort((left, right) => left.localeCompare(right))) {
    const baselineEntry = baselineByPath.get(relativePath) || null;
    const absolutePath = path.join(root, relativePath);
    const currentSha256 = fs.existsSync(absolutePath) ? sha256(absolutePath) : null;
    if (baselineEntry?.sha256 === currentSha256) continue;

    const decision = ledgerByPath.get(relativePath);
    assert.ok(decision, `Cambio visual no registrado: ${relativePath}`);
    assert.equal(decision.baselineSha256 ?? null, baselineEntry?.sha256 ?? null, `Baseline incorrecto: ${relativePath}`);
    assert.equal(decision.currentSha256 ?? null, currentSha256, `Hash actual incorrecto: ${relativePath}`);
    assert.equal(decision.status, "APPROVED_FOR_DORN_4_0_EVOLUTION", `Estado no aprobado: ${relativePath}`);
    assert.ok(String(decision.reason || "").trim().length >= 20, `Falta una razón concreta: ${relativePath}`);
    assert.ok(Array.isArray(decision.tests) && decision.tests.length > 0, `Faltan regresiones: ${relativePath}`);
    assert.ok(String(decision.rollback || "").trim().length > 0, `Falta rollback: ${relativePath}`);
  }
});

test("el splash conserva siete segundos exactos y no bloquea la preparación interna", () => {
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  assert.match(main, /const STARTUP_SPLASH_DURATION_MS\s*=\s*7000/);
  assert.match(main, /const STARTUP_SPLASH_WIDTH\s*=\s*760/);
  assert.match(main, /const STARTUP_SPLASH_HEIGHT\s*=\s*440/);
  assert.match(main, /const STARTUP_SPLASH_ALWAYS_ON_TOP_LEVEL\s*=\s*"screen-saver"/);
  assert.match(main, /splashDeadline\s*=\s*Date\.now\(\)\s*\+\s*STARTUP_SPLASH_DURATION_MS/);
  assert.match(main, /setTimeout\(revealMainAfterIntro,\s*STARTUP_SPLASH_DURATION_MS\)/);
  assert.match(main, /startupWindow\.setAlwaysOnTop\(true,\s*STARTUP_SPLASH_ALWAYS_ON_TOP_LEVEL\)/);
  assert.match(main, /createStartupSplash\(settings,\s*appearanceStore\.palette\(\)\)/);
  assert.match(main, /show:\s*false[\s\S]{0,180}frame:\s*false/);
  assert.match(main, /Presentación DORN visible y prioritaria durante 7 segundos/);
});

test("el símbolo oficial queda fuera de la interfaz y completo en los puntos de integración externos", () => {
  const officialSource = path.join(root, "resources", "startup", "dorn-logo-official-source.ico");
  assert.equal(sha256(officialSource), "0e0b4c43251e8299b6b8d3433f18bf3357bf0c0660be839aceada4b07adbe59e");

  const icoFiles = [
    path.join(root, "resources", "startup", "icon-v4.ico"),
    path.join(root, "resources", "startup", "icon.ico"),
    path.join(root, "installer", "assets", "dorn-installer.ico"),
    path.join(root, "build", "icon.ico")
  ];
  for (const filePath of icoFiles) {
    assert.deepEqual(icoSizes(filePath), [256, 128, 64, 48, 32, 16], `Resoluciones incompletas: ${filePath}`);
    assert.equal(sha256(filePath), "4cfd2370fba76efb400acaa2007c57a291d614ae3761d942eca2f2bff777b01d");
  }

  const pngFiles = [
    path.join(root, "resources", "startup", "icon-v4.png"),
    path.join(root, "resources", "startup", "icon.png"),
    path.join(root, "installer", "assets", "dorn-installer-icon.png"),
    path.join(root, "build", "icon.png")
  ];
  for (const filePath of pngFiles) {
    assert.equal(sha256(filePath), "7cc83e50344c96548be4b7df2db4f949740acd854a023cd76a7ba780216edf9d");
  }

  const splash = fs.readFileSync(path.join(root, "resources", "startup", "splash.html"), "utf8");
  assert.doesNotMatch(splash, /<img\b|dorn-logo|icon-v4|\.ico\b|\.png\b/i);
  assert.match(splash, /aria-label="DORN"/);
  assert.match(splash, />D<\/span><span class="letter">O<\/span><span class="letter">R<\/span><span class="letter">N<\/span>/);

  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  assert.match(main, /icon:\s*assetPath\("icon-v4\.ico"\)/);
  assert.match(main, /new electron\.Tray\(assetPath\(process\.platform === "win32" \? "icon-v4\.ico" : "icon-v4\.png"\)\)/);
  assert.match(main, /new electron\.Notification\([\s\S]{0,220}icon:\s*assetPath\("icon\.png"\)/);
});

test("el menú, Productos y la personalización completa de DORN 4.0 permanecen presentes", () => {
  const rendererFiles = [
    path.join(root, "out", "renderer", "assets", "index-CBtOwcb-.js"),
    path.join(root, "out", "renderer", "vendor", "dorn-control-center.js")
  ];
  const source = rendererFiles.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
  for (const label of [
    "Crear",
    "Ingeniería",
    "Aprender",
    "Analizar",
    "Automatizar",
    "Personalización",
    "Productos",
    "Desarrollador",
    "Plugins",
    "Fondo con imagen o GIF",
    "Reemplazar imagen o GIF",
    "Animación de inicio DORN",
    "Firma sonora de inicio"
  ]) {
    assert.ok(source.includes(label), `Elemento visual 4.0 ausente: ${label}`);
  }
});

test("la meta global impide declarar DORN completo mientras quede trabajo sin evidencia", () => {
  const gate = JSON.parse(fs.readFileSync(path.join(root, "verification", "dorn-completion-gate.json"), "utf8"));
  const baseline = fs.readFileSync(path.join(root, "DORN-SENIOR-BASELINE.md"), "utf8");
  assert.equal(gate.schema, "dorn.completion-gate/1");
  assert.equal(gate.canonicalBase, "DORN AI 4.0.0-alpha.7");
  assert.equal(gate.globalState, "PARTIAL");
  assert.equal(gate.workingRules.stopOnPartialSuccess, false);
  assert.equal(gate.workingRules.deleteWithoutDocumentedReason, false);
  assert.equal(gate.workingRules.requireHostileRegression, true);
  assert.ok(gate.completionRequires.some((requirement) => requirement.includes("Windows 11")));
  assert.ok(gate.completionRequires.some((requirement) => requirement.includes("PARTIAL, BLOCKED or NEEDS_RETEST")));
  assert.match(baseline, /Meta de cierre continuo/);
  assert.match(baseline, /Una función existente no se\s+elimina sin causa técnica documentada/);
});
