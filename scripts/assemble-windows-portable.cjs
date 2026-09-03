"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { inspectPe, sha256 } = require("./verify-windows-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
);
const lock = JSON.parse(
  fs.readFileSync(path.join(__dirname, "electron-runtime.lock.json"), "utf8")
);

function usage() {
  console.error(
    "Uso: node scripts/assemble-windows-portable.cjs <runtime-electron-extraido> <app.asar> <carpeta-salida-nueva>"
  );
  process.exit(2);
}

function ensureNewOutput(output) {
  if (fs.existsSync(output)) {
    const entries = fs.readdirSync(output);
    if (entries.length) {
      throw new Error(`La salida debe ser una carpeta nueva o vacía: ${output}`);
    }
  } else {
    fs.mkdirSync(output, { recursive: true });
  }
}

function copyDirectory(source, target) {
  fs.cpSync(source, target, { recursive: true, errorOnExist: false, force: true });
}

function runtimeFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll(path.sep, "/"));
    }
  }
  walk(root);
  return files.sort();
}

function validateOfficialRuntime(runtimeRoot) {
  const versionPath = path.join(runtimeRoot, "version");
  const executablePath = path.join(runtimeRoot, "electron.exe");
  if (!fs.existsSync(versionPath) || !fs.existsSync(executablePath)) {
    throw new Error("La carpeta no contiene una distribución oficial extraída de Electron.");
  }
  const version = fs.readFileSync(versionPath, "utf8").trim();
  if (version !== lock.electronVersion) {
    throw new Error(`Electron ${version} no coincide con el bloqueo ${lock.electronVersion}.`);
  }
  const pe = inspectPe(executablePath);
  const executableHash = sha256(executablePath);
  if (
    !pe.complete ||
    pe.machine !== 0x8664 ||
    pe.optionalMagic !== 0x20b ||
    pe.size !== lock.electronExeBytes ||
    executableHash !== lock.electronExeSha256
  ) {
    throw new Error("electron.exe no coincide con el binario oficial win32-x64 bloqueado.");
  }
}

function main() {
  const [runtimeArgument, asarArgument, outputArgument] = process.argv.slice(2);
  if (!runtimeArgument || !asarArgument || !outputArgument) usage();

  const runtimeRoot = path.resolve(runtimeArgument);
  const appAsar = path.resolve(asarArgument);
  const output = path.resolve(outputArgument);
  validateOfficialRuntime(runtimeRoot);
  if (!fs.existsSync(appAsar) || fs.statSync(appAsar).size < 1024 * 1024) {
    throw new Error("app.asar no existe o es anormalmente pequeño.");
  }
  ensureNewOutput(output);

  copyDirectory(runtimeRoot, output);
  fs.renameSync(path.join(output, "electron.exe"), path.join(output, "DORN AI.exe"));

  const defaultApp = path.join(output, "resources", "default_app.asar");
  if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp);
  const electronLicense = path.join(output, "LICENSE");
  if (fs.existsSync(electronLicense)) {
    fs.renameSync(electronLicense, path.join(output, "LICENSE.electron.txt"));
  }

  const runtimeEntries = runtimeFiles(output);
  const manifestFiles = {};
  for (const relativePath of runtimeEntries) {
    const target = path.join(output, ...relativePath.split("/"));
    manifestFiles[relativePath] = {
      size: fs.statSync(target).size,
      sha256: sha256(target)
    };
  }
  const manifest = {
    schemaVersion: 1,
    product: "DORN AI",
    productVersion: packageJson.version,
    electronVersion: lock.electronVersion,
    platform: lock.platform,
    arch: lock.arch,
    officialArtifact: lock.artifact,
    officialArchiveSha256: lock.archiveSha256,
    generatedAt: new Date(Number(process.env.SOURCE_DATE_EPOCH || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    files: manifestFiles
  };

  fs.mkdirSync(path.join(output, "resources"), { recursive: true });
  fs.copyFileSync(appAsar, path.join(output, "resources", "app.asar"));
  copyDirectory(
    path.join(projectRoot, "resources", "local-ai"),
    path.join(output, "resources", "local-ai")
  );
  copyDirectory(
    path.join(projectRoot, "resources", "startup"),
    path.join(output, "resources", "startup")
  );

  for (const relativePath of [
    "ALCANCE-REAL-ALPHA10.md",
    "ALCANCE-REAL-V4-ALPHA1.md",
    "ALCANCE-REAL-V4-ALPHA3.md",
    "ALCANCE-REAL-V4-ALPHA5.md",
    "VERIFICACION-ALPHA5.md",
    "AUDITORIA-TECNICA-ALPHA10.2.md",
    "AYUDA-DE-INICIO.txt",
    "CAMBIOS-Y-PRUEBAS.txt",
    "DORN-V4-CHANGELOG.md",
    "HERRAMIENTAS-DE-COMPILACION.md",
    "AUTENTICACION-ALPHA6.md",
    "AUTENTICACION-FUTURA-ALPHA7.md",
    "MEJORAS_ROUTER_MOVIMIENTO_INSTALADOR_ALPHA7.md",
    "COMPROBAR-DORN.ps1",
    "ESTADO-152-PUNTOS-ALPHA10.md",
    "HOTFIX-ALPHA10.1.md",
    "HOTFIX-ALPHA10.2.md",
    "HOTFIX-ALPHA10.3.md",
    "RECUPERACION-V0.4-ALPHA10.3.md",
    "README.md",
    "RECOVERY-NOTES.md",
    "RECOMPILAR-WINDOWS.md",
    "RELEASE-VERIFICATION.json",
    "VALIDAR-Y-ABRIR-DORN.cmd",
    "dorn-v3-implementation.json",
    "dorn-v3-requirements.json"
  ]) {
    fs.copyFileSync(path.join(projectRoot, relativePath), path.join(output, relativePath));
  }

  fs.writeFileSync(
    path.join(output, "ELECTRON-RUNTIME.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  console.log(`Portable ensamblado desde Electron oficial: ${output}`);
}

main();
