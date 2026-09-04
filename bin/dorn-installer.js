#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  DornInstallerEngine
} = require("../out/main/dorn-suite/installer-engine");

function parseArguments(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const [rawKey, inline] = value.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inline !== undefined) result[key] = inline;
    else if (values[index + 1] && !values[index + 1].startsWith("--")) result[key] = values[++index];
    else result[key] = true;
  }
  return result;
}

function required(options, name) {
  if (!options[name] || options[name] === true) {
    throw new Error(`Falta --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`);
  }
  return path.resolve(String(options[name]));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function printHelp() {
  process.stdout.write([
    "DORN Installer Studio CLI",
    "",
    "Comandos:",
    "  template",
    "  analyze --source <carpeta> --config <dorn-installer.json>",
    "  build --source <carpeta> --config <archivo> --out <producto.dornpkg>",
    "  inspect --package <producto.dornpkg> [--public-key <archivo.pem>]",
    "  install --package <archivo> --destination <carpeta> [--profile <id>] [--components <a,b>]",
    "  verify --product <id>",
    "  repair --product <id>",
    "  uninstall --product <id> [--force] [--remove-user-data]",
    "  move --product <id> --destination <carpeta>",
    "  split --package <archivo> --out-dir <carpeta> [--chunk-mb <512>]",
    "  reconstruct --manifest <archivo.parts.json> --out <archivo.zip>",
    "  patch-create --base <base.dornpkg> --target <nueva.dornpkg> --out <actualizacion.dornpatch>",
    "  patch-inspect --patch <actualizacion.dornpatch>",
    "  patch-apply --base <base.dornpkg> --patch <actualizacion.dornpatch> --out <nueva.dornpkg>",
    "  bundle-create --packages <uno.dornpkg,dos.dornpkg> --out <suite.dornbundle> [--id <id>] [--name <nombre>] [--version <1.0.0>]",
    "  bundle-extract --bundle <suite.dornbundle> --destination <carpeta>",
    "  compare --left <manifest.json> --right <manifest.json>",
    "  deduplicate --manifests <uno.json,dos.json>",
    "  cleanup [--max-age-hours <24>]",
    "",
    "Opciones globales:",
    "  --state <carpeta>   Registro y temporales del motor",
    "  --json              Salida JSON compacta",
    ""
  ].join("\n"));
}

async function execute(argv) {
  const options = parseArguments(argv);
  const command = options._[0];
  if (!command || command === "help" || options.help) {
    printHelp();
    return { help: true };
  }
  const stateRoot = options.state
    ? path.resolve(String(options.state))
    : path.join(os.homedir(), ".dorn-installer");
  const engine = new DornInstallerEngine(stateRoot);
  switch (command) {
    case "template":
      return engine.projectTemplate();
    case "analyze":
      return engine.analyzeSource(required(options, "source"), readJson(required(options, "config")));
    case "build": {
      const privateKey = options.privateKey
        ? fs.readFileSync(required(options, "privateKey"), "utf8")
        : null;
      return engine.build(
        required(options, "source"),
        readJson(required(options, "config")),
        required(options, "out"),
        { privateKey }
      );
    }
    case "inspect": {
      const publicKey = options.publicKey
        ? fs.readFileSync(required(options, "publicKey"), "utf8")
        : null;
      return engine.inspectPackage(required(options, "package"), { publicKey });
    }
    case "install":
      return engine.install(required(options, "package"), required(options, "destination"), {
        profileId: options.profile ? String(options.profile) : undefined,
        components: options.components ? String(options.components).split(",").filter(Boolean) : undefined,
        publicKey: options.publicKey ? fs.readFileSync(required(options, "publicKey"), "utf8") : undefined
      });
    case "verify":
      return engine.verifyInstallation(String(options.product || ""));
    case "repair":
      return engine.repair(String(options.product || ""));
    case "uninstall":
      return engine.uninstall(String(options.product || ""), {
        force: Boolean(options.force),
        removeUserData: Boolean(options.removeUserData)
      });
    case "move":
      return engine.move(String(options.product || ""), required(options, "destination"));
    case "split":
      return engine.split(
        required(options, "package"),
        required(options, "outDir"),
        Math.max(1, Number(options.chunkMb || 512)) * 1024 * 1024
      );
    case "reconstruct":
      return engine.reconstruct(required(options, "manifest"), required(options, "out"));
    case "patch-create":
      return engine.createPatch(
        required(options, "base"),
        required(options, "target"),
        required(options, "out")
      );
    case "patch-inspect":
      return engine.inspectPatch(required(options, "patch"));
    case "patch-apply":
      return engine.applyPatch(
        required(options, "base"),
        required(options, "patch"),
        required(options, "out")
      );
    case "bundle-create": {
      if (!options.packages) throw new Error("Falta --packages.");
      const packagePaths = String(options.packages).split(",").filter(Boolean).map((filePath) => path.resolve(filePath));
      return engine.createBundle(packagePaths, required(options, "out"), {
        id: options.id,
        name: options.name,
        version: options.version
      });
    }
    case "bundle-extract":
      return engine.extractBundle(required(options, "bundle"), required(options, "destination"));
    case "compare":
      return engine.compare(readJson(required(options, "left")), readJson(required(options, "right")));
    case "deduplicate": {
      if (!options.manifests) throw new Error("Falta --manifests.");
      const manifests = String(options.manifests).split(",").map((filePath) => readJson(path.resolve(filePath)));
      return engine.analyzeDeduplication(manifests);
    }
    case "cleanup":
      return engine.cleanupTemporary(Number(options.maxAgeHours || 24));
    default:
      throw new Error(`Comando desconocido: ${command}. Usa help para ver las opciones.`);
  }
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await execute(process.argv.slice(2));
    if (!result?.help) process.stdout.write(`${JSON.stringify(result, null, options.json ? 0 : 2)}\n`);
  } catch (error) {
    const payload = typeof error?.toJSON === "function"
      ? error.toJSON()
      : { name: error?.name || "Error", message: error?.message || String(error) };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  parseArguments,
  execute
};
