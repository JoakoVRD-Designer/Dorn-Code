"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const APP_ID = "com.dorn.ai";
const PRODUCT = "DORN AI";
const MANIFEST = "DORN-INSTALL-MANIFEST.json";
const OWNERSHIP = "DORN-INSTALL-OWNERSHIP.json";
const CONTROL_FILES = new Set([MANIFEST, OWNERSHIP]);

class InstallerTransactionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InstallerTransactionError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new InstallerTransactionError(code, message);
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function readStrictJson(filePath, label) {
  let stat;
  try { stat = fs.lstatSync(filePath); }
  catch { fail("DORN-INSTALL-101", `Falta ${label}.`); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size < 2 || stat.size > 32 * 1024 * 1024) {
    fail("DORN-INSTALL-102", `${label} no es un archivo regular y acotado.`);
  }
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { fail("DORN-INSTALL-103", `${label} no contiene JSON válido.`); }
}

function normalizeRelative(value) {
  const relative = String(value || "").replaceAll("\\", "/");
  const parts = relative.split("/");
  if (!relative || relative.startsWith("/") || /^[A-Za-z]:/.test(relative) || parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))) {
    fail("DORN-INSTALL-104", `Ruta insegura en el manifiesto: ${relative || "(vacía)"}.`);
  }
  return relative;
}

function ensureSafeRoot(root, label) {
  const absolute = path.resolve(String(root || ""));
  const parsed = path.parse(absolute);
  if (!path.isAbsolute(absolute) || absolute === parsed.root || absolute.length < 4 || absolute.includes('"')) {
    fail("DORN-INSTALL-105", `${label} no es una carpeta local segura.`);
  }
  return absolute;
}

function walkRegularFiles(root) {
  const files = [];
  const folded = new Map();
  const walk = (directory) => {
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail("DORN-INSTALL-106", "El paquete contiene una carpeta enlazada o no regular.");
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (stat.isSymbolicLink()) fail("DORN-INSTALL-107", `Enlace no permitido: ${relative}.`);
      if (stat.isDirectory()) { walk(absolute); continue; }
      if (!stat.isFile() || stat.nlink > 1) fail("DORN-INSTALL-108", `Entrada no regular o enlazada: ${relative}.`);
      const key = relative.toLocaleLowerCase("en-US");
      if (folded.has(key)) fail("DORN-INSTALL-109", `Colisión de ruta Windows: ${folded.get(key)} / ${relative}.`);
      folded.set(key, relative);
      files.push({ absolute, relative, sizeBytes: stat.size });
    }
  };
  walk(root);
  return files;
}

function loadMetadata(root) {
  const manifestPath = path.join(root, MANIFEST);
  const ownershipPath = path.join(root, OWNERSHIP);
  const manifest = readStrictJson(manifestPath, MANIFEST);
  const ownership = readStrictJson(ownershipPath, OWNERSHIP);
  if (manifest.schema !== "dorn.install-files/2" || ownership.schema !== "dorn.install-ownership/2") fail("DORN-INSTALL-110", "Versión de manifiesto de instalación desconocida.");
  if (manifest.product !== PRODUCT || manifest.appId !== APP_ID || ownership.product !== PRODUCT || ownership.appId !== APP_ID || ownership.version !== manifest.version) {
    fail("DORN-INSTALL-111", "El paquete no pertenece a DORN AI.");
  }
  if (!/^[a-f0-9]{64}$/.test(String(ownership.manifestSha256 || "")) || sha256File(manifestPath) !== ownership.manifestSha256) {
    fail("DORN-INSTALL-112", "El manifiesto no coincide con su registro de propiedad.");
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 50000) fail("DORN-INSTALL-113", "El manifiesto no contiene un conjunto de archivos válido.");
  const expected = new Map();
  for (const raw of manifest.files) {
    const relative = normalizeRelative(raw?.path);
    const key = relative.toLocaleLowerCase("en-US");
    if (expected.has(key)) fail("DORN-INSTALL-114", `Ruta duplicada para Windows: ${relative}.`);
    if (!Number.isSafeInteger(raw?.sizeBytes) || raw.sizeBytes < 0 || !/^[a-f0-9]{64}$/.test(String(raw?.sha256 || ""))) fail("DORN-INSTALL-115", `Metadatos inválidos: ${relative}.`);
    expected.set(key, { path: relative, sizeBytes: raw.sizeBytes, sha256: raw.sha256 });
  }
  return { manifest, ownership, expected };
}

