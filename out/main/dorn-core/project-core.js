"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { atomicJson } = require("../dorn-suite/common");

const PROJECT_SCHEMA = "dorn.project/1";
const PROJECT_DIRECTORIES = Object.freeze([
  "memory", "graph", "tasks", "evidence", "snapshots", "builds", "manifests",
  "requirements", "decisions", "failures", "procedures"
]);
const TRUST_STATES = new Set(["UNTRUSTED", "TRUSTED", "RESTRICTED"]);
const SCRIPT_FILES = new Set(["package.json", "Makefile", "CMakeLists.txt", "build.gradle", "settings.gradle", "pom.xml", "Cargo.toml", "pyproject.toml"]);
const INSPECTION_IGNORES = new Set([".dorn", ".git", "node_modules", "dist", "build", "out", ".gradle", ".idea", ".vscode", "coverage", "target", ".pio"]);
const LANGUAGE_BY_EXTENSION = Object.freeze({
  ".js": "JavaScript", ".cjs": "JavaScript", ".mjs": "JavaScript", ".jsx": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript", ".kt": "Kotlin", ".java": "Java",
  ".py": "Python", ".rs": "Rust", ".go": "Go", ".cs": "C#", ".cpp": "C++",
  ".cc": "C++", ".c": "C", ".h": "C/C++", ".swift": "Swift", ".dart": "Dart",
  ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".sql": "SQL", ".ino": "Arduino",
  ".gd": "GDScript", ".shader": "Shader"
});
const MANIFEST_NAMES = new Set([
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.toml", "Cargo.lock",
  "pyproject.toml", "requirements.txt", "poetry.lock", "go.mod", "go.sum", "pom.xml",
  "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradle.properties",
  "CMakeLists.txt", "platformio.ini", "sdkconfig", "project.godot", "UnityProjectVersion.txt"
]);

function projectError(code, message) {
  return Object.assign(new Error(message), { code });
}

function boundedText(value, maximum, fallback = "") {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, maximum);
}

function projectId(value) {
  const id = boundedText(value, 128);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw projectError("PROJECT_ID_INVALID", "La identidad del proyecto DORN no es válida.");
  return id;
}

function canonicalDirectory(rootPath) {
  const root = fs.realpathSync(String(rootPath || ""));
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw projectError("PROJECT_ROOT_INVALID", "Un proyecto DORN debe ser una carpeta real.");
  return root;
}

function assertRealDirectoryWithin(parent, target, label) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw projectError("PROJECT_METADATA_UNSAFE", `${label} no puede ser un enlace ni un archivo.`);
  const real = fs.realpathSync(target);
  if (path.dirname(real) !== parent) throw projectError("PROJECT_METADATA_ESCAPE", `${label} queda fuera del proyecto.`);
  return real;
}

function parseManifest(manifestPath, root) {
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    throw projectError("PROJECT_METADATA_UNSAFE", "El manifiesto .dorn/project.json no es un archivo regular seguro.");
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
  catch { throw projectError("PROJECT_METADATA_INVALID", "El manifiesto .dorn/project.json está dañado; DORN no lo sobrescribió."); }
  if (!manifest || manifest.schema !== PROJECT_SCHEMA || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw projectError("PROJECT_METADATA_INVALID", "El manifiesto .dorn/project.json tiene un contrato desconocido; DORN no lo sobrescribió.");
  }
  const id = projectId(manifest.projectId);
  const trustState = String(manifest.trustState || "UNTRUSTED").toUpperCase();
  if (!TRUST_STATES.has(trustState)) throw projectError("PROJECT_METADATA_INVALID", "El manifiesto contiene un estado de confianza inválido.");
  return {
    schema: PROJECT_SCHEMA,
    projectId: id,
    name: boundedText(manifest.name, 100, path.basename(root)),
    root: boundedText(manifest.root, 4096, root),
    trustState,
    executableSurface: Boolean(manifest.executableSurface),
    createdAt: boundedText(manifest.createdAt, 64),
    updatedAt: boundedText(manifest.updatedAt, 64),
    extensions: manifest.extensions && typeof manifest.extensions === "object" && !Array.isArray(manifest.extensions)
      ? structuredClone(manifest.extensions)
      : undefined
  };
}

