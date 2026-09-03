"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { verifyTree } = require("../out/main/dorn-core/installer-transaction-v2.js");

const MAGIC = "DORNZIP4";
const TRAILER_SIZE = 64;
const root = path.resolve(__dirname, "..");
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, "electron-runtime.lock.json"), "utf8"));

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function copyRange(sourcePath, destinationPath, offset, size) {
  const source = fs.openSync(sourcePath, "r");
  const destination = fs.openSync(destinationPath, "wx");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let cursor = offset;
  let remaining = size;
  try {
    while (remaining > 0) {
      const wanted = Math.min(buffer.length, remaining);
      const bytes = fs.readSync(source, buffer, 0, wanted, cursor);
      if (bytes !== wanted) throw new Error("El payload del instalador está truncado.");
      fs.writeSync(destination, buffer, 0, bytes);
      hash.update(buffer.subarray(0, bytes));
      cursor += bytes;
      remaining -= bytes;
    }
  } finally {
    fs.closeSync(source);
    fs.closeSync(destination);
  }
  return hash.digest("hex");
}

function safeRelative(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return false;
  const parts = normalized.split("/");
  return !parts.some((part) => !part || part === "." || part === "..");
}

function main() {
  const [installerArgument, outputArgument] = process.argv.slice(2);
  if (!installerArgument || !outputArgument) {
    throw new Error("Uso: recover-windows-runtime-from-installer <installer-v2.exe> <carpeta-salida-nueva>");
  }
  const installer = path.resolve(installerArgument);
  const output = path.resolve(outputArgument);
  if (!fs.existsSync(installer) || !fs.statSync(installer).isFile()) throw new Error("No existe el instalador fuente.");
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error("La salida debe estar vacía.");

  const installerBytes = fs.statSync(installer).size;
  const descriptor = fs.openSync(installer, "r");
  const trailer = Buffer.alloc(TRAILER_SIZE);
  try {
    if (installerBytes <= TRAILER_SIZE) throw new Error("Instalador anormalmente pequeño.");
    const read = fs.readSync(descriptor, trailer, 0, trailer.length, installerBytes - trailer.length);
    if (read !== trailer.length) throw new Error("No se pudo leer el trailer DORNZIP4.");
  } finally {
    fs.closeSync(descriptor);
  }
  if (trailer.subarray(0, 8).toString("ascii") !== MAGIC) throw new Error("El instalador no contiene un payload DORNZIP4.");
  const offset = Number(trailer.readBigUInt64LE(8));
  const compressed = Number(trailer.readBigUInt64LE(16));
  const expectedPayloadHash = trailer.subarray(32, 64).toString("hex");
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(compressed) || offset + compressed + TRAILER_SIZE !== installerBytes) {
    throw new Error("El descriptor DORNZIP4 tiene tamaños inválidos.");
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-runtime-recovery-"));
  try {
    const archive = path.join(temp, "payload.zip");
    const payload = path.join(temp, "payload");
    const payloadHash = copyRange(installer, archive, offset, compressed);
    if (payloadHash !== expectedPayloadHash) throw new Error("El hash del payload fuente no coincide.");
    fs.mkdirSync(payload);
    const unzip = spawnSync("unzip", ["-q", archive, "-d", payload], { encoding: "utf8" });
    if (unzip.status !== 0) throw new Error(`No se pudo extraer el payload verificado: ${unzip.stderr || unzip.stdout}`);
    verifyTree(payload);

    const runtimeManifestPath = path.join(payload, "ELECTRON-RUNTIME.json");
    const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
    if (runtimeManifest.schemaVersion !== 1 || runtimeManifest.electronVersion !== lock.electronVersion || runtimeManifest.platform !== lock.platform || runtimeManifest.arch !== lock.arch) {
      throw new Error("El runtime empacado no coincide con el bloqueo de Electron.");
    }
    if (runtimeManifest.officialArchiveSha256 !== lock.archiveSha256 || runtimeManifest.officialArtifact !== lock.artifact) {
      throw new Error("El origen oficial declarado por el runtime no coincide con el bloqueo.");
    }
    const entries = Object.entries(runtimeManifest.files || {});
    if (!entries.length || entries.some(([relative]) => !safeRelative(relative))) throw new Error("El manifest del runtime es inválido.");
    if (entries.some(([relative]) => relative.toLowerCase() === "resources/app.asar")) throw new Error("El manifest mezcló la aplicación con el runtime.");

    fs.mkdirSync(output, { recursive: true });
    for (const [relative, expected] of entries) {
      const source = path.join(payload, ...relative.split("/"));
      const stat = fs.lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`Entrada de runtime insegura: ${relative}`);
      if (stat.size !== expected.size || sha256(source) !== expected.sha256) throw new Error(`Bytes de runtime alterados: ${relative}`);
      const target = path.join(output, ...relative.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }

    const brandedExecutable = path.join(output, "DORN AI.exe");
    const electronExecutable = path.join(output, "electron.exe");
    fs.renameSync(brandedExecutable, electronExecutable);
    const brandedLicense = path.join(output, "LICENSE.electron.txt");
    if (fs.existsSync(brandedLicense)) fs.renameSync(brandedLicense, path.join(output, "LICENSE"));
    if (fs.readFileSync(path.join(output, "version"), "utf8").trim() !== lock.electronVersion) throw new Error("Versión de Electron recuperada incorrecta.");
    const executableStat = fs.statSync(electronExecutable);
    if (executableStat.size !== lock.electronExeBytes || sha256(electronExecutable) !== lock.electronExeSha256) {
      throw new Error("electron.exe recuperado no coincide con el binario oficial bloqueado.");
    }
    console.log(`Runtime Electron ${lock.electronVersion} recuperado desde payload DORN verificado · ${entries.length} archivos`);
    console.log(`SHA-256 electron.exe · ${lock.electronExeSha256}`);
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = { copyRange, safeRelative };
