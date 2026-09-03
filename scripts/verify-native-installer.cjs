"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { inspectPe, sha256, verifyPortable } = require("./verify-windows-runtime.cjs");

const TRAILER_SIZE = 56;
const MAGIC = "DORNZIP3";
const INSTALL_MANIFEST = "DORN-INSTALL-MANIFEST.json";
const INSTALL_OWNERSHIP = "DORN-INSTALL-OWNERSHIP.json";

function copyAndHashRange(sourcePath, destinationPath, offset, size) {
  const source = fs.openSync(sourcePath, "r");
  const destination = fs.openSync(destinationPath, "w");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let cursor = offset;
  let remaining = size;
  try {
    while (remaining) {
      const wanted = Math.min(buffer.length, remaining);
      const read = fs.readSync(source, buffer, 0, wanted, cursor);
      if (read !== wanted) throw new Error("El payload del instalador está truncado.");
      fs.writeSync(destination, buffer, 0, read);
      hash.update(buffer.subarray(0, read));
      cursor += read;
      remaining -= read;
    }
  } finally {
    fs.closeSync(source);
    fs.closeSync(destination);
  }
  return hash.digest("hex");
}

function regularFiles(root, excluded = new Set()) {
  const files = [];
  const folded = new Map();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) throw new Error(`Enlace no permitido en el instalador: ${relativePath}`);
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!entry.isFile()) throw new Error(`Entrada no regular en el instalador: ${relativePath}`);
      if (excluded.has(relativePath)) continue;
      const key = relativePath.toLocaleLowerCase("en-US");
      if (folded.has(key)) throw new Error(`Colisión de ruta Windows: ${folded.get(key)} / ${relativePath}`);
      folded.set(key, relativePath);
      files.push(relativePath);
    }
  };
  walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function readStrictJson(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw new Error(`${label} no es un archivo regular acotado.`);
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { throw new Error(`${label} no contiene JSON válido.`); }
}

function verifyInstallManifest(extracted) {
  const manifestPath = path.join(extracted, INSTALL_MANIFEST);
  const ownershipPath = path.join(extracted, INSTALL_OWNERSHIP);
  if (!fs.existsSync(manifestPath) || !fs.existsSync(ownershipPath)) throw new Error("Faltan los metadatos de propiedad del instalador.");
  const manifest = readStrictJson(manifestPath, INSTALL_MANIFEST);
  const ownership = readStrictJson(ownershipPath, INSTALL_OWNERSHIP);
  if (manifest.schema !== "dorn.install-files/1" || ownership.schema !== "dorn.install-ownership/1") throw new Error("Contrato de instalación desconocido.");
  if (manifest.product !== "DORN AI" || manifest.appId !== "com.dorn.ai" || ownership.product !== manifest.product || ownership.appId !== manifest.appId || ownership.version !== manifest.version) {
    throw new Error("La propiedad del payload no corresponde a DORN AI.");
  }
  if (!/^[a-f0-9]{64}$/.test(ownership.manifestSha256) || sha256(manifestPath) !== ownership.manifestSha256) throw new Error("El manifiesto de archivos no coincide con la propiedad firmada por el payload.");
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("El manifiesto del instalador está vacío.");
  const expected = new Map();
  for (const entry of manifest.files) {
    const relativePath = String(entry?.path || "").replaceAll("\\", "/");
    if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("El manifiesto contiene una ruta insegura.");
    const key = relativePath.toLocaleLowerCase("en-US");
    if (expected.has(key)) throw new Error("El manifiesto contiene rutas duplicadas para Windows.");
    expected.set(key, { ...entry, path: relativePath });
  }
  const actual = regularFiles(extracted, new Set([INSTALL_MANIFEST, INSTALL_OWNERSHIP]));
  if (actual.length !== expected.size) throw new Error(`El conjunto instalado no es exacto: ${actual.length}/${expected.size}.`);
  for (const relativePath of actual) {
    const declared = expected.get(relativePath.toLocaleLowerCase("en-US"));
    if (!declared || declared.path !== relativePath) throw new Error(`Archivo no declarado o con mayúsculas distintas: ${relativePath}`);
    const filePath = path.join(extracted, ...relativePath.split("/"));
    if (fs.statSync(filePath).size !== Number(declared.sizeBytes) || sha256(filePath) !== declared.sha256) throw new Error(`Hash o tamaño inválido: ${relativePath}`);
  }
  return { manifest, files: actual };
}

