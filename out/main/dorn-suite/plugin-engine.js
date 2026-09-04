"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const {
  DornSuiteError,
  ensureDirectory,
  atomicJson,
  readJson,
  sha256File,
  now
} = require("./common");

const ALLOWED_PERMISSIONS = new Set([
  "filesystem.read",
  "filesystem.write",
  "process.execute",
  "network",
  "microphone",
  "gpu",
  "models",
  "interface",
  "commands"
]);

function validateManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DornSuiteError("DORN-PLUGIN-001", "plugins", "El manifiesto del plugin no es válido.");
  }
  const manifest = {
    id: String(raw.id || ""),
    name: String(raw.name || ""),
    version: String(raw.version || ""),
    author: String(raw.author || "Desarrollador no identificado"),
    entry: String(raw.entry || "index.js"),
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(String) : [],
    formats: Array.isArray(raw.formats) ? raw.formats.map(String) : [],
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
    targetApplications: Array.isArray(raw.targetApplications) ? raw.targetApplications.map(String) : ["dorn-ai"],
    signature: raw.signature && typeof raw.signature === "object" ? raw.signature : null
  };
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(manifest.id)) {
    throw new DornSuiteError("DORN-PLUGIN-002", "plugins", "El identificador del plugin no es válido.");
  }
  if (!manifest.name || !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(manifest.version)) {
    throw new DornSuiteError("DORN-PLUGIN-003", "plugins", "El plugin necesita nombre y versión semántica.");
  }
  if (path.isAbsolute(manifest.entry) || manifest.entry.includes("..")) {
    throw new DornSuiteError("DORN-PLUGIN-004", "plugins", "La entrada del plugin debe estar dentro de su paquete.");
  }
  const invalidPermission = manifest.permissions.find((permission) => !ALLOWED_PERMISSIONS.has(permission));
  if (invalidPermission) {
    throw new DornSuiteError("DORN-PLUGIN-005", "plugins", `Permiso de plugin no reconocido: ${invalidPermission}.`);
  }
  return manifest;
}

function directoryInventory(root) {
  const result = [];
  let totalBytes = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isSymbolicLink()) {
        throw new DornSuiteError("DORN-PLUGIN-006", "plugins", "Los plugins no pueden incluir enlaces simbólicos.");
      }
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        totalBytes += stat.size;
        result.push({ relative, absolute, size: stat.size, sha256: sha256File(absolute) });
      }
      if (result.length > 5000 || totalBytes > 100 * 1024 * 1024) {
        throw new DornSuiteError("DORN-PLUGIN-007", "plugins", "El plugin supera los límites de seguridad.", {
          detail: "Máximo: 5.000 archivos y 100 MB."
        });
      }
    }
  };
  visit(root);
  return result.sort((left, right) => left.relative.localeCompare(right.relative));
}

function packageHash(inventory) {
  const hash = crypto.createHash("sha256");
  for (const entry of inventory) hash.update(`${entry.relative}\0${entry.size}\0${entry.sha256}\n`);
  return hash.digest("hex");
}

function copyInventory(inventory, destination) {
  for (const entry of inventory) {
    const target = path.join(destination, entry.relative);
    ensureDirectory(path.dirname(target));
    fs.copyFileSync(entry.absolute, target, fs.constants.COPYFILE_EXCL);
  }
}

class PluginEngine {
  constructor(stateRoot, options = {}) {
    this.root = ensureDirectory(path.join(stateRoot, "plugins"));
    this.registryPath = path.join(this.root, "registry.json");
    this.registry = readJson(this.registryPath, { plugins: {}, updatedAt: now() });
    this.audit = options.audit || (() => {});
  }

  persist() {
    this.registry.updatedAt = now();
    atomicJson(this.registryPath, this.registry);
  }

