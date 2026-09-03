"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_ELECTRON = "37.2.6";
const EXPECTED_MACHINE_X64 = 0x8664;
const EXPECTED_PE32_PLUS = 0x20b;
const MIN_ELECTRON_EXE_BYTES = 150 * 1024 * 1024;

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function inspectPe(filePath) {
  const stat = fs.statSync(filePath);
  const descriptor = fs.openSync(filePath, "r");
  const header = Buffer.alloc(64 * 1024);
  let headerBytes;
  try {
    headerBytes = fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const data = header.subarray(0, headerBytes);
  if (data.length < 512 || data.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`${path.basename(filePath)} no contiene una cabecera MZ válida.`);
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (peOffset + 24 > data.length || data.toString("binary", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error(`${path.basename(filePath)} no contiene una cabecera PE válida.`);
  }
  const machine = data.readUInt16LE(peOffset + 4);
  const sectionCount = data.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = data.readUInt16LE(peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;
  const optionalMagic = data.readUInt16LE(optionalHeaderOffset);
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  if (!sectionCount || sectionCount > 96 || sectionTableOffset + sectionCount * 40 > data.length) {
    throw new Error(`${path.basename(filePath)} contiene una tabla de secciones PE inválida.`);
  }

  const sections = [];
  let requiredSize = 0;
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTableOffset + index * 40;
    const name = data.subarray(offset, offset + 8).toString("ascii").replace(/\0.*$/, "");
    const rawSize = data.readUInt32LE(offset + 16);
    const rawOffset = data.readUInt32LE(offset + 20);
    const rawEnd = rawOffset + rawSize;
    requiredSize = Math.max(requiredSize, rawEnd);
    sections.push({ name, rawOffset, rawSize, rawEnd, complete: rawEnd <= stat.size });
  }

  const incomplete = sections.filter((section) => !section.complete);
  return {
    filePath,
    size: stat.size,
    machine,
    optionalMagic,
    sectionCount,
    requiredSize,
    complete: incomplete.length === 0,
    incomplete
  };
}

function verifyManifest(portableRoot, failures) {
  const manifestPath = path.join(portableRoot, "ELECTRON-RUNTIME.json");
  if (!fs.existsSync(manifestPath)) {
    failures.push("Falta ELECTRON-RUNTIME.json; no se puede demostrar el origen del runtime.");
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    failures.push(`ELECTRON-RUNTIME.json no es válido: ${error.message}`);
    return null;
  }
  if (manifest.electronVersion !== EXPECTED_ELECTRON) {
    failures.push(`Electron inesperado en manifiesto: ${manifest.electronVersion || "ausente"}.`);
  }
  if (manifest.platform !== "win32" || manifest.arch !== "x64") {
    failures.push(`Plataforma inesperada en manifiesto: ${manifest.platform}/${manifest.arch}.`);
  }
  for (const [relativePath, expected] of Object.entries(manifest.files || {})) {
    const target = path.join(portableRoot, relativePath);
    if (!fs.existsSync(target)) {
      failures.push(`Falta el archivo firmado por manifiesto: ${relativePath}.`);
      continue;
    }
    const actualSize = fs.statSync(target).size;
    if (actualSize !== expected.size) {
      failures.push(`${relativePath} mide ${actualSize}; el manifiesto exige ${expected.size}.`);
      continue;
    }
    const actualHash = sha256(target);
    if (actualHash !== expected.sha256) {
      failures.push(`${relativePath} no coincide con su SHA-256 oficial.`);
    }
  }
  return manifest;
}

function verifyPortable(portableRoot) {
  const root = path.resolve(portableRoot);
  const failures = [];
  const required = [
    "DORN AI.exe",
    "version",
    "chrome_100_percent.pak",
    "chrome_200_percent.pak",
    "d3dcompiler_47.dll",
    "ffmpeg.dll",
    "icudtl.dat",
    "libEGL.dll",
    "libGLESv2.dll",
    "resources.pak",
    "snapshot_blob.bin",
    "v8_context_snapshot.bin",
    "vk_swiftshader.dll",
    "vk_swiftshader_icd.json",
    "vulkan-1.dll",
    "locales/es.pak",
    "resources/app.asar",
    "resources/local-ai/runtime/llama-server.exe",
    "resources/startup/splash.html",
    "resources/startup/dorn-startup.wav"
  ];
  for (const relativePath of required) {
    if (!fs.existsSync(path.join(root, relativePath))) failures.push(`Falta ${relativePath}.`);
  }

  const versionPath = path.join(root, "version");
  if (fs.existsSync(versionPath)) {
    const electronVersion = fs.readFileSync(versionPath, "utf8").trim();
    if (electronVersion !== EXPECTED_ELECTRON) {
      failures.push(`El runtime declara Electron ${electronVersion}; se exige ${EXPECTED_ELECTRON}.`);
    }
  }

  const executablePath = path.join(root, "DORN AI.exe");
  let pe = null;
  if (fs.existsSync(executablePath)) {
    try {
      pe = inspectPe(executablePath);
      if (pe.machine !== EXPECTED_MACHINE_X64) {
        failures.push(`DORN AI.exe no es x64 (machine=0x${pe.machine.toString(16)}).`);
      }
      if (pe.optionalMagic !== EXPECTED_PE32_PLUS) {
        failures.push(`DORN AI.exe no es PE32+ (magic=0x${pe.optionalMagic.toString(16)}).`);
      }
      if (!pe.complete) {
        failures.push(
          `DORN AI.exe está truncado: mide ${pe.size} bytes y sus secciones requieren al menos ${pe.requiredSize}.`
        );
      }
      if (pe.size < MIN_ELECTRON_EXE_BYTES) {
        failures.push(
          `DORN AI.exe es demasiado pequeño para Electron ${EXPECTED_ELECTRON}: ${pe.size} bytes.`
        );
      }
    } catch (error) {
      failures.push(error.message);
    }
  }

  const appAsarPath = path.join(root, "resources", "app.asar");
  if (fs.existsSync(appAsarPath) && fs.statSync(appAsarPath).size < 1024 * 1024) {
    failures.push("resources/app.asar es anormalmente pequeño.");
  }

  const manifest = verifyManifest(root, failures);
  return { root, failures, pe, manifest };
}

function runCli() {
  const portableRoot = process.argv[2];
  if (!portableRoot) {
    console.error("Uso: node scripts/verify-windows-runtime.cjs <carpeta-portable>");
    process.exit(2);
  }
  const result = verifyPortable(portableRoot);
  if (result.failures.length) {
    console.error("RUNTIME DE WINDOWS RECHAZADO");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    `Runtime Windows verificado · Electron ${EXPECTED_ELECTRON} · x64 · ${result.pe.size} bytes · ${result.pe.sectionCount} secciones completas`
  );
}

if (require.main === module) runCli();

module.exports = {
  EXPECTED_ELECTRON,
  inspectPe,
  sha256,
  verifyPortable
};
