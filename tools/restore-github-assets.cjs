"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const assetsRoot = path.join(root, "repository-assets");
const archive = path.join(assetsRoot, "DORN_AI_Source_Assets_4.0.0-alpha.7.tar.gz");
const bundleManifest = path.join(assetsRoot, "BUNDLE.sha256");
const fileManifest = path.join(assetsRoot, "MANIFEST.sha256");

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function parseChecksumLine(line) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match) throw new Error(`Entrada SHA-256 inválida: ${line}`);
  return { hash: match[1], relativePath: match[2] };
}

function readManifest(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseChecksumLine);
}

for (const required of [archive, bundleManifest, fileManifest]) {
  if (!fs.existsSync(required)) throw new Error(`Falta ${path.relative(root, required)}`);
}

const [bundle] = readManifest(bundleManifest);
if (bundle.relativePath !== path.basename(archive) || sha256(archive) !== bundle.hash) {
  throw new Error("El paquete de activos no coincide con BUNDLE.sha256.");
}

const files = readManifest(fileManifest);
for (const entry of files) {
  if (path.isAbsolute(entry.relativePath) || entry.relativePath.split(/[\\/]/).includes("..")) {
    throw new Error(`Ruta insegura en el manifiesto: ${entry.relativePath}`);
  }
  const destination = path.resolve(root, entry.relativePath);
  if (!destination.startsWith(`${root}${path.sep}`)) {
    throw new Error(`La ruta sale del proyecto: ${entry.relativePath}`);
  }
  if (fs.existsSync(destination) && sha256(destination) !== entry.hash) {
    throw new Error(`Activo modificado; no se sobrescribirá: ${entry.relativePath}`);
  }
}

const listing = spawnSync("tar", ["-tzf", archive], {
  cwd: root,
  encoding: "utf8",
  timeout: 30_000,
  windowsHide: true
});
if (listing.status !== 0) throw new Error(`No se pudo inspeccionar el paquete: ${listing.stderr}`);
const archivedPaths = listing.stdout.split(/\r?\n/).filter(Boolean).sort();
const expectedPaths = files.map((entry) => entry.relativePath).sort();
if (JSON.stringify(archivedPaths) !== JSON.stringify(expectedPaths)) {
  throw new Error("El contenido del paquete no coincide exactamente con MANIFEST.sha256.");
}

const extraction = spawnSync("tar", ["-xzf", archive, "-C", root], {
  cwd: root,
  encoding: "utf8",
  timeout: 120_000,
  windowsHide: true
});
if (extraction.status !== 0) throw new Error(`No se pudieron restaurar los activos: ${extraction.stderr}`);

for (const entry of files) {
  const restored = path.join(root, entry.relativePath);
  if (!fs.existsSync(restored) || sha256(restored) !== entry.hash) {
    throw new Error(`Falló la verificación posterior: ${entry.relativePath}`);
  }
}

console.log(`Activos DORN restaurados y verificados: ${files.length}`);
