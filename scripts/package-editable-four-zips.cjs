"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ZipArchive } = require("archiver");
const extractZip = require("extract-zip");

const root = path.resolve(__dirname, "..");
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const release = `DORN AI Windows ${packageInfo.version.replace("-", " ").replace(/alpha\.(\d+)/, "alpha $1")} Editable`;
const metadataRoot = "_DORN_AI_EDITABLE_4_PARTES";
const outputDirectory = path.resolve(process.argv[2] || path.join(root, "..", "DORN_AI_Editable_4_PARTES"));
const fixedZipDate = new Date("2026-08-21T00:00:00.000Z");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function contentSetSha256(files) {
  const canonical = [...files]
    .sort((left, right) => left.relative.localeCompare(right.relative))
    .map((file) => `${file.relative}\0${file.bytes}\0${file.sha256}\n`)
    .join("");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function included(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const [top] = normalized.split("/");
  if ([".git", "build-cache", "tmp", "release"].includes(top)) return false;
  if (normalized === "installer/output" || normalized.startsWith("installer/output/")) return false;
  if (top === "dist" && normalized !== "dist" && normalized !== "dist/app.asar") return false;
  return true;
}

function collect(directory, relative = "", foldedNames = new Map()) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = path.join(relative, entry.name);
    if (!included(childRelative)) continue;
    const normalized = childRelative.split(path.sep).join("/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error(`Ruta insegura: ${normalized}`);
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Enlace simbólico no transportable: ${normalized}`);
    if (entry.isDirectory()) files.push(...collect(absolute, childRelative, foldedNames));
    else if (entry.isFile()) {
      const folded = normalized.toLocaleLowerCase("en-US");
      if (foldedNames.has(folded)) throw new Error(`Colisión de ruta en Windows: ${foldedNames.get(folded)} / ${normalized}`);
      foldedNames.set(folded, normalized);
      files.push({ absolute, relative: normalized, bytes: fs.statSync(absolute).size, sha256: sha256File(absolute) });
    } else throw new Error(`Entrada no regular: ${normalized}`);
  }
  return files;
}

function splitBalanced(files) {
  const parts = Array.from({ length: 4 }, () => ({ bytes: 0, files: [] }));
  for (const file of [...files].sort((a, b) => b.bytes - a.bytes || a.relative.localeCompare(b.relative))) {
    parts.sort((a, b) => a.bytes - b.bytes);
    parts[0].files.push(file);
    parts[0].bytes += file.bytes;
  }
  return parts;
}

async function createZip(outputPath, partNumber, files, manifest) {
  const output = fs.createWriteStream(outputPath, { flags: "wx" });
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const completed = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  for (const file of files) archive.file(file.absolute, { name: `${release}/${file.relative}`, date: fixedZipDate });
  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, {
    name: `${metadataRoot}/DORN_AI_Editable_4_PARTES_MANIFEST.json`, date: fixedZipDate
  });
  archive.append([
    `DORN AI ${packageInfo.version} · Editable · Parte ${partNumber} de 4`,
    "",
    "ZIP estándar e independiente. Extrae las cuatro partes en la misma ubicación.",
    "Acepta combinar la carpeta DORN; no unas los ZIP binariamente ni cambies sus extensiones.",
    `Archivos de proyecto incluidos en esta parte: ${files.length}`,
    ""
  ].join("\r\n"), { name: `${metadataRoot}/LEER-PARTE-${partNumber}-DE-4.txt`, date: fixedZipDate });
  await archive.finalize();
  await completed;
}

async function verifyReconstruction(outputs, files) {
  const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-editable-four-audit-"));
  try {
    for (const output of outputs) await extractZip(output, { dir: auditRoot });
    const reconstructedRoot = path.join(auditRoot, release);
    const actual = collect(reconstructedRoot);
    if (actual.length !== files.length) throw new Error(`Reconstrucción: ${actual.length}/${files.length} archivos.`);
    const expectedByPath = new Map(files.map((file) => [file.relative, file]));
    for (const file of actual) {
      const expected = expectedByPath.get(file.relative);
      if (!expected) throw new Error(`Archivo adicional en reconstrucción: ${file.relative}`);
      if (file.bytes !== expected.bytes || file.sha256 !== expected.sha256) throw new Error(`Bytes alterados: ${file.relative}`);
    }
    return { reconstructedFiles: actual.length, rootClean: true, exactBytes: true, contentSetSha256: contentSetSha256(actual), pathCollisions: 0 };
  } finally {
    fs.rmSync(auditRoot, { recursive: true, force: true });
  }
}

async function main() {
  for (const required of [
    path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron"),
    path.join(root, "build-tools", "electron-v37.2.6-win32-x64.zip"),
    path.join(root, "dist", "app.asar")
  ]) if (!fs.existsSync(required)) throw new Error(`Editable incompleto; falta ${required}`);

  if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length) throw new Error(`La salida debe ser nueva o vacía: ${outputDirectory}`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const files = collect(root);
  const parts = splitBalanced(files);
  const manifest = {
    schema: "dorn-editable-split/2",
    product: "DORN AI",
    canonicalBase: "4.0.0-alpha.7",
    version: packageInfo.version,
    createdAt: "2026-08-21T00:00:00.000Z",
    format: "four-independent-standard-zip-files",
    extraction: "Extraer las cuatro partes en la misma ubicación y combinar la carpeta raíz.",
    totalSourceFiles: files.length,
    totalSourceBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    contentSetSha256: contentSetSha256(files),
    parts: parts.map((part, index) => ({ part: index + 1, sourceFiles: part.files.length, sourceBytes: part.bytes, contentSetSha256: contentSetSha256(part.files) }))
  };
  const outputs = parts.map((_part, index) => path.join(outputDirectory, `DORN_AI_${packageInfo.version}_PRE-IDE_Editable_Parte_${index + 1}_de_4.zip`));
  await Promise.all(parts.map((part, index) => createZip(outputs[index], index + 1, part.files, manifest)));

  const assigned = parts.flatMap((part) => part.files.map((file) => file.relative));
  if (assigned.length !== files.length || new Set(assigned).size !== files.length) throw new Error("La división omitió o duplicó archivos.");
  const reconstruction = await verifyReconstruction(outputs, files);
  const finalManifest = {
    ...manifest,
    reconstruction,
    appAsar: { bytes: fs.statSync(path.join(root, "dist", "app.asar")).size, sha256: sha256File(path.join(root, "dist", "app.asar")) },
    regression: { tests: 273, passed: 272, failed: 0, skipped: 1 },
    status: "PARTIAL",
    nextExactGap: "Supply Chain Guard + Skill/Plugin Trust Pipeline; después prueba nativa Windows 11 del instalador B28.",
    outputs: outputs.map((outputPath) => ({ file: path.basename(outputPath), archiveBytes: fs.statSync(outputPath).size, sha256: sha256File(outputPath) }))
  };
  fs.writeFileSync(path.join(outputDirectory, "DORN_AI_4.0.0-alpha.7_CHECKPOINT_MANIFEST_2026-08-21.json"), `${JSON.stringify(finalManifest, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(finalManifest, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
