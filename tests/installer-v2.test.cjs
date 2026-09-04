"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { writeMetadata } = require("../scripts/build-installer-v2.cjs");
const { inspectRepairableTree, verifyTree } = require("../out/main/dorn-core/installer-transaction-v2.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-installer-v2-test-"));
  fs.writeFileSync(path.join(root, "DORN AI.exe"), "app");
  fs.writeFileSync(path.join(root, "DORN AI Uninstall.exe"), "uninstall");
  fs.mkdirSync(path.join(root, "resources")); fs.writeFileSync(path.join(root, "resources", "app.asar"), "asar");
  writeMetadata(root, "4.0.0-alpha.7"); return root;
}

test("manifest v2 verifica un árbol exacto", () => {
  const root = fixture(); try { assert.equal(verifyTree(root).files, 3); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("un archivo alterado bloquea la verificación pero permite reparación controlada", () => {
  const root = fixture(); try { fs.writeFileSync(path.join(root, "resources", "app.asar"), "alterado"); assert.throws(() => verifyTree(root), /alterado/); assert.equal(inspectRepairableTree(root).repairable, true); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("un archivo ajeno bloquea el reemplazo de la carpeta", () => {
  const root = fixture(); try { fs.writeFileSync(path.join(root, "AJENO.txt"), "no"); assert.throws(() => inspectRepairableTree(root), /ajeno/i); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Installer v2 no usa PowerShell ni crea productos separados", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "installer", "v2", "native", "dorn-installer-v2.c"), "utf8");
  assert.doesNotMatch(source, /powershell|Expand-Archive|ExecutionPolicy/i);
  assert.doesNotMatch(source, /DORN Design\.lnk|DORN Machine\.lnk|DORN Education\.lnk|DORN Editor\.lnk/);
  assert.match(source, /DORNZIP4/);
});
