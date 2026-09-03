"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { writeMetadata } = require("../scripts/build-installer-v2.cjs");
const { inspectRepairableTree, verifyTree } = require("../out/main/dorn-core/installer-transaction-v2.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-installer-v3-test-"));
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

test("Installer v3 no usa PowerShell ni crea productos separados", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "installer", "v3", "native", "dorn-installer-v3.c"), "utf8");
  assert.doesNotMatch(source, /powershell|Expand-Archive|ExecutionPolicy/i);
  assert.doesNotMatch(source, /DORN Design\.lnk|DORN Machine\.lnk|DORN Education\.lnk|DORN Editor\.lnk/);
  assert.match(source, /DORNZIP4/);
});

test("Installer v3 limita extractor y agentes; ningún hijo crítico espera para siempre", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "installer", "v3", "native", "dorn-installer-v3.c"), "utf8");
  assert.match(source, /DORN_TIMEOUT_EXTRACT_MS/);
  assert.match(source, /DORN_TIMEOUT_AGENT_MS/);
  assert.match(source, /WAIT_TIMEOUT/);
  assert.match(source, /TerminateProcess/);
  assert.doesNotMatch(source, /WaitForSingleObject\(process\.hProcess,\s*INFINITE\)/);
});

test("Installer v3 declara éxito antes de limpiar el respaldo anterior", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "installer", "v3", "native", "dorn-installer-v3.c"), "utf8");
  const successBlock = source.indexOf('post_finish(options->window, TRUE');
  const cleanup = source.indexOf('delete_tree_safe(backup)', successBlock);
  assert.ok(successBlock > 0 && cleanup > successBlock);
  assert.match(source, /BACKUP_CLEANUP_DEFERRED/);
});

test("DORN Linux se prepara como proceso separado y no bloquea la instalación", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "installer", "v3", "native", "dorn-installer-v3.c"), "utf8");
  assert.match(source, /IDC_LINUX/);
  assert.match(source, /--install --distribution Ubuntu --no-launch/);
  assert.match(source, /ShellExecuteExW/);
  assert.match(source, /SEE_MASK_NOCLOSEPROCESS/);
  assert.match(source, /if \(request\.hProcess\) CloseHandle\(request\.hProcess\)/);
});

test("Installer v3 deja un registro persistente y accionable", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "installer", "v3", "native", "dorn-installer-v3.c"), "utf8");
  assert.match(source, /installer-v3\.log/);
  assert.match(source, /INSTALL_FAILED/);
  assert.match(source, /FINISH_OK/);
});