function comparePortableFiles(portable, extracted) {
  const files = regularFiles(portable);
  for (const relativePath of files) {
    const expected = path.join(portable, ...relativePath.split("/"));
    const actual = path.join(extracted, ...relativePath.split("/"));
    if (!fs.existsSync(actual) || fs.statSync(expected).size !== fs.statSync(actual).size || sha256(expected) !== sha256(actual)) {
      throw new Error(`${relativePath} no coincide byte por byte con el paquete de aplicación.`);
    }
  }
  return files.length;
}

function verifyNativeInstaller(installerPath, portablePath) {
  const installer = path.resolve(installerPath);
  const portable = path.resolve(portablePath);
  if (!fs.existsSync(installer) || !fs.existsSync(portable)) throw new Error("Falta el instalador o el portable para verificar.");
  const size = fs.statSync(installer).size;
  const pe = inspectPe(installer);
  if (!pe.complete || pe.machine !== 0x8664 || pe.optionalMagic !== 0x20b) throw new Error("El instalador no es PE32+ x64 completo.");
  const descriptor = fs.openSync(installer, "r");
  const trailer = Buffer.alloc(TRAILER_SIZE);
  try {
    fs.readSync(descriptor, trailer, 0, trailer.length, size - TRAILER_SIZE);
  } finally {
    fs.closeSync(descriptor);
  }
  if (trailer.subarray(0, 8).toString("ascii") !== MAGIC) throw new Error("Falta el tráiler DORNZIP3.");
  const offset = Number(trailer.readBigUInt64LE(8));
  const payloadSize = Number(trailer.readBigUInt64LE(16));
  const expectedHash = trailer.subarray(24, 56).toString("hex");
  if (offset + payloadSize + TRAILER_SIZE !== size || payloadSize < 100 * 1024 * 1024) throw new Error("El tamaño declarado del payload es inválido.");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-installer-verify-"));
  const archive = path.join(tempRoot, "payload.zip");
  const extracted = path.join(tempRoot, "payload");
  try {
    const actualHash = copyAndHashRange(installer, archive, offset, payloadSize);
    if (actualHash !== expectedHash) throw new Error("El SHA-256 del payload no coincide con el tráiler.");
    const zipTest = spawnSync("unzip", ["-tq", archive], { encoding: "utf8" });
    if (zipTest.status !== 0) throw new Error(`El ZIP interno es inválido: ${zipTest.stderr || zipTest.stdout}`);
    fs.mkdirSync(extracted);
    const unzip = spawnSync("unzip", ["-q", archive, "-d", extracted], { encoding: "utf8" });
    if (unzip.status !== 0) throw new Error(`No se pudo extraer el payload: ${unzip.stderr || unzip.stdout}`);
    const portableResult = verifyPortable(extracted);
    if (portableResult.failures.length) throw new Error(`El payload no supera la verificación Windows:\n- ${portableResult.failures.join("\n- ")}`);
    const installManifest = verifyInstallManifest(extracted);
    const comparedFiles = comparePortableFiles(portable, extracted);
    const uninstallPath = path.join(extracted, "DORN AI Uninstall.exe");
    const uninstallPe = inspectPe(uninstallPath);
    if (!uninstallPe.complete || uninstallPe.machine !== 0x8664 || uninstallPe.optionalMagic !== 0x20b) {
      throw new Error("El desinstalador incluido no es PE32+ x64 completo.");
    }
    return {
      installer,
      installerBytes: size,
      installerSha256: sha256(installer),
      payloadBytes: payloadSize,
      payloadSha256: actualHash,
      comparedFiles,
      manifestedFiles: installManifest.files.length,
      uninstallerBytes: uninstallPe.size,
      runtimeBytes: portableResult.pe.size
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runCli() {
  const [installer, portable] = process.argv.slice(2);
  if (!installer || !portable) {
    console.error("Uso: node scripts/verify-native-installer.cjs <instalador.exe> <carpeta-portable>");
    process.exit(2);
  }
  const result = verifyNativeInstaller(installer, portable);
  console.log(
    `Instalador verificado · PE32+ x64 · ${result.installerBytes} bytes · payload ${result.payloadBytes} bytes · ${result.comparedFiles} archivos de aplicación idénticos · ${result.manifestedFiles} archivos declarados exactos`
  );
  console.log(`SHA-256 instalador · ${result.installerSha256}`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = { regularFiles, verifyInstallManifest, verifyNativeInstaller };
