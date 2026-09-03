"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.resolve(process.argv[2] || path.join(root, "dist", "app.asar"));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-asar-build-"));
let fallbackStage = "";
const entries = [
  "out",
  "build",
  "installer",
  "bin",
  "sdk",
  "scripts",
  "tests",
  "package.json",
  "package-lock.json",
  "dorn-v3-implementation.json",
  "dorn-v3-requirements.json",
  "RELEASE-VERIFICATION.json",
  "ALCANCE-REAL-ALPHA5.md",
  "ALCANCE-REAL-ALPHA6.md",
  "ALCANCE-REAL-ALPHA7.md",
  "ALCANCE-REAL-ALPHA8.md",
  "ALCANCE-REAL-ALPHA9.md",
  "ALCANCE-REAL-ALPHA10.md",
  "ALCANCE-REAL-V4-ALPHA1.md",
  "ALCANCE-REAL-V4-ALPHA3.md",
  "ALCANCE-REAL-V4-ALPHA5.md",
  "VERIFICACION-ALPHA5.md",
  "AUDITORIA-TECNICA-ALPHA10.2.md",
  "HOTFIX-ALPHA10.1.md",
  "HOTFIX-ALPHA10.2.md",
  "HOTFIX-ALPHA10.3.md",
  "RECUPERACION-V0.4-ALPHA10.3.md",
  "AYUDA-DE-INICIO.txt",
  "COMPROBAR-DORN.ps1",
  "VALIDAR-Y-ABRIR-DORN.cmd",
  "ESTADO-152-PUNTOS-ALPHA6.md",
  "ESTADO-152-PUNTOS-ALPHA7.md",
  "ESTADO-152-PUNTOS-ALPHA8.md",
  "ESTADO-152-PUNTOS-ALPHA9.md",
  "ESTADO-152-PUNTOS-ALPHA10.md",
  "README.md",
  "RECOVERY-NOTES.md",
  "RECOMPILAR-WINDOWS.md",
  "CAMBIOS-Y-PRUEBAS.txt",
  "DORN-V4-CHANGELOG.md",
  "HERRAMIENTAS-DE-COMPILACION.md",
  "AUTENTICACION-ALPHA6.md",
  "AUTENTICACION-FUTURA-ALPHA7.md",
  "MEJORAS_ROUTER_MOVIMIENTO_INSTALADOR_ALPHA7.md"
];

function fail(message) {
  throw new Error(message);
}

async function main() {
  try {
    for (const entry of entries) {
      const source = path.join(root, entry);
      if (!fs.existsSync(source)) fail(`Falta el archivo de compilación: ${entry}`);
      const target = path.join(stage, entry);
      fs.cpSync(source, target, {
        recursive: true,
        force: true,
        errorOnExist: false
      });
      if (entry === "installer") {
        // El instalador es un artefacto de entrega, no una dependencia de la app.
        // Incluir installer/output dentro de app.asar causaría una copia recursiva
        // del EXE anterior y haría crecer cada actualización sin aportar funciones.
        fs.rmSync(path.join(target, "output"), { recursive: true, force: true });
      }
    }

    const asarEntry = require.resolve("@electron/asar");
    const asar = await import(pathToFileURL(asarEntry).href);
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const npmCache = path.join(root, "build-cache", "npm-asar-cache");
    fs.mkdirSync(npmCache, { recursive: true });
    const install = spawnSync(
      npm,
      ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      {
        cwd: stage,
        env: { ...process.env, npm_config_cache: npmCache, NPM_CONFIG_CACHE: npmCache },
        encoding: "utf8"
      }
    );
    if (install.status !== 0) {
      process.stderr.write(install.stdout || "");
      process.stderr.write(install.stderr || "");
      const reusableAsar = process.env.DORN_ASAR_OFFLINE_REUSE === "1" ? path.join(root, "dist", "app.asar") : output;
      if (!fs.existsSync(reusableAsar)) fail(`npm ci de producción terminó con código ${install.status} y no existe un app.asar verificado para reconstrucción sin red.`);
      const currentLock = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "package-lock.json"))).digest("hex");
      const previousLock = crypto.createHash("sha256").update(asar.extractFile(reusableAsar, "package-lock.json")).digest("hex");
      if (currentLock !== previousLock) fail("No se reutilizaron dependencias: package-lock.json cambió respecto del app.asar anterior.");
      fallbackStage = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-asar-dependencies-"));
      asar.extractAll(reusableAsar, fallbackStage);
      const previousModules = path.join(fallbackStage, "node_modules");
      if (!fs.existsSync(previousModules)) fail("El app.asar anterior no contiene dependencias de producción reutilizables.");
      fs.rmSync(path.join(stage, "node_modules"), { recursive: true, force: true });
      fs.cpSync(previousModules, path.join(stage, "node_modules"), {
        recursive: true,
        force: true,
        dereference: false,
        verbatimSymlinks: true
      });
      console.warn("npm ci no estuvo disponible; se reutilizaron dependencias cuyo package-lock.json coincide exactamente.");
    }

    for (const dependency of ["archiver", "electron-updater", "extract-zip", "zod"]) {
      require.resolve(dependency, { paths: [stage] });
    }

    fs.mkdirSync(path.dirname(output), { recursive: true });
    await asar.createPackage(stage, output);
    if (!fs.existsSync(output) || fs.statSync(output).size < 1024 * 1024) {
      fail("El app.asar generado es anormalmente pequeño.");
    }
    console.log(`app.asar reproducible · ${fs.statSync(output).size} bytes · ${output}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    if (fallbackStage) fs.rmSync(fallbackStage, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
