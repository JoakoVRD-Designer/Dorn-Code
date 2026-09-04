"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { spawnSync } = require("node:child_process");
const { inspectPe } = require("./verify-windows-runtime.cjs");

const MAGIC = Buffer.from("DORNZIP4", "ascii");
const TRAILER_SIZE = 64;
const MANIFEST = "DORN-INSTALL-MANIFEST.json";
const OWNERSHIP = "DORN-INSTALL-OWNERSHIP.json";
const EXTRACTOR_SHA256 = "c7245e21a7553d9e52d434002a401c77a7ca7d0f245f2311b0ddf16f8f946c6f";
const EXTRACTOR_BYTES = 446976;

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function regularFiles(root, excluded = new Set()) {
  const output = [];
  const folded = new Map();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Enlace no permitido: ${relative}`);
      if (stat.isDirectory()) { walk(absolute); continue; }
      if (!stat.isFile() || stat.nlink > 1) throw new Error(`Entrada no regular o enlazada: ${relative}`);
      if (excluded.has(relative)) continue;
      const key = relative.toLocaleLowerCase("en-US");
      if (folded.has(key)) throw new Error(`Colisión Windows: ${folded.get(key)} / ${relative}`);
      folded.set(key, relative);
      output.push({ path: relative, absolute, sizeBytes: stat.size, sha256: sha256(absolute) });
    }
  };
  walk(root);
  return output;
}

function writeMetadata(stage, version) {
  for (const name of [MANIFEST, OWNERSHIP]) {
    const target = path.join(stage, name);
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
  const files = regularFiles(stage, new Set([MANIFEST, OWNERSHIP]));
  if (!files.some((entry) => entry.path === "DORN AI.exe") || !files.some((entry) => entry.path === "DORN AI Uninstall.exe")) throw new Error("El payload no contiene la aplicación y su desinstalador.");
  const manifest = {
    schema: "dorn.install-files/2",
    product: "DORN AI",
    appId: "com.dorn.ai",
    version: String(version),
    pathComparison: "WINDOWS_CASE_INSENSITIVE_EXACT_CASE",
    files: files.map(({ path: filePath, sizeBytes, sha256: digest }) => ({ path: filePath, sizeBytes, sha256: digest }))
  };
  const manifestPath = path.join(stage, MANIFEST);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const ownership = {
    schema: "dorn.install-ownership/2",
    product: "DORN AI",
    appId: "com.dorn.ai",
    version: String(version),
    manifestSha256: sha256(manifestPath)
  };
  fs.writeFileSync(path.join(stage, OWNERSHIP), `${JSON.stringify(ownership, null, 2)}\n`, "utf8");
  return { manifest, ownership };
}

function normalizeTimes(root, epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  const items = [];
  const walk = (current) => {
    items.push(current);
    if (fs.lstatSync(current).isDirectory()) for (const name of fs.readdirSync(current)) walk(path.join(current, name));
  };
  walk(root);
  for (const item of items.reverse()) fs.utimesSync(item, date, date);
}

function validatePe(filePath, label) {
  const pe = inspectPe(filePath);
  if (!pe.complete || pe.machine !== 0x8664 || pe.optionalMagic !== 0x20b) throw new Error(`${label} no es PE32+ x64 completo.`);
}

async function main() {
  const [stubArg, portableArg, uninstallerArg, extractorArg, outputArg] = process.argv.slice(2);
  if (!stubArg || !portableArg || !uninstallerArg || !extractorArg || !outputArg) throw new Error("Uso: build-installer-v2 <stub> <portable> <uninstaller> <7z-x64> <salida>");
  const stub = path.resolve(stubArg);
  const portable = path.resolve(portableArg);
  const uninstaller = path.resolve(uninstallerArg);
  const extractor = path.resolve(extractorArg);
  const output = path.resolve(outputArg);
  validatePe(stub, "El bootstrapper");
  validatePe(uninstaller, "El desinstalador");
  if (!fs.existsSync(path.join(portable, "DORN AI.exe"))) throw new Error("El portable no contiene DORN AI.exe.");
  if (fs.statSync(extractor).size !== EXTRACTOR_BYTES || sha256(extractor) !== EXTRACTOR_SHA256) throw new Error("El extractor 7-Zip bloqueado no coincide con su revisión aprobada.");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  const epoch = Number(process.env.SOURCE_DATE_EPOCH || 1788307200);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-installer-v2-"));
  const stage = path.join(temp, "payload");
  const archive = path.join(temp, "payload.zip");
  try {
    fs.cpSync(portable, stage, { recursive: true, force: true });
    fs.copyFileSync(uninstaller, path.join(stage, "DORN AI Uninstall.exe"));
    const metadata = writeMetadata(stage, packageJson.version);
    normalizeTimes(stage, epoch);
    const archiveFiles = regularFiles(stage).map((entry) => entry.path);
    const zip = spawnSync("zip", ["-q", "-9", "-X", archive, ...archiveFiles], { cwd: stage, encoding: "utf8" });
    if (zip.status !== 0) throw new Error(`zip falló: ${zip.stderr || zip.stdout}`);
    const payloadBytes = fs.statSync(archive).size;
    const unpackedBytes = archiveFiles.reduce((sum, relative) => sum + fs.statSync(path.join(stage, ...relative.split("/"))).size, 0);
    if (payloadBytes < 50 * 1024 * 1024 || unpackedBytes < payloadBytes) throw new Error("El payload tiene un tamaño anómalo.");
    const payloadHash = Buffer.from(sha256(archive), "hex");
    const stubBytes = fs.statSync(stub).size;
    const trailer = Buffer.alloc(TRAILER_SIZE);
    MAGIC.copy(trailer, 0);
    trailer.writeBigUInt64LE(BigInt(stubBytes), 8);
    trailer.writeBigUInt64LE(BigInt(payloadBytes), 16);
    trailer.writeBigUInt64LE(BigInt(unpackedBytes), 24);
    payloadHash.copy(trailer, 32);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(stub, output);
    await pipeline(fs.createReadStream(archive), fs.createWriteStream(output, { flags: "a" }));
    fs.appendFileSync(output, trailer);
    if (fs.statSync(output).size !== stubBytes + payloadBytes + TRAILER_SIZE) throw new Error("El instalador final quedó truncado.");
    validatePe(output, "El instalador final");
    console.log(`Installer v2 · ${metadata.manifest.files.length} archivos · ${payloadBytes} bytes comprimidos · ${unpackedBytes} bytes instalados`);
    console.log(`SHA-256 payload · ${payloadHash.toString("hex")}`);
    console.log(`SHA-256 instalador · ${sha256(output)}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });

module.exports = { EXTRACTOR_BYTES, EXTRACTOR_SHA256, MAGIC, MANIFEST, OWNERSHIP, TRAILER_SIZE, regularFiles, writeMetadata };
