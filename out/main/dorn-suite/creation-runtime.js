"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");

const CATEGORY = Object.freeze({
  ".exe": ["application", "application/vnd.microsoft.portable-executable"], ".msi": ["installer", "application/x-msi"], ".appx": ["installer", "application/appx"], ".msix": ["installer", "application/msix"],
  ".zip": ["archive", "application/zip"], ".7z": ["archive", "application/x-7z-compressed"], ".rar": ["archive", "application/vnd.rar"], ".tar": ["archive", "application/x-tar"], ".gz": ["archive", "application/gzip"], ".bz2": ["archive", "application/x-bzip2"], ".xz": ["archive", "application/x-xz"], ".tgz": ["archive", "application/gzip"],
  ".png": ["image", "image/png"], ".jpg": ["image", "image/jpeg"], ".jpeg": ["image", "image/jpeg"], ".webp": ["image", "image/webp"], ".gif": ["image", "image/gif"], ".bmp": ["image", "image/bmp"], ".svg": ["image", "image/svg+xml"], ".avif": ["image", "image/avif"], ".ico": ["image", "image/x-icon"],
  ".mp3": ["audio", "audio/mpeg"], ".wav": ["audio", "audio/wav"], ".m4a": ["audio", "audio/mp4"], ".aac": ["audio", "audio/aac"], ".ogg": ["audio", "audio/ogg"], ".oga": ["audio", "audio/ogg"], ".opus": ["audio", "audio/ogg"], ".flac": ["audio", "audio/flac"],
  ".mp4": ["video", "video/mp4"], ".m4v": ["video", "video/mp4"], ".webm": ["video", "video/webm"], ".mov": ["video", "video/quicktime"], ".avi": ["video", "video/x-msvideo"], ".mkv": ["video", "video/x-matroska"],
  ".pdf": ["document", "application/pdf"], ".doc": ["document", "application/msword"], ".docx": ["document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ".odt": ["document", "application/vnd.oasis.opendocument.text"],
  ".xls": ["spreadsheet", "application/vnd.ms-excel"], ".xlsx": ["spreadsheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ".ods": ["spreadsheet", "application/vnd.oasis.opendocument.spreadsheet"], ".csv": ["spreadsheet", "text/csv"], ".tsv": ["spreadsheet", "text/tab-separated-values"],
  ".ppt": ["presentation", "application/vnd.ms-powerpoint"], ".pptx": ["presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation"], ".odp": ["presentation", "application/vnd.oasis.opendocument.presentation"],
  ".txt": ["text", "text/plain"], ".md": ["text", "text/markdown"], ".html": ["web", "text/html"], ".htm": ["web", "text/html"], ".css": ["code", "text/css"], ".js": ["code", "text/javascript"], ".cjs": ["code", "text/javascript"], ".mjs": ["code", "text/javascript"], ".ts": ["code", "text/typescript"], ".tsx": ["code", "text/typescript"], ".jsx": ["code", "text/javascript"], ".json": ["code", "application/json"], ".xml": ["code", "application/xml"], ".yaml": ["code", "text/yaml"], ".yml": ["code", "text/yaml"], ".py": ["code", "text/x-python"], ".ps1": ["code", "text/plain"], ".bat": ["code", "text/plain"], ".cmd": ["code", "text/plain"], ".sh": ["code", "text/x-shellscript"],
  ".obj": ["model3d", "model/obj"], ".stl": ["model3d", "model/stl"], ".ply": ["model3d", "application/octet-stream"], ".gltf": ["model3d", "model/gltf+json"], ".glb": ["model3d", "model/gltf-binary"], ".fbx": ["model3d", "application/octet-stream"], ".3mf": ["model3d", "model/3mf"],
  ".step": ["cad", "application/step"], ".stp": ["cad", "application/step"], ".iges": ["cad", "model/iges"], ".igs": ["cad", "model/iges"], ".dxf": ["cad", "image/vnd.dxf"], ".dwg": ["cad", "image/vnd.dwg"]
});

const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "out", ".next", "__pycache__", ".cache", "coverage"]);
const COMMANDS = ["node", "npm", "npx", "python", "python3", "pip", "git", "gh", "powershell", "cmd", "bash", "rg", "7z", "zip", "tar", "zig", "cmake", "gcc", "clang", "dotnet", "java", "gradle", "adb", "ffmpeg", "magick", "convert", "inkscape", "blender", "freecad", "openscad", "objdump", "sqlite3", "code", "playwright"];
const WINDOWS_APPS = [
  ["Visual Studio", ["Microsoft Visual Studio"]], ["Android Studio", ["Android\\Android Studio"]], ["Roblox Studio", ["Roblox"]], ["Unity", ["Unity Hub", "Unity"]], ["Unreal Engine", ["Epic Games\\UE_"]],
  ["SOLIDWORKS", ["SOLIDWORKS Corp"]], ["AutoCAD", ["Autodesk\\AutoCAD"]], ["Autodesk Fusion", ["Autodesk\\webdeploy"]], ["Cinema 4D", ["Maxon Cinema 4D"]], ["Photoshop", ["Adobe\\Adobe Photoshop"]]
];

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function sha256File(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const hash = crypto.createHash("sha256");
  try {
    let read = 0;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read) hash.update(buffer.subarray(0, read));
    } while (read);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function commandAvailable(command) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = childProcess.spawnSync(finder, [command], { windowsHide: true, encoding: "utf8", timeout: 2_500 });
  return result.status === 0 ? String(result.stdout || "").split(/\r?\n/).find(Boolean) || command : null;
}

