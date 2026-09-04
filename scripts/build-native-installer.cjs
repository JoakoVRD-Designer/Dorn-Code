"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { spawnSync } = require("node:child_process");
const { inspectPe } = require("./verify-windows-runtime.cjs");

const MAGIC = Buffer.from("DORNZIP3", "ascii");
const TRAILER_SIZE = 56;
const INSTALL_MANIFEST = "DORN-INSTALL-MANIFEST.json";
const INSTALL_OWNERSHIP = "DORN-INSTALL-OWNERSHIP.json";

function usage() {
  console.error("Uso: node scripts/build-native-installer.cjs <stub.exe> <portable> <uninstaller.exe> <salida.exe>");
  process.exit(2);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest()));
  });
}

function ensureFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Falta ${label}: ${filePath}`);
  }
}

function sha256FileSync(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function payloadFiles(root) {
  const files = [];
  const names = new Map();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) throw new Error(`El payload contiene un enlace no permitido: ${relativePath}`);
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!entry.isFile()) throw new Error(`El payload contiene una entrada no regular: ${relativePath}`);
      if ([INSTALL_MANIFEST, INSTALL_OWNERSHIP].includes(relativePath)) continue;
      const folded = relativePath.toLocaleLowerCase("en-US");
      if (names.has(folded)) throw new Error(`El payload colisiona en Windows: ${names.get(folded)} / ${relativePath}`);
      names.set(folded, relativePath);
      files.push({ path: relativePath, sizeBytes: fs.statSync(absolute).size, sha256: sha256FileSync(absolute) });
    }
  };
  walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function writeInstallMetadata(stage, version) {
  for (const control of [INSTALL_MANIFEST, INSTALL_OWNERSHIP]) {
    const target = path.join(stage, control);
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
  const files = payloadFiles(stage);
  if (!files.some((entry) => entry.path === "DORN AI.exe") || !files.some((entry) => entry.path === "DORN AI Uninstall.exe")) {
    throw new Error("El payload no contiene ejecutable y desinstalador DORN.");
  }
  const manifest = {
    schema: "dorn.install-files/1",
    product: "DORN AI",
    appId: "com.dorn.ai",
    version: String(version),
    pathComparison: "WINDOWS_CASE_INSENSITIVE",
    files
  };
  const manifestPath = path.join(stage, INSTALL_MANIFEST);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const ownership = {
    schema: "dorn.install-ownership/1",
    product: "DORN AI",
    appId: "com.dorn.ai",
    version: String(version),
    manifestSha256: sha256FileSync(manifestPath)
  };
  fs.writeFileSync(path.join(stage, INSTALL_OWNERSHIP), `${JSON.stringify(ownership, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { manifest, ownership };
}

async function main() {
  const [stubArg, portableArg, uninstallerArg, outputArg] = process.argv.slice(2);
  if (!stubArg || !portableArg || !uninstallerArg || !outputArg) usage();
  const stub = path.resolve(stubArg);
  const portable = path.resolve(portableArg);
  const uninstaller = path.resolve(uninstallerArg);
  const output = path.resolve(outputArg);
  ensureFile(stub, "stub nativo");
  ensureFile(uninstaller, "desinstalador nativo");
  if (!fs.existsSync(path.join(portable, "DORN AI.exe"))) throw new Error("El portable no contiene DORN AI.exe.");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-native-installer-"));
  const stage = path.join(tempRoot, "payload");
  const archive = path.join(tempRoot, "payload.zip");
  try {
    fs.cpSync(portable, stage, { recursive: true, force: true, errorOnExist: false });
    fs.copyFileSync(uninstaller, path.join(stage, "DORN AI Uninstall.exe"));
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
    writeInstallMetadata(stage, packageJson.version);
    const zip = spawnSync("zip", ["-q", "-9", "-r", archive, "."], { cwd: stage, encoding: "utf8" });
    if (zip.status !== 0) throw new Error(`zip terminó con código ${zip.status}: ${zip.stderr || zip.stdout}`);

    const stubSize = fs.statSync(stub).size;
    const archiveSize = fs.statSync(archive).size;
    if (archiveSize < 100 * 1024 * 1024) throw new Error(`El payload comprimido es anormalmente pequeño: ${archiveSize}.`);
    const archiveHash = await hashFile(archive);
    const trailer = Buffer.alloc(TRAILER_SIZE);
    MAGIC.copy(trailer, 0);
    trailer.writeBigUInt64LE(BigInt(stubSize), 8);
    trailer.writeBigUInt64LE(BigInt(archiveSize), 16);
    archiveHash.copy(trailer, 24);

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(stub, output);
    await pipeline(fs.createReadStream(archive), fs.createWriteStream(output, { flags: "a" }));
    fs.appendFileSync(output, trailer);

    const finalSize = fs.statSync(output).size;
    if (finalSize !== stubSize + archiveSize + TRAILER_SIZE) throw new Error("El instalador quedó truncado durante la unión.");
    const descriptor = fs.openSync(output, "r");
    const readTrailer = Buffer.alloc(TRAILER_SIZE);
    fs.readSync(descriptor, readTrailer, 0, readTrailer.length, finalSize - TRAILER_SIZE);
    fs.closeSync(descriptor);
    if (!readTrailer.subarray(0, 8).equals(MAGIC)) throw new Error("El tráiler DORN no quedó escrito.");

    const pe = inspectPe(output);
    if (!pe.complete || pe.machine !== 0x8664 || pe.optionalMagic !== 0x20b) {
      throw new Error("El instalador final no es un PE32+ x64 completo.");
    }
    console.log(`Instalador nativo DORN · ${finalSize} bytes · payload ${archiveSize} bytes · SHA-256 payload ${archiveHash.toString("hex")}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { INSTALL_MANIFEST, INSTALL_OWNERSHIP, payloadFiles, writeInstallMetadata };
