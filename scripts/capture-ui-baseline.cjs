"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "verification", "ui-4.0-baseline.json");
const protectedEntries = [
  "out/renderer",
  "out/design",
  "out/editor",
  "out/education",
  "out/machine",
  "out/studio3d",
  "resources/startup",
  "installer/assets",
  "out/main/index.js",
  "out/preload/index.js"
];

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function collect(relativePath, output = []) {
  const absolutePath = path.join(root, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`El baseline visual no admite symlinks: ${relativePath}`);
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absolutePath).sort((left, right) => left.localeCompare(right))) {
      collect(path.posix.join(relativePath.split(path.sep).join(path.posix.sep), name), output);
    }
    return output;
  }
  if (!stat.isFile()) return output;
  output.push({
    path: relativePath.split(path.sep).join(path.posix.sep),
    bytes: stat.size,
    sha256: sha256(absolutePath)
  });
  return output;
}

if (fs.existsSync(outputPath)) {
  throw new Error(
    "El baseline visual ya existe y es inmutable. Registra cambios intencionales en ui-4.0-change-ledger.json."
  );
}

const files = protectedEntries.flatMap((entry) => collect(entry));
files.sort((left, right) => left.path.localeCompare(right.path));

const manifest = {
  schema: "dorn.ui-baseline/1",
  baseline: "DORN AI 4.0.0-alpha.7",
  policy: "PRESERVE_4_0_VISUAL_IDENTITY_WITH_REVIEWED_EVOLUTION",
  requirements: {
    startupDurationMs: 7000,
    startupDurationMandatory: true,
    preserveMainNavigation: true,
    preserveProductsOrganization: true,
    preserveGlobalThemesAndColorCustomization: true,
    preserveImageAndGifBackgrounds: true,
    preserveInstallerForestVisualLanguage: true
  },
  protectedEntries,
  fileCount: files.length,
  totalBytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
  files
};

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
process.stdout.write(
  `${JSON.stringify({ outputPath, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes })}\n`
);