function applicationAvailable(candidates) {
  if (process.platform !== "win32") return null;
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  for (const root of roots) {
    for (const candidate of candidates) {
      const absolute = path.join(root, candidate);
      if (fs.existsSync(absolute) || (candidate.endsWith("_") && fs.existsSync(path.dirname(absolute)) && fs.readdirSync(path.dirname(absolute)).some((name) => name.startsWith(path.basename(absolute))))) return absolute;
    }
  }
  return null;
}

class CreationRuntime {
  constructor(options) {
    this.database = options.database;
    this.shell = options.shell;
    this.registryPath = path.join(options.stateRoot, "creation-results.json");
    this.registry = readJson(this.registryPath, { version: 1, results: [] });
  }

  describe(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const [category, mime] = CATEGORY[extension] || ["file", "application/octet-stream"];
    return { extension, category, mime, preview: ["image", "audio", "video", "text", "code", "web", "spreadsheet"].includes(category) };
  }

  record(project, filePath, state = "ready") {
    const absolute = fs.realpathSync(filePath);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) return null;
    const meta = this.describe(absolute);
    const relativePath = path.relative(project.rootPath, absolute).split(path.sep).join("/");
    const existing = this.registry.results.find((entry) => entry.projectId === project.id && entry.relativePath === relativePath);
    const result = {
      id: existing?.id || crypto.randomUUID(),
      projectId: project.id,
      projectName: project.name,
      path: absolute,
      relativePath,
      name: path.basename(absolute),
      ...meta,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      state,
      sha256: sha256File(absolute),
      indexedAt: new Date().toISOString()
    };
    if (existing) Object.assign(existing, result);
    else this.registry.results.unshift(result);
    this.registry.results = this.registry.results.slice(0, 5_000);
    atomicJson(this.registryPath, this.registry);
    return { ...result, path: undefined };
  }

  scanProject(project) {
    const root = fs.realpathSync(project.rootPath);
    const files = [];
    const walk = (directory) => {
      if (files.length >= 5_000) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name))) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile() && CATEGORY[path.extname(entry.name).toLowerCase()]) files.push(absolute);
        if (files.length >= 5_000) break;
      }
    };
    walk(root);
    const results = files.map((filePath) => this.record(project, filePath)).filter(Boolean);
    return { projectId: project.id, files: results.length, truncated: files.length >= 5_000 };
  }

  scanAll() {
    const projects = this.database.listProjects();
    return { projects: projects.map((project) => this.scanProject(project)), results: this.registry.results.length };
  }

  list(filters = {}) {
    let results = this.registry.results.filter((entry) => fs.existsSync(entry.path));
    if (filters.projectId) results = results.filter((entry) => entry.projectId === String(filters.projectId));
    if (filters.category) results = results.filter((entry) => entry.category === String(filters.category));
    if (filters.query) {
      const query = String(filters.query).toLowerCase();
      results = results.filter((entry) => `${entry.name} ${entry.relativePath} ${entry.projectName}`.toLowerCase().includes(query));
    }
    return results.slice(0, Math.max(1, Math.min(Number(filters.limit || 250), 1_000))).map((entry) => ({ ...entry, path: undefined, previewUrl: entry.preview ? `dorn-result://asset/${entry.id}` : null }));
  }

  resolve(resultId) {
    const result = this.registry.results.find((entry) => entry.id === String(resultId));
    if (!result || !fs.existsSync(result.path)) return null;
    return result;
  }

  remove(resultId) {
    const before = this.registry.results.length;
    this.registry.results = this.registry.results.filter((entry) => entry.id !== String(resultId));
    if (this.registry.results.length !== before) atomicJson(this.registryPath, this.registry);
    return this.registry.results.length !== before;
  }

  async open(resultId) {
    const result = this.resolve(resultId);
    if (!result) throw new Error("El resultado ya no existe en su ubicación original.");
    const error = await this.shell.openPath(result.path);
    if (error) throw new Error(error);
    return true;
  }

  reveal(resultId) {
    const result = this.resolve(resultId);
    if (!result) throw new Error("El resultado ya no existe en su ubicación original.");
    this.shell.showItemInFolder(result.path);
    return true;
  }

  textPreview(resultId) {
    const result = this.resolve(resultId);
    if (!result || !["text", "code", "web", "spreadsheet"].includes(result.category)) return null;
    if (result.sizeBytes > 512 * 1024) return { truncated: true, content: "El archivo supera 512 KB. Ábrelo para revisarlo completo." };
    const buffer = fs.readFileSync(result.path);
    if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) return null;
    return { truncated: false, content: buffer.toString("utf8") };
  }

  tools() {
    const commands = COMMANDS.map((name) => {
      const detected = commandAvailable(name);
      return { name, kind: "command", available: Boolean(detected), path: detected };
    });
    const applications = WINDOWS_APPS.map(([name, candidates]) => {
      const detected = applicationAvailable(candidates);
      return { name, kind: "application-adapter", available: Boolean(detected), path: detected, redistributed: false };
    });
    return {
      scannedAt: new Date().toISOString(),
      tools: [...commands, ...applications],
      profiles: ["web", "electron-windows", "python", "documents", "multimedia", "3d-cad", "android", "games"],
      policy: "Las aplicaciones propietarias se usan sólo mediante instalaciones y licencias autorizadas."
    };
  }
}

module.exports = { CreationRuntime, CATEGORY };
