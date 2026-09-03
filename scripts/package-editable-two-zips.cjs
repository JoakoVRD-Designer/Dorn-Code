"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ZipArchive } = require("archiver");

const root = path.resolve(__dirname, "..");
const packageInfo = require("../package.json");
const release = `DORN AI Windows ${packageInfo.version.replace("-", " ").replace(/alpha\.(\d+)/, "alpha $1")} Editable`;
const outputDirectory = path.resolve(process.argv[2] || path.join(root, "..", "DORN_AI_Editable_2_ZIP"));

function collect(directory, relative = "") {
  const values = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const childRelative = path.join(relative, entry.name);
    const first = childRelative.split(path.sep)[0];
    if ([".git", "build-cache", "tmp", "release"].includes(first)) continue;
    if (first === "dist" && childRelative !== "dist" && childRelative !== path.join("dist", "app.asar")) continue;
    const installerOutput = path.join("installer", "output");
    const finalInstallerOutput = path.join(installerOutput, "final7");
    if (childRelative.startsWith(`${installerOutput}${path.sep}`) && !childRelative.startsWith(finalInstallerOutput)) continue;
    if (childRelative.startsWith(`${finalInstallerOutput}${path.sep}`) && entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) values.push(...collect(absolute, childRelative));
    else if (entry.isFile()) values.push({ absolute, relative: childRelative, bytes: fs.statSync(absolute).size });
  }
  return values;
}

function splitBalanced(files) {
  const bins = [{ bytes: 0, files: [] }, { bytes: 0, files: [] }];
  for (const file of [...files].sort((a, b) => b.bytes - a.bytes || a.relative.localeCompare(b.relative))) {
    const target = bins[0].bytes <= bins[1].bytes ? bins[0] : bins[1];
    target.files.push(file);
    target.bytes += file.bytes;
  }
  return bins;
}

async function createZip(outputPath, files, part) {
  const output = fs.createWriteStream(outputPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const completed = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  for (const file of files) archive.file(file.absolute, { name: `${release}/${file.relative.replace(/\\/g, "/")}` });
  archive.append([
    `DORN AI ${packageInfo.version} - Parte ${part} de 2`,
    "",
    "Este es un ZIP real. Extrae Parte 1 y Parte 2 en la misma carpeta.",
    "No cambies extensiones y no utilices CMD.",
    `Archivos de proyecto contenidos en esta parte: ${files.length}`,
    ""
  ].join("\r\n"), { name: `${release}/LEER-PARTE-${part}-DE-2.txt` });
  await archive.finalize();
  await completed;
}

(async () => {
  for (const required of [
    path.join(root, "node_modules", "electron", "dist", "electron"),
    path.join(root, "build-tools", "electron-v37.2.6-win32-x64.zip"),
    path.join(root, "dist", "app.asar"),
    path.join(root, "installer", "output", "final7", `DORN_AI_Setup_${packageInfo.version}_x64.exe`)
  ]) if (!fs.existsSync(required)) throw new Error(`El editable offline está incompleto. Falta: ${required}`);

  fs.mkdirSync(outputDirectory, { recursive: true });
  const files = collect(root);
  const bins = splitBalanced(files);
  const outputs = [1, 2].map((part) => path.join(outputDirectory, `DORN_AI_${packageInfo.version}_Editable_Parte_${part}_de_2.zip`));
  await createZip(outputs[0], bins[0].files, 1);
  await createZip(outputs[1], bins[1].files, 2);

  const expected = new Set(files.map((file) => file.relative.replace(/\\/g, "/")));
  const actual = new Set([...bins[0].files, ...bins[1].files].map((file) => file.relative.replace(/\\/g, "/")));
  if (expected.size !== actual.size || [...expected].some((file) => !actual.has(file))) throw new Error("La división en dos ZIP omitió archivos.");

  const manifest = {
    product: "DORN AI",
    version: packageInfo.version,
    format: "two-independent-standard-zip-files",
    instructions: "Extraer ambas partes en la misma ubicación; no unir binariamente.",
    sourceFiles: expected.size,
    parts: outputs.map((outputPath, index) => ({
      part: index + 1,
      file: path.basename(outputPath),
      archiveBytes: fs.statSync(outputPath).size,
      sourceFiles: bins[index].files.length,
      sourceBytes: bins[index].bytes
    }))
  };
  fs.writeFileSync(path.join(outputDirectory, "DORN_AI_Editable_2_ZIP_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
