"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { writeInstallMetadata } = require("../scripts/build-native-installer.cjs");
const { verifyInstallManifest } = require("../scripts/verify-native-installer.cjs");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sha256 = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

function temporary(context, prefix) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(output, { recursive: true, force: true }));
  return output;
}

function fixture(context) {
  const stage = temporary(context, "dorn-install-manifest-");
  fs.mkdirSync(path.join(stage, "resources", "startup"), { recursive: true });
  fs.writeFileSync(path.join(stage, "DORN AI.exe"), "PE fixture main");
  fs.writeFileSync(path.join(stage, "DORN AI Uninstall.exe"), "PE fixture uninstall");
  fs.writeFileSync(path.join(stage, "resources", "app.asar"), "asar fixture");
  fs.writeFileSync(path.join(stage, "resources", "startup", "splash.html"), "DORN 4.0");
  writeInstallMetadata(stage, "4.0.0-alpha.7");
  return stage;
}

test("el payload declara un conjunto exacto, propiedad y hashes por archivo", (context) => {
  const stage = fixture(context);
  const result = verifyInstallManifest(stage);
  assert.equal(result.manifest.schema, "dorn.install-files/1");
  assert.equal(result.manifest.appId, "com.dorn.ai");
  assert.equal(result.files.length, 4);
  const ownerPath = path.join(stage, "DORN-INSTALL-OWNERSHIP.json");
  const manifestPath = path.join(stage, "DORN-INSTALL-MANIFEST.json");
  const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  assert.equal(owner.schema, "dorn.install-ownership/1");
  assert.equal(owner.manifestSha256, sha256(manifestPath));
});

test("el verificador rechaza bytes alterados, archivos extra y colisiones de mayúsculas", (context) => {
  const changed = fixture(context);
  fs.appendFileSync(path.join(changed, "resources", "app.asar"), "alterado");
  assert.throws(() => verifyInstallManifest(changed), /Hash o tamaño inválido/);

  const extra = fixture(context);
  fs.writeFileSync(path.join(extra, "inyectado.dll"), "extra");
  assert.throws(() => verifyInstallManifest(extra), /conjunto instalado no es exacto/);

  const collision = fixture(context);
  fs.writeFileSync(path.join(collision, "dorn ai.exe"), "collision");
  assert.throws(() => verifyInstallManifest(collision), /Colisión de ruta Windows/);
});

test("el instalador sólo reemplaza una instalación DORN exacta y conserva rollback", () => {
  const native = read("installer/native/dorn-installer.c");
  assert.match(native, /function Test-DornTree/);
  assert.match(native, /La carpeta no está vacía ni pertenece a una instalación DORN verificable/);
  assert.match(native, /\.dorn-backup-/);
  assert.match(native, /Move-Item -LiteralPath \$backup -Destination \$target/);
  assert.match(native, /La instalación copiada no coincide byte por byte con su manifiesto/);
  assert.match(native, /owned_uninstall_location/);
  assert.match(native, /Este desinstalador fue movido/);
  assert.match(native, /InstallLocation/);
  assert.match(native, /validate_install_tree_with_powershell/);
  assert.match(native, /DORN no borrará recursivamente esta carpeta/);
  assert.doesNotMatch(native, /New-Item -ItemType Directory -Path \$target -Force\|Out-Null\r\\n"\s*L"Get-ChildItem[\s\S]{0,120}-Force/);
});

test("el compilador bloqueado recuperado coincide con la revisión declarada", () => {
  const zig = path.join(root, "build-tools", "zig-linux-x64", "zig");
  assert.equal(fs.statSync(zig).size, 156675992);
  assert.equal(sha256(zig), "b3d5e9eec6159a1eac821c38cbadde5bae3b174d31c71232f134218dbd62170d");
});
