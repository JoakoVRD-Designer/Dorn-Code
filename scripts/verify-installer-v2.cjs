"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { inspectPe, sha256, verifyPortable } = require("./verify-windows-runtime.cjs");
const { verifyTree } = require("../out/main/dorn-core/installer-transaction-v2.js");

const MAGIC = "DORNZIP4";
const TRAILER_SIZE = 64;

function copyAndHash(sourcePath, destinationPath, offset, size) {
  const source = fs.openSync(sourcePath, "r");
  const destination = fs.openSync(destinationPath, "w");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let cursor = offset, remaining = size;
    while (remaining) {
      const wanted = Math.min(buffer.length, remaining);
      const read = fs.readSync(source, buffer, 0, wanted, cursor);
      if (read !== wanted) throw new Error("Payload truncado.");
      fs.writeSync(destination, buffer, 0, read); hash.update(buffer.subarray(0, read)); cursor += read; remaining -= read;
    }
  } finally { fs.closeSync(source); fs.closeSync(destination); }
  return hash.digest("hex");
}

function files(root, excluded = new Set()) {
  const result = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name); const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) walk(absolute); else if (entry.isFile() && !excluded.has(relative)) result.push(relative);
    }
  };
  walk(root); return result.sort();
}

function verifyInstaller(installerArgument, portableArgument) {
  const installer = path.resolve(installerArgument), portable = path.resolve(portableArgument);
  const pe = inspectPe(installer); if (!pe.complete || pe.machine !== 0x8664 || pe.optionalMagic !== 0x20b) throw new Error("El instalador no es PE32+ x64.");
  const bytes = fs.statSync(installer).size; const descriptor = fs.openSync(installer, "r"); const trailer = Buffer.alloc(TRAILER_SIZE);
  try { fs.readSync(descriptor, trailer, 0, trailer.length, bytes - TRAILER_SIZE); } finally { fs.closeSync(descriptor); }
  if (trailer.subarray(0, 8).toString("ascii") !== MAGIC) throw new Error("Falta DORNZIP4.");
  const offset = Number(trailer.readBigUInt64LE(8)), compressed = Number(trailer.readBigUInt64LE(16)), unpacked = Number(trailer.readBigUInt64LE(24)), expectedHash = trailer.subarray(32, 64).toString("hex");
  if (offset + compressed + TRAILER_SIZE !== bytes || compressed < 50 * 1024 * 1024 || unpacked < compressed) throw new Error("Tamaños DORNZIP4 inválidos.");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-installer-v2-verify-")); const archive = path.join(temp, "payload.zip"), extracted = path.join(temp, "payload");
  try {
    const actualHash = copyAndHash(installer, archive, offset, compressed); if (actualHash !== expectedHash) throw new Error("SHA-256 del payload inválido.");
    fs.mkdirSync(extracted); const unzip = spawnSync("unzip", ["-q", archive, "-d", extracted], { encoding: "utf8" }); if (unzip.status !== 0) throw new Error(`Payload ZIP inválido: ${unzip.stderr || unzip.stdout}`);
    const verified = verifyTree(extracted); const runtime = verifyPortable(extracted); if (runtime.failures.length) throw new Error(runtime.failures.join("\n"));
    const originals = files(portable); for (const relative of originals) {
      const expected = path.join(portable, ...relative.split("/")), actual = path.join(extracted, ...relative.split("/"));
      if (!fs.existsSync(actual) || fs.statSync(expected).size !== fs.statSync(actual).size || sha256(expected) !== sha256(actual)) throw new Error(`No coincide con portable: ${relative}`);
    }
    const uninstall = inspectPe(path.join(extracted, "DORN AI Uninstall.exe")); if (!uninstall.complete || uninstall.machine !== 0x8664 || uninstall.optionalMagic !== 0x20b) throw new Error("Desinstalador no es PE32+ x64.");
    return { installerBytes: bytes, installerSha256: sha256(installer), compressed, unpacked, manifestedFiles: verified.files, originalFiles: originals.length };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (require.main === module) {
  try {
    const [installer, portable] = process.argv.slice(2); if (!installer || !portable) throw new Error("Uso: verify-installer-v2 <installer.exe> <portable>");
    const result = verifyInstaller(installer, portable);
    console.log(`Installer v2 verificado · ${result.manifestedFiles} archivos · ${result.originalFiles} originales idénticos · ${result.compressed} bytes comprimidos`);
    console.log(`SHA-256 instalador · ${result.installerSha256}`);
  } catch (error) { console.error(error.stack || error.message); process.exit(1); }
}

module.exports = { verifyInstaller };
