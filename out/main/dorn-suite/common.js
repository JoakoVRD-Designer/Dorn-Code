"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class DornSuiteError extends Error {
  constructor(code, moduleName, message, options = {}) {
    super(message);
    this.name = "DornSuiteError";
    this.code = code;
    this.module = moduleName;
    this.causeText = options.cause || "";
    this.detail = options.detail || "";
    this.actions = Array.isArray(options.actions) ? options.actions : [];
    this.retryable = Boolean(options.retryable);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      module: this.module,
      message: this.message,
      cause: this.causeText,
      detail: this.detail,
      actions: this.actions,
      retryable: this.retryable
    };
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function atomicJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes = 0;
    do {
      bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function safeRelativeRoot(rootPath, relativePath = "") {
  const root = fs.realpathSync(rootPath);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new DornSuiteError("DORN-FS-001", "filesystem", "La ruta queda fuera del proyecto autorizado.", {
      cause: "La ruta relativa intentó escapar de la carpeta del proyecto.",
      actions: ["Selecciona un archivo dentro del proyecto.", "Conecta otra carpeta de forma explícita."]
    });
  }
  return { root, target };
}

function redact(value) {
  return String(value)
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s]+/gi, "$1=[OCULTO]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [OCULTO]");
}

function tokenize(text) {
  return new Set(
    String(text)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9ñ]+/)
      .filter((token) => token.length > 2)
  );
}

function similarity(left, right) {
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

function now() {
  return new Date().toISOString();
}

module.exports = {
  DornSuiteError,
  ensureDirectory,
  atomicJson,
  readJson,
  sha256Buffer,
  sha256File,
  safeRelativeRoot,
  redact,
  similarity,
  now
};