  list() {
    return Object.values(this.registry.plugins)
      .map((entry) => structuredClone(entry))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  inspect(sourceRoot) {
    const root = fs.realpathSync(sourceRoot);
    const manifestPath = ["dorn-plugin.json", "plugin.json"]
      .map((name) => path.join(root, name))
      .find((candidate) => fs.existsSync(candidate));
    if (!manifestPath) {
      throw new DornSuiteError("DORN-PLUGIN-008", "plugins", "No se encontró dorn-plugin.json.");
    }
    const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    const inventory = directoryInventory(root);
    if (!inventory.some((entry) => entry.relative === manifest.entry)) {
      throw new DornSuiteError("DORN-PLUGIN-009", "plugins", `No existe la entrada ${manifest.entry}.`);
    }
    return {
      root,
      manifest,
      inventory,
      sizeBytes: inventory.reduce((sum, entry) => sum + entry.size, 0),
      packageHash: packageHash(inventory),
      signatureStatus: manifest.signature ? "unverified" : "unsigned"
    };
  }

  install(sourceRoot, approvedPermissions = []) {
    const inspected = this.inspect(sourceRoot);
    const requested = new Set(inspected.manifest.permissions);
    const approved = new Set(approvedPermissions.map(String));
    const missing = [...requested].filter((permission) => !approved.has(permission));
    if (missing.length) {
      throw new DornSuiteError("DORN-PLUGIN-010", "plugins", "Faltan permisos explícitos para instalar el plugin.", {
        detail: missing.join(", "),
        actions: ["Revisa cada permiso y vuelve a confirmar la instalación."]
      });
    }
    const destination = path.join(this.root, inspected.manifest.id, inspected.manifest.version);
    if (fs.existsSync(destination)) {
      throw new DornSuiteError("DORN-PLUGIN-011", "plugins", "Esta versión del plugin ya está instalada.");
    }
    ensureDirectory(destination);
    try {
      copyInventory(inspected.inventory, destination);
    } catch (error) {
      fs.rmSync(destination, { recursive: true, force: true });
      throw error;
    }
    const record = {
      ...inspected.manifest,
      enabled: false,
      official: false,
      packageHash: inspected.packageHash,
      signatureStatus: inspected.signatureStatus,
      approvedPermissions: [...approved],
      sizeBytes: inspected.sizeBytes,
      installPath: destination,
      installedAt: now(),
      lastError: null
    };
    this.registry.plugins[record.id] = record;
    this.persist();
    this.audit(null, "plugin.installed", {
      pluginId: record.id,
      version: record.version,
      permissions: record.approvedPermissions,
      hash: record.packageHash
    });
    return structuredClone(record);
  }

  setEnabled(pluginId, enabled) {
    const record = this.registry.plugins[pluginId];
    if (!record) throw new DornSuiteError("DORN-PLUGIN-012", "plugins", "El plugin no está instalado.");
    record.enabled = Boolean(enabled);
    record.updatedAt = now();
    this.persist();
    this.audit(null, enabled ? "plugin.enabled" : "plugin.disabled", { pluginId });
    return structuredClone(record);
  }

  remove(pluginId, removeData = false) {
    const record = this.registry.plugins[pluginId];
    if (!record) return false;
    fs.rmSync(record.installPath, { recursive: true, force: false });
    if (removeData) {
      const dataPath = path.join(this.root, "data", pluginId);
      if (fs.existsSync(dataPath)) fs.rmSync(dataPath, { recursive: true, force: false });
    }
    delete this.registry.plugins[pluginId];
    this.persist();
    this.audit(null, "plugin.removed", { pluginId, removeData });
    return true;
  }

  invoke(pluginId, command, input) {
    const record = this.registry.plugins[pluginId];
    if (!record || !record.enabled) {
      throw new DornSuiteError("DORN-PLUGIN-013", "plugins", "El plugin no está instalado o está desactivado.");
    }
    const source = fs.readFileSync(path.join(record.installPath, record.entry), "utf8");
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "plugin-worker.js"));
      const timeout = setTimeout(() => {
        void worker.terminate();
        reject(new DornSuiteError("DORN-PLUGIN-014", "plugins", "El plugin superó el tiempo máximo de ejecución."));
      }, 5000);
      worker.once("message", (message) => {
        clearTimeout(timeout);
        void worker.terminate();
        if (message.ok) resolve(message.result);
        else reject(new DornSuiteError("DORN-PLUGIN-015", "plugins", message.error));
      });
      worker.once("error", (error) => {
        clearTimeout(timeout);
        reject(new DornSuiteError("DORN-PLUGIN-016", "plugins", error.message));
      });
      worker.postMessage({ pluginId, source, command: String(command), input });
    });
  }
}

module.exports = {
  ALLOWED_PERMISSIONS,
  validateManifest,
  PluginEngine
};