function verifyTree(rootArgument, options = {}) {
  const root = ensureSafeRoot(rootArgument, "La raíz DORN");
  let stat;
  try { stat = fs.lstatSync(root); }
  catch { fail("DORN-INSTALL-116", "La raíz DORN no existe."); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("DORN-INSTALL-117", "La raíz DORN no es una carpeta regular.");
  const metadata = loadMetadata(root);
  const actual = walkRegularFiles(root).filter((entry) => !CONTROL_FILES.has(entry.relative));
  if (actual.length !== metadata.expected.size) fail("DORN-INSTALL-118", `El conjunto de archivos no es exacto: ${actual.length}/${metadata.expected.size}.`);
  for (const entry of actual) {
    const declared = metadata.expected.get(entry.relative.toLocaleLowerCase("en-US"));
    if (!declared || declared.path !== entry.relative) fail("DORN-INSTALL-119", `Archivo no declarado o con mayúsculas diferentes: ${entry.relative}.`);
    if (entry.sizeBytes !== declared.sizeBytes || sha256File(entry.absolute) !== declared.sha256) fail("DORN-INSTALL-120", `Archivo alterado: ${entry.relative}.`);
  }
  if (!metadata.expected.has("dorn ai.exe") || !metadata.expected.has("dorn ai uninstall.exe")) fail("DORN-INSTALL-121", "Falta el ejecutable o desinstalador principal.");
  return { root, files: actual.length, version: metadata.manifest.version, manifestSha256: metadata.ownership.manifestSha256 };
}

function inspectRepairableTree(rootArgument) {
  const root = ensureSafeRoot(rootArgument, "La instalación anterior");
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("DORN-INSTALL-122", "La instalación anterior no es una carpeta regular.");
  const entries = fs.readdirSync(root);
  if (!entries.length) return { root, empty: true };
  const metadata = loadMetadata(root);
  const actual = walkRegularFiles(root).filter((entry) => !CONTROL_FILES.has(entry.relative));
  for (const entry of actual) {
    const declared = metadata.expected.get(entry.relative.toLocaleLowerCase("en-US"));
    if (!declared || declared.path !== entry.relative) fail("DORN-INSTALL-123", `La carpeta contiene un archivo ajeno: ${entry.relative}.`);
  }
  return { root, empty: false, repairable: true, filesPresent: actual.length, filesDeclared: metadata.expected.size };
}

function parseAgentArguments(argv) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--dorn-")) continue;
    const index = argument.indexOf("=");
    if (index < 0) fail("DORN-INSTALL-124", "Argumento de agente incompleto.");
    const key = argument.slice(2, index);
    if (values.has(key)) fail("DORN-INSTALL-125", `Argumento duplicado: ${key}.`);
    values.set(key, argument.slice(index + 1));
  }
  const allowed = new Set(["dorn-installer-agent", "dorn-root", "dorn-target"]);
  for (const key of values.keys()) if (!allowed.has(key)) fail("DORN-INSTALL-126", `Argumento de agente no permitido: ${key}.`);
  return values;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US") : a === b;
}

function runInstallerAgent(argv = process.argv.slice(1), runtime = {}) {
  const args = parseAgentArguments(argv);
  const mode = args.get("dorn-installer-agent");
  if (!new Set(["prepare", "verify"]).has(mode)) fail("DORN-INSTALL-127", "Modo de agente desconocido.");
  const root = ensureSafeRoot(args.get("dorn-root"), "La raíz del agente");
  const executable = path.resolve(runtime.execPath || process.execPath);
  if (!samePath(path.dirname(executable), root)) fail("DORN-INSTALL-128", "El agente sólo puede verificar la carpeta desde la cual se está ejecutando.");
  const verified = verifyTree(root);
  if (mode === "prepare") {
    const target = ensureSafeRoot(args.get("dorn-target"), "El destino");
    if (samePath(target, root) || target.startsWith(`${root}${path.sep}`)) fail("DORN-INSTALL-129", "El destino no puede estar dentro del paquete temporal.");
    if (fs.existsSync(target)) inspectRepairableTree(target);
    return { mode, target, ...verified };
  }
  return { mode, ...verified };
}

module.exports = {
  APP_ID,
  CONTROL_FILES,
  InstallerTransactionError,
  MANIFEST,
  OWNERSHIP,
  inspectRepairableTree,
  loadMetadata,
  parseAgentArguments,
  runInstallerAgent,
  sha256File,
  verifyTree,
  walkRegularFiles
};
