"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "package.json",
  "out/main/bootstrap.js",
  "out/main/index.js",
  "out/preload/index.js",
  "out/renderer/index.html",
  "out/renderer/vendor/dorn-appearance.js",
  "out/renderer/vendor/dorn-control-center.js",
  "out/renderer/vendor/dorn-control-center.css",
  "out/renderer/vendor/dorn-feature-flags.js",
  "out/renderer/vendor/dorn-auth.js",
  "out/renderer/vendor/dorn-gallery.js",
  "out/main/dorn-suite/auth-client.js",
  "out/main/dorn-suite/developer-security.js",
  "out/main/dorn-suite/creation-runtime.js",
  "out/design/app.js",
  "out/education/app.js",
  "out/machine/app.js",
  "installer/dorn-products.nsh",
  "ALCANCE-REAL-V4-ALPHA1.md",
  "DORN-V4-CHANGELOG.md",
  "dorn-v3-requirements.json"
];

const missing = required.filter((entry) => !fs.existsSync(path.join(root, entry)));
if (missing.length) {
  console.error(`Faltan archivos requeridos: ${missing.join(", ")}`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.version !== "4.0.0-alpha.7") {
  console.error(`Versión inesperada: ${packageJson.version}`);
  process.exit(1);
}

console.log(`Estructura verificada · DORN AI ${packageJson.version}`);