function hasExecutableSurface(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).some((entry) =>
      entry.isFile() && (SCRIPT_FILES.has(entry.name) || /\.(exe|msi|cmd|bat|ps1|sh|appimage)$/i.test(entry.name))
    );
  } catch { return true; }
}

class ProjectCore {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
  }

  eventBus;

  probe(rootPath) {
    const root = canonicalDirectory(rootPath);
    const dornPath = path.join(root, ".dorn");
    if (!fs.existsSync(dornPath)) return { schema: "dorn.project-probe/1", rootPath: root, status: "UNMANAGED", manifest: null };
    const dornRoot = assertRealDirectoryWithin(root, dornPath, ".dorn");
    const manifestPath = path.join(dornRoot, "project.json");
    if (!fs.existsSync(manifestPath)) return { schema: "dorn.project-probe/1", rootPath: root, dornRoot, status: "UNMANAGED", manifest: null };
    const manifest = parseManifest(manifestPath, root);
    return { schema: "dorn.project-probe/1", rootPath: root, dornRoot, manifestPath, status: "READY", manifest };
  }

  ensureMetadataDirectories(root) {
    const dornPath = path.join(root, ".dorn");
    if (!fs.existsSync(dornPath)) fs.mkdirSync(dornPath, { mode: 0o700 });
    const dornRoot = assertRealDirectoryWithin(root, dornPath, ".dorn");
    for (const directory of PROJECT_DIRECTORIES) {
      const target = path.join(dornRoot, directory);
      if (!fs.existsSync(target)) fs.mkdirSync(target, { mode: 0o700 });
      assertRealDirectoryWithin(dornRoot, target, `.dorn/${directory}`);
    }
    return dornRoot;
  }

  adopt(rootPath, options = {}) {
    const root = canonicalDirectory(rootPath);
    const before = this.probe(root);
    const requestedId = options.projectId ? projectId(options.projectId) : null;
    if (before.manifest?.projectId && requestedId && before.manifest.projectId !== requestedId) {
      throw projectError("PROJECT_IDENTITY_CONFLICT", "La carpeta ya tiene una identidad DORN distinta; no se duplicó ni reescribió.");
    }
    const id = before.manifest?.projectId || requestedId || crypto.randomUUID();
    const requestedTrust = options.trustState ? String(options.trustState).toUpperCase() : null;
    if (requestedTrust && !TRUST_STATES.has(requestedTrust)) throw projectError("PROJECT_TRUST_INVALID", "Estado de confianza inválido.");
    const now = new Date().toISOString();
    const dornRoot = this.ensureMetadataDirectories(root);
    const manifestPath = path.join(dornRoot, "project.json");
    if (fs.existsSync(manifestPath)) parseManifest(manifestPath, root);
    const manifest = {
      schema: PROJECT_SCHEMA,
      projectId: id,
      name: boundedText(options.name, 100, before.manifest?.name || path.basename(root)),
      root,
      trustState: requestedTrust || before.manifest?.trustState || "UNTRUSTED",
      executableSurface: hasExecutableSurface(root),
      createdAt: before.manifest?.createdAt || now,
      updatedAt: now
    };
    if (before.manifest?.extensions) manifest.extensions = before.manifest.extensions;
    atomicJson(manifestPath, manifest);
    const result = { ...manifest, rootPath: root, dornRoot, status: "READY", git: this.gitStatus(root) };
    void this.eventBus?.publish("PROJECT_OPENED", { status: result.status, trustState: result.trustState }, {
      projectId: id,
      idempotencyKey: `project-open:${id}:${Math.round(Date.now() / 1000)}`
    });
    return result;
  }

  open(rootPath, options = {}) {
    return this.adopt(rootPath, options);
  }

  setTrust(rootPath, trustState, expectedProjectId = null) {
    return this.adopt(rootPath, { projectId: expectedProjectId || undefined, trustState });
  }

  gitStatus(rootPath) {
    try {
      const output = childProcess.execFileSync("git", ["-C", rootPath, "status", "--porcelain=v1", "--branch"], {
        encoding: "utf8", timeout: 2500, windowsHide: true, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]
      });
      const lines = output.trim().split(/\r?\n/).filter(Boolean);
      return { available: true, branch: (lines.shift() || "").replace(/^##\s*/, ""), changed: lines.length, entries: lines.slice(0, 200) };
    } catch { return { available: false, branch: null, changed: 0, entries: [] }; }
  }

  inspect(rootPath, options = {}) {
    const root = canonicalDirectory(rootPath);
    const maxFiles = Math.max(100, Math.min(20000, Number(options.maxFiles) || 5000));
    const timeBudgetMs = Math.max(50, Math.min(5000, Number(options.timeBudgetMs) || 750));
    const started = Date.now();
    const queue = [root];
    const languages = new Map();
    const manifests = [];
    let filesScanned = 0;
    let ignoredDirectories = 0;
    while (queue.length && filesScanned < maxFiles && Date.now() - started < timeBudgetMs) {
      const directory = queue.shift();
      let entries = [];
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (filesScanned >= maxFiles || Date.now() - started >= timeBudgetMs) break;
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (INSPECTION_IGNORES.has(entry.name)) ignoredDirectories += 1;
          else queue.push(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        filesScanned += 1;
        const relativePath = path.relative(root, absolute).split(path.sep).join("/");
        const language = LANGUAGE_BY_EXTENSION[path.extname(entry.name).toLowerCase()];
        if (language) languages.set(language, (languages.get(language) || 0) + 1);
        if (MANIFEST_NAMES.has(entry.name) && manifests.length < 300) manifests.push(relativePath);
      }
    }
    let packageScripts = [];
    try {
      const stat = fs.lstatSync(path.join(root, "package.json"));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("package inseguro");
      const parsed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      packageScripts = Object.keys(parsed.scripts || {}).slice(0, 100);
    } catch {}
    const probe = this.probe(root);
    const capsule = {
      schema: "dorn.environment-capsule/1",
      projectId: options.projectId || probe.manifest?.projectId || null,
      host: { platform: process.platform, arch: process.arch, node: process.version },
      staticOnly: true,
      trustRequiredForExecution: true,
      languages: [...languages.entries()].sort((left, right) => right[1] - left[1]).map(([name, files]) => ({ name, files })),
      manifests: manifests.sort(),
      packageScripts,
      scan: { filesScanned, ignoredDirectories, complete: queue.length === 0, remainingDirectories: queue.length, durationMs: Date.now() - started },
      inspectedAt: new Date().toISOString()
    };
    if (options.persist === true) {
      if (!probe.manifest) throw projectError("PROJECT_NOT_ADOPTED", "DORN no escribirá la inspección hasta que el proyecto sea adoptado explícitamente.");
      atomicJson(path.join(probe.dornRoot, "manifests", "environment-capsule.json"), capsule);
    }
    return capsule;
  }

  assertTrusted(project, operation) {
    if (project?.trustState !== "TRUSTED") {
      throw projectError("UNTRUSTED_WORKSPACE", `El workspace no es confiable para ejecutar ${operation || "esta operación"}.`);
    }
    return true;
  }
}

module.exports = {
  ProjectCore,
  PROJECT_DIRECTORIES,
  PROJECT_SCHEMA,
  TRUST_STATES,
  hasExecutableSurface,
  INSPECTION_IGNORES,
  LANGUAGE_BY_EXTENSION,
  MANIFEST_NAMES
};
