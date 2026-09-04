"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const https = require("node:https");
const { ZipArchive } = require("archiver");
const extractZip = require("extract-zip");
const {
  DornSuiteError,
  ensureDirectory,
  atomicJson,
  readJson,
  sha256Buffer,
  sha256File,
  now
} = require("./common");

const PACKAGE_SCHEMA = "dorn-package/1";
const MULTIPART_SCHEMA = "dorn-multipart/1";
const PATCH_SCHEMA = "dorn-patch/1";
const BUNDLE_SCHEMA = "dorn-bundle/1";
const MAX_FILES = 100000;
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024 * 1024;
const DEFAULT_EXCLUDES = [
  ".git/**",
  ".dorn/**",
  "node_modules/.cache/**",
  "*.tmp",
  "*.log"
];

function installerError(code, message, options = {}) {
  return new DornSuiteError(code, "installer", message, options);
}

function normalizeRelative(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.includes("\0")) {
    throw installerError("DORN-INSTALL-001", "La ruta del paquete no es válida.");
  }
  const segments = normalized.split("/");
  if (segments.includes("..") || segments.includes(".")) {
    throw installerError("DORN-INSTALL-002", "El paquete contiene una ruta insegura.");
  }
  return normalized;
}

function safeJoin(root, relative) {
  const normalized = normalizeRelative(relative);
  const target = path.resolve(root, ...normalized.split("/"));
  const resolvedRoot = path.resolve(root);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw installerError("DORN-INSTALL-003", "La ruta sale del destino autorizado.");
  }
  return target;
}

function globExpression(pattern) {
  let expression = "";
  const normalized = String(pattern).replace(/\\/g, "/");
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[|\\{}()[\]^$+?.-]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`, "i");
}

function matches(relative, patterns) {
  const value = relative.replace(/\\/g, "/");
  return patterns.some((pattern) => globExpression(pattern).test(value));
}

function validateIdentifier(value, field) {
  const text = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(text)) {
    throw installerError("DORN-INSTALL-004", `${field} no tiene un identificador válido.`);
  }
  return text;
}

function validateVersion(value) {
  const version = String(value || "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw installerError("DORN-INSTALL-005", "La versión debe usar formato semántico, por ejemplo 1.2.0.");
  }
  return version;
}

function versionParts(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw installerError("DORN-INSTALL-033", "No se pueden comparar versiones no semánticas.");
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function normalizedProject(project) {
  if (!project || typeof project !== "object") {
    throw installerError("DORN-INSTALL-006", "Falta la configuración del proyecto de instalador.");
  }
  const components = Array.isArray(project.components) ? project.components.map((component) => ({
    id: validateIdentifier(component.id, "El componente"),
    label: String(component.label || component.id).slice(0, 120),
    description: String(component.description || "").slice(0, 500),
    required: Boolean(component.required),
    patterns: Array.isArray(component.patterns) && component.patterns.length
      ? component.patterns.map(String)
      : []
  })) : [];
  const componentIds = new Set(components.map((component) => component.id));
  if (componentIds.size !== components.length) {
    throw installerError("DORN-INSTALL-007", "Hay identificadores de componentes repetidos.");
  }
  const dependencies = Array.isArray(project.dependencies) ? project.dependencies.map((dependency) => ({
    id: validateIdentifier(dependency.id, "La dependencia"),
    version: String(dependency.version || "*"),
    optional: Boolean(dependency.optional),
    url: dependency.url ? String(dependency.url) : ""
  })) : [];
  const profiles = Array.isArray(project.profiles) ? project.profiles.map((profile) => {
    const selected = Array.isArray(profile.components) ? profile.components.map(String) : [];
    if (selected.some((id) => !componentIds.has(id))) {
      throw installerError("DORN-INSTALL-008", `El perfil ${profile.id} utiliza un componente desconocido.`);
    }
    return {
      id: validateIdentifier(profile.id, "El perfil"),
      label: String(profile.label || profile.id).slice(0, 120),
      components: selected
    };
  }) : [];
  return {
    schema: PACKAGE_SCHEMA,
    id: validateIdentifier(project.id, "El producto"),
    name: String(project.name || project.id).trim().slice(0, 160),
    version: validateVersion(project.version),
    publisher: String(project.publisher || "DORN").trim().slice(0, 160),
    description: String(project.description || "").slice(0, 2000),
    platform: String(project.platform || "win32").toLowerCase(),
    architectures: Array.isArray(project.architectures) && project.architectures.length
      ? Array.from(new Set(project.architectures.map((value) => String(value).toLowerCase())))
      : ["x64"],
    requiredCoreVersion: project.requiredCoreVersion ? validateVersion(project.requiredCoreVersion) : null,
    installationScope: project.installationScope === "machine" ? "machine" : "user",
    include: Array.isArray(project.include) && project.include.length ? project.include.map(String) : ["**"],
    exclude: [...DEFAULT_EXCLUDES, ...(Array.isArray(project.exclude) ? project.exclude.map(String) : [])],
    components,
    profiles,
    dependencies,
    entryPoints: Array.isArray(project.entryPoints) ? project.entryPoints.map((entry) => ({
      id: validateIdentifier(entry.id, "El acceso"),
      relativePath: normalizeRelative(entry.relativePath),
      shortcut: entry.shortcut !== false
    })) : [],
    userData: Array.isArray(project.userData) ? project.userData.map(normalizeRelative) : [],
    metadata: project.metadata && typeof project.metadata === "object" ? project.metadata : {}
  };
}

function walkFiles(sourceRoot, project) {
  const root = fs.realpathSync(sourceRoot);
  const result = [];
  let totalBytes = 0;
  const visit = (directory, prefix = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = normalizeRelative(prefix ? `${prefix}/${entry.name}` : entry.name);
      if (matches(relative, project.exclude) || matches(`${relative}/`, project.exclude)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw installerError("DORN-INSTALL-009", `No se empaquetó ${relative}: los enlaces simbólicos no están permitidos.`);
      }
      if (entry.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!entry.isFile() || !matches(relative, project.include)) continue;
      const stat = fs.statSync(absolute);
      totalBytes += stat.size;
      if (result.length >= MAX_FILES || totalBytes > MAX_PACKAGE_BYTES) {
        throw installerError("DORN-INSTALL-010", "El proyecto supera los límites seguros del empaquetador.");
      }
      const components = project.components
        .filter((component) => component.patterns.some((pattern) => globExpression(pattern).test(relative)))
        .map((component) => component.id);
      result.push({
        relativePath: relative,
        absolutePath: absolute,
        sizeBytes: stat.size,
        sha256: sha256File(absolute),
        mode: stat.mode & 0o777,
        components
      });
    }
  };
  visit(root);
  result.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { root, files: result, totalBytes };
}

function canonicalManifest(manifest) {
  const copy = structuredClone(manifest);
  delete copy.signature;
  return Buffer.from(JSON.stringify(copy));
}

function signManifest(manifest, privateKey) {
  if (!privateKey) return manifest;
  const signature = crypto.sign(null, canonicalManifest(manifest), privateKey);
  return {
    ...manifest,
    signature: {
      algorithm: "ed25519",
      value: signature.toString("base64")
    }
  };
}

function verifyManifestSignature(manifest, publicKey) {
  if (!manifest.signature) return { signed: false, valid: null };
  if (!publicKey) return { signed: true, valid: null };
  const valid = crypto.verify(
    null,
    canonicalManifest(manifest),
    publicKey,
    Buffer.from(manifest.signature.value, "base64")
  );
  return { signed: true, valid };
}

function writeEntriesArchive(outputPath, entries) {
  ensureDirectory(path.dirname(outputPath));
  const temporary = `${outputPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(temporary, { mode: 0o600 });
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const fail = (error) => {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
      }
      reject(error);
    };
    output.on("close", () => {
      try {
        fs.renameSync(temporary, outputPath);
        resolve();
      } catch (error) {
        fail(error);
      }
    });
    output.on("error", fail);
    archive.on("warning", (error) => error.code === "ENOENT" ? fail(error) : fail(error));
    archive.on("error", fail);
    archive.pipe(output);
    for (const entry of entries) {
      const source = entry.buffer === undefined
        ? fs.createReadStream(entry.absolutePath)
        : entry.buffer;
      archive.append(source, {
        name: normalizeRelative(entry.name),
        date: new Date("1980-01-01T00:00:00Z"),
        mode: entry.mode || 0o600
      });
    }
    void archive.finalize();
  });
}

function writeArchive(outputPath, manifest, files) {
  return writeEntriesArchive(outputPath, [
    {
      name: "dorn-package.json",
      buffer: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      mode: 0o600
    },
    ...files.map((file) => ({
      name: `payload/${file.relativePath}`,
      absolutePath: file.absolutePath,
      mode: file.mode
    }))
  ]);
}

function readManifest(extractedRoot) {
  const manifestPath = path.join(extractedRoot, "dorn-package.json");
  if (!fs.existsSync(manifestPath)) {
    throw installerError("DORN-INSTALL-011", "El archivo no contiene un manifiesto DORN.");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== PACKAGE_SCHEMA || !Array.isArray(manifest.files)) {
    throw installerError("DORN-INSTALL-012", "El manifiesto del paquete no es compatible.");
  }
  normalizedProject(manifest);
  return manifest;
}

function validateExtracted(extractedRoot, manifest) {
  let totalBytes = 0;
  for (const file of manifest.files) {
    const relative = normalizeRelative(file.relativePath);
    const absolute = safeJoin(path.join(extractedRoot, "payload"), relative);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) throw installerError("DORN-INSTALL-013", `Falta el archivo ${relative}.`);
    totalBytes += stat.size;
    if (stat.size !== file.sizeBytes || sha256File(absolute) !== file.sha256) {
      throw installerError("DORN-INSTALL-014", `Falló la verificación de integridad de ${relative}.`);
    }
  }
  if (totalBytes > MAX_PACKAGE_BYTES) {
    throw installerError("DORN-INSTALL-015", "El contenido extraído supera el límite permitido.");
  }
}

function selectedComponents(manifest, options) {
  const required = manifest.components.filter((component) => component.required).map((component) => component.id);
  const profile = options.profileId
    ? manifest.profiles.find((entry) => entry.id === options.profileId)
    : null;
  if (options.profileId && !profile) {
    throw installerError("DORN-INSTALL-016", "El perfil de instalación no existe.");
  }
  const requested = profile
    ? profile.components
    : Array.isArray(options.components)
      ? options.components.map(String)
      : manifest.components.map((component) => component.id);
  const available = new Set(manifest.components.map((component) => component.id));
  if (requested.some((id) => !available.has(id))) {
    throw installerError("DORN-INSTALL-017", "Se solicitó un componente que no existe.");
  }
  return new Set([...required, ...requested]);
}

function pruneEmptyDirectories(directory, stopAt) {
  let current = directory;
  const root = path.resolve(stopAt);
  while (current.startsWith(`${root}${path.sep}`)) {
    try {
      if (fs.readdirSync(current).length) break;
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

class DornInstallerEngine {
  constructor(stateRoot, options = {}) {
    this.stateRoot = ensureDirectory(path.join(stateRoot, "installer"));
    this.registryRoot = ensureDirectory(path.join(this.stateRoot, "installations"));
    this.tempRoot = ensureDirectory(path.join(this.stateRoot, "temp"));
    this.audit = options.audit || (() => {});
  }

  projectTemplate() {
    return {
      schema: PACKAGE_SCHEMA,
      id: "com.dorn.producto",
      name: "Producto DORN",
      version: "1.0.0",
      publisher: "DORN",
      platform: "win32",
      architectures: ["x64"],
      requiredCoreVersion: "3.0.0",
      installationScope: "user",
      include: ["**"],
      exclude: [],
      components: [],
      profiles: [],
      dependencies: [],
      entryPoints: [],
      userData: []
    };
  }

  analyzeSource(sourceRoot, projectInput) {
    const project = normalizedProject(projectInput);
    const scanned = walkFiles(sourceRoot, project);
    const byExtension = {};
    for (const file of scanned.files) {
      const extension = path.extname(file.relativePath).toLowerCase() || "(sin extensión)";
      byExtension[extension] = (byExtension[extension] || 0) + file.sizeBytes;
    }
    return {
      product: { id: project.id, name: project.name, version: project.version },
      fileCount: scanned.files.length,
      totalBytes: scanned.totalBytes,
      byExtension,
      files: scanned.files.map(({ absolutePath, ...file }) => file)
    };
  }

  async build(sourceRoot, projectInput, outputPath, options = {}) {
    const project = normalizedProject(projectInput);
    const scanned = walkFiles(sourceRoot, project);
    const manifest = signManifest({
      ...project,
      createdAt: now(),
      files: scanned.files.map(({ absolutePath, ...file }) => file),
      totalBytes: scanned.totalBytes
    }, options.privateKey);
    await writeArchive(outputPath, manifest, scanned.files);
    const result = {
      packagePath: outputPath,
      packageSha256: sha256File(outputPath),
      packageBytes: fs.statSync(outputPath).size,
      manifest
    };
    this.audit(null, "installer.package-built", {
      id: manifest.id,
      version: manifest.version,
      files: manifest.files.length,
      packageSha256: result.packageSha256
    });
    return result;
  }

  async extractAndVerify(packagePath, options = {}) {
    const packageSize = fs.statSync(packagePath).size;
    if (packageSize > MAX_PACKAGE_BYTES) {
      throw installerError("DORN-INSTALL-018", "El paquete supera el tamaño permitido.");
    }
    const temporary = fs.mkdtempSync(path.join(this.tempRoot, "inspect-"));
    try {
      await extractZip(packagePath, { dir: temporary });
      const manifest = readManifest(temporary);
      validateExtracted(temporary, manifest);
      const signature = verifyManifestSignature(manifest, options.publicKey);
      if (signature.signed && signature.valid === false) {
        throw installerError("DORN-INSTALL-019", "La firma digital del paquete no es válida.");
      }
      return {
        temporary,
        manifest,
        signature,
        packageSha256: sha256File(packagePath)
      };
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  registryPath(productId) {
    return path.join(this.registryRoot, `${validateIdentifier(productId, "El producto")}.json`);
  }

  async inspectPackage(packagePath, options = {}) {
    const inspected = await this.extractAndVerify(packagePath, options);
    try {
      return {
        manifest: inspected.manifest,
        signature: inspected.signature,
        packageSha256: inspected.packageSha256
      };
    } finally {
      fs.rmSync(inspected.temporary, { recursive: true, force: true });
    }
  }

  async install(packagePath, destination, options = {}) {
    const inspected = await this.extractAndVerify(packagePath, options);
    const { manifest, temporary, packageSha256 } = inspected;
    const compatibility = this.checkCompatibility(manifest, options.environment);
    if (!compatibility.compatible && options.allowIncompatible !== true) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw installerError("DORN-INSTALL-039", "El paquete no es compatible con este sistema.", {
        detail: compatibility.problems.join(" ")
      });
    }
    const selected = selectedComponents(manifest, options);
    const root = path.resolve(destination);
    ensureDirectory(root);
    const transaction = fs.mkdtempSync(path.join(this.tempRoot, "transaction-"));
    const backups = [];
    const created = [];
    const installedFiles = [];
    try {
      for (const file of manifest.files) {
        if (file.components.length && !file.components.some((id) => selected.has(id))) continue;
        const source = safeJoin(path.join(temporary, "payload"), file.relativePath);
        const target = safeJoin(root, file.relativePath);
        ensureDirectory(path.dirname(target));
        if (fs.existsSync(target)) {
          const backup = safeJoin(path.join(transaction, "backup"), file.relativePath);
          ensureDirectory(path.dirname(backup));
          fs.copyFileSync(target, backup);
          backups.push({ target, backup });
        } else created.push(target);
        const staging = `${target}.${process.pid}.dorn-new`;
        fs.copyFileSync(source, staging);
        fs.chmodSync(staging, file.mode || 0o644);
        fs.renameSync(staging, target);
        installedFiles.push({
          relativePath: file.relativePath,
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
          components: file.components
        });
      }
      const registry = {
        schema: "dorn-installation/1",
        product: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          publisher: manifest.publisher
        },
        destination: root,
        packagePath: path.resolve(packagePath),
        packageSha256,
        components: Array.from(selected),
        installedAt: now(),
        files: installedFiles,
        userData: manifest.userData
      };
      atomicJson(this.registryPath(manifest.id), registry);
      this.audit(null, "installer.installed", {
        id: manifest.id,
        version: manifest.version,
        destination: root,
        files: installedFiles.length
      });
      return registry;
    } catch (error) {
      for (const target of created.reverse()) {
        try {
          fs.rmSync(target, { force: true });
          pruneEmptyDirectories(path.dirname(target), root);
        } catch {
        }
      }
      for (const item of backups.reverse()) {
        try {
          ensureDirectory(path.dirname(item.target));
          fs.copyFileSync(item.backup, item.target);
        } catch {
        }
      }
      throw installerError("DORN-INSTALL-020", "La instalación falló y se revirtieron los cambios.", {
        cause: error.message,
        retryable: true
      });
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
      fs.rmSync(transaction, { recursive: true, force: true });
    }
  }

  installation(productId) {
    const filePath = this.registryPath(productId);
    return fs.existsSync(filePath) ? readJson(filePath, null) : null;
  }

  checkCompatibility(manifest, environment = {}) {
    const platform = String(environment.platform || process.platform).toLowerCase();
    const architecture = String(environment.architecture || process.arch).toLowerCase();
    const coreVersion = String(environment.coreVersion || "3.0.0");
    const problems = [];
    if (manifest.platform && manifest.platform !== "any" && manifest.platform !== platform) {
      problems.push(`El paquete requiere ${manifest.platform}; este sistema es ${platform}.`);
    }
    if (Array.isArray(manifest.architectures) && manifest.architectures.length && !manifest.architectures.includes(architecture)) {
      problems.push(`El paquete no declara compatibilidad con ${architecture}.`);
    }
    if (manifest.requiredCoreVersion && compareVersions(coreVersion, manifest.requiredCoreVersion) < 0) {
      problems.push(`Se requiere DORN Core ${manifest.requiredCoreVersion} o superior.`);
    }
    return {
      compatible: problems.length === 0,
      platform,
      architecture,
      coreVersion,
      problems
    };
  }

  verifyInstallation(productId) {
    const registry = this.installation(productId);
    if (!registry) throw installerError("DORN-INSTALL-021", "El producto no está registrado como instalado.");
    const missing = [];
    const modified = [];
    for (const file of registry.files) {
      const target = safeJoin(registry.destination, file.relativePath);
      if (!fs.existsSync(target)) missing.push(file.relativePath);
      else if (sha256File(target) !== file.sha256) modified.push(file.relativePath);
    }
    return {
      product: registry.product,
      healthy: !missing.length && !modified.length,
      missing,
      modified,
      checkedAt: now()
    };
  }

  async repair(productId, options = {}) {
    const registry = this.installation(productId);
    if (!registry) throw installerError("DORN-INSTALL-022", "No existe un registro para reparar.");
    if (!fs.existsSync(registry.packagePath) || sha256File(registry.packagePath) !== registry.packageSha256) {
      throw installerError("DORN-INSTALL-023", "El paquete original no está disponible o cambió.");
    }
    return this.install(registry.packagePath, registry.destination, {
      ...options,
      components: registry.components
    });
  }

  uninstall(productId, options = {}) {
    const registry = this.installation(productId);
    if (!registry) throw installerError("DORN-INSTALL-024", "El producto no está registrado.");
    const removed = [];
    const preserved = [];
    for (const file of registry.files.slice().reverse()) {
      const target = safeJoin(registry.destination, file.relativePath);
      if (!fs.existsSync(target)) continue;
      if (!options.force && sha256File(target) !== file.sha256) {
        preserved.push(file.relativePath);
        continue;
      }
      fs.rmSync(target, { force: true });
      removed.push(file.relativePath);
      pruneEmptyDirectories(path.dirname(target), registry.destination);
    }
    if (options.removeUserData === true) {
      for (const relative of registry.userData || []) {
        const target = safeJoin(registry.destination, relative);
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
    fs.rmSync(this.registryPath(productId), { force: true });
    this.audit(null, "installer.uninstalled", {
      id: productId,
      removed: removed.length,
      preserved: preserved.length,
      userDataRemoved: options.removeUserData === true
    });
    return { productId, removed, preserved, userDataRemoved: options.removeUserData === true };
  }

  move(productId, newDestination) {
    const registry = this.installation(productId);
    if (!registry) throw installerError("DORN-INSTALL-034", "El producto no está registrado.");
    const health = this.verifyInstallation(productId);
    if (!health.healthy) {
      throw installerError("DORN-INSTALL-035", "Repara la instalación antes de moverla.", {
        detail: `Faltantes: ${health.missing.length}; modificados: ${health.modified.length}.`
      });
    }
    const sourceRoot = path.resolve(registry.destination);
    const destinationRoot = path.resolve(newDestination);
    if (sourceRoot === destinationRoot) return registry;
    if (destinationRoot.startsWith(`${sourceRoot}${path.sep}`) || sourceRoot.startsWith(`${destinationRoot}${path.sep}`)) {
      throw installerError("DORN-INSTALL-036", "La ubicación nueva no puede contener a la anterior ni estar dentro de ella.");
    }
    ensureDirectory(destinationRoot);
    const created = [];
    try {
      for (const file of registry.files) {
        const source = safeJoin(sourceRoot, file.relativePath);
        const destination = safeJoin(destinationRoot, file.relativePath);
        if (fs.existsSync(destination)) {
          throw installerError("DORN-INSTALL-037", `El destino ya contiene ${file.relativePath}.`);
        }
        ensureDirectory(path.dirname(destination));
        const temporary = `${destination}.${process.pid}.dorn-move`;
        fs.copyFileSync(source, temporary);
        if (sha256File(temporary) !== file.sha256) {
          fs.rmSync(temporary, { force: true });
          throw installerError("DORN-INSTALL-038", `Falló la verificación de ${file.relativePath}.`);
        }
        fs.renameSync(temporary, destination);
        created.push(destination);
      }
    } catch (error) {
      for (const destination of created.reverse()) {
        fs.rmSync(destination, { force: true });
        pruneEmptyDirectories(path.dirname(destination), destinationRoot);
      }
      throw error;
    }
    for (const file of registry.files.slice().reverse()) {
      const source = safeJoin(sourceRoot, file.relativePath);
      if (fs.existsSync(source) && sha256File(source) === file.sha256) fs.rmSync(source, { force: true });
      pruneEmptyDirectories(path.dirname(source), sourceRoot);
    }
    registry.destination = destinationRoot;
    registry.movedAt = now();
    atomicJson(this.registryPath(productId), registry);
    this.audit(null, "installer.moved", {
      id: productId,
      from: sourceRoot,
      to: destinationRoot,
      files: registry.files.length
    });
    return registry;
  }

  split(packagePath, outputDirectory, chunkSizeBytes = 512 * 1024 * 1024) {
    if (!Number.isSafeInteger(chunkSizeBytes) || chunkSizeBytes < 1024 * 1024) {
      throw installerError("DORN-INSTALL-025", "Cada fragmento debe medir al menos 1 MB.");
    }
    ensureDirectory(outputDirectory);
    const source = fs.openSync(packagePath, "r");
    const packageName = path.basename(packagePath);
    const stat = fs.statSync(packagePath);
    const count = Math.max(1, Math.ceil(stat.size / chunkSizeBytes));
    const digits = Math.max(3, String(count).length);
    const buffer = Buffer.allocUnsafe(Math.min(chunkSizeBytes, 8 * 1024 * 1024));
    const parts = [];
    try {
      let sourceOffset = 0;
      for (let index = 0; index < count; index += 1) {
        const partName = `${packageName}.${String(index + 1).padStart(digits, "0")}`;
        const partPath = path.join(outputDirectory, partName);
        const output = fs.openSync(partPath, "w", 0o600);
        const hash = crypto.createHash("sha256");
        let partSize = 0;
        try {
          const expected = Math.min(chunkSizeBytes, stat.size - sourceOffset);
          while (partSize < expected) {
            const length = Math.min(buffer.length, expected - partSize);
            const bytes = fs.readSync(source, buffer, 0, length, sourceOffset);
            if (!bytes) break;
            fs.writeSync(output, buffer, 0, bytes);
            hash.update(buffer.subarray(0, bytes));
            partSize += bytes;
            sourceOffset += bytes;
          }
        } finally {
          fs.closeSync(output);
        }
        parts.push({ index: index + 1, name: partName, sizeBytes: partSize, sha256: hash.digest("hex") });
      }
    } finally {
      fs.closeSync(source);
    }
    const manifest = {
      schema: MULTIPART_SCHEMA,
      packageName,
      packageSizeBytes: stat.size,
      packageSha256: sha256File(packagePath),
      chunkSizeBytes,
      parts
    };
    const manifestPath = path.join(outputDirectory, `${packageName}.parts.json`);
    atomicJson(manifestPath, manifest);
    return { manifestPath, ...manifest };
  }

  reconstruct(manifestPath, outputPath) {
    const manifest = readJson(manifestPath, null);
    if (!manifest || manifest.schema !== MULTIPART_SCHEMA || !Array.isArray(manifest.parts)) {
      throw installerError("DORN-INSTALL-026", "El manifiesto multipartes no es válido.");
    }
    const root = path.dirname(manifestPath);
    const temporary = `${outputPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    ensureDirectory(path.dirname(outputPath));
    const output = fs.openSync(temporary, "w", 0o600);
    const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
    try {
      for (let index = 0; index < manifest.parts.length; index += 1) {
        const part = manifest.parts[index];
        if (part.index !== index + 1) throw installerError("DORN-INSTALL-027", "Los fragmentos no están ordenados.");
        const partPath = safeJoin(root, part.name);
        if (!fs.existsSync(partPath) || fs.statSync(partPath).size !== part.sizeBytes || sha256File(partPath) !== part.sha256) {
          throw installerError("DORN-INSTALL-028", `El fragmento ${part.name} falta o está dañado.`);
        }
        const input = fs.openSync(partPath, "r");
        try {
          let bytes;
          do {
            bytes = fs.readSync(input, buffer, 0, buffer.length, null);
            if (bytes) fs.writeSync(output, buffer, 0, bytes);
          } while (bytes);
        } finally {
          fs.closeSync(input);
        }
      }
    } catch (error) {
      fs.closeSync(output);
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    fs.closeSync(output);
    if (fs.statSync(temporary).size !== manifest.packageSizeBytes || sha256File(temporary) !== manifest.packageSha256) {
      fs.rmSync(temporary, { force: true });
      throw installerError("DORN-INSTALL-029", "El paquete reconstruido no coincide con el original.");
    }
    fs.renameSync(temporary, outputPath);
    return { outputPath, packageSha256: manifest.packageSha256, parts: manifest.parts.length };
  }

  async downloadResumable(url, destination, options = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw installerError("DORN-INSTALL-030", "Las descargas de paquetes requieren HTTPS.");
    }
    const partial = `${destination}.part`;
    ensureDirectory(path.dirname(destination));
    const existing = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
    const response = await new Promise((resolve, reject) => {
      const request = https.get(parsed, {
        headers: existing ? { Range: `bytes=${existing}-` } : {},
        timeout: options.timeoutMs || 30000
      }, resolve);
      request.on("timeout", () => request.destroy(new Error("Tiempo de descarga agotado.")));
      request.on("error", reject);
    });
    if (![200, 206].includes(response.statusCode)) {
      response.resume();
      throw installerError("DORN-INSTALL-031", `El servidor respondió ${response.statusCode}.`, { retryable: true });
    }
    const append = response.statusCode === 206 && existing > 0;
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(partial, { flags: append ? "a" : "w", mode: 0o600 });
      response.pipe(output);
      response.on("error", reject);
      output.on("error", reject);
      output.on("finish", resolve);
    });
    if (options.expectedSha256 && sha256File(partial) !== options.expectedSha256) {
      throw installerError("DORN-INSTALL-032", "La descarga terminó, pero su integridad no coincide.", { retryable: true });
    }
    fs.renameSync(partial, destination);
    return { destination, sizeBytes: fs.statSync(destination).size, sha256: sha256File(destination) };
  }

  compare(leftManifest, rightManifest) {
    const left = new Map(leftManifest.files.map((file) => [file.relativePath, file]));
    const right = new Map(rightManifest.files.map((file) => [file.relativePath, file]));
    const added = [];
    const removed = [];
    const changed = [];
    const unchanged = [];
    for (const [relative, file] of right) {
      if (!left.has(relative)) added.push(relative);
      else if (left.get(relative).sha256 !== file.sha256) changed.push(relative);
      else unchanged.push(relative);
    }
    for (const relative of left.keys()) if (!right.has(relative)) removed.push(relative);
    return { added, removed, changed, unchanged };
  }

  async createPatch(basePackagePath, targetPackagePath, outputPath) {
    const base = await this.extractAndVerify(basePackagePath);
    const target = await this.extractAndVerify(targetPackagePath);
    try {
      if (base.manifest.id !== target.manifest.id) {
        throw installerError("DORN-INSTALL-040", "Un parche sólo puede relacionar versiones del mismo producto.");
      }
      if (compareVersions(base.manifest.version, target.manifest.version) >= 0) {
        throw installerError("DORN-INSTALL-041", "La versión de destino del parche debe ser posterior a la versión base.");
      }
      const changes = this.compare(base.manifest, target.manifest);
      const included = new Set([...changes.added, ...changes.changed]);
      const patchFiles = target.manifest.files
        .filter((file) => included.has(file.relativePath))
        .map((file) => ({
          ...file,
          absolutePath: safeJoin(path.join(target.temporary, "payload"), file.relativePath)
        }));
      const manifest = {
        schema: PATCH_SCHEMA,
        productId: target.manifest.id,
        fromVersion: base.manifest.version,
        toVersion: target.manifest.version,
        createdAt: now(),
        basePackageSha256: base.packageSha256,
        targetPackageSha256: target.packageSha256,
        changes,
        targetManifest: target.manifest
      };
      await writeEntriesArchive(outputPath, [
        {
          name: "dorn-patch.json",
          buffer: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
          mode: 0o600
        },
        ...patchFiles.map((file) => ({
          name: `payload/${file.relativePath}`,
          absolutePath: file.absolutePath,
          mode: file.mode
        }))
      ]);
      const result = {
        patchPath: path.resolve(outputPath),
        patchSha256: sha256File(outputPath),
        patchBytes: fs.statSync(outputPath).size,
        manifest
      };
      this.audit(null, "installer.patch-built", {
        id: manifest.productId,
        fromVersion: manifest.fromVersion,
        toVersion: manifest.toVersion,
        files: patchFiles.length
      });
      return result;
    } finally {
      fs.rmSync(base.temporary, { recursive: true, force: true });
      fs.rmSync(target.temporary, { recursive: true, force: true });
    }
  }

  async inspectPatch(patchPath) {
    const temporary = fs.mkdtempSync(path.join(this.tempRoot, "patch-inspect-"));
    try {
      await extractZip(patchPath, { dir: temporary });
      const manifestPath = path.join(temporary, "dorn-patch.json");
      if (!fs.existsSync(manifestPath)) {
        throw installerError("DORN-INSTALL-042", "El archivo no contiene un manifiesto de parche DORN.");
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.schema !== PATCH_SCHEMA || !manifest.targetManifest || !manifest.changes) {
        throw installerError("DORN-INSTALL-043", "El parche DORN no es compatible.");
      }
      normalizedProject(manifest.targetManifest);
      const included = new Set([...manifest.changes.added, ...manifest.changes.changed]);
      for (const file of manifest.targetManifest.files.filter((entry) => included.has(entry.relativePath))) {
        const payload = safeJoin(path.join(temporary, "payload"), file.relativePath);
        if (!fs.existsSync(payload) || fs.statSync(payload).size !== file.sizeBytes || sha256File(payload) !== file.sha256) {
          throw installerError("DORN-INSTALL-044", `El archivo ${file.relativePath} del parche falta o está dañado.`);
        }
      }
      return {
        manifest,
        patchSha256: sha256File(patchPath),
        patchBytes: fs.statSync(patchPath).size
      };
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  async applyPatch(basePackagePath, patchPath, outputPath) {
    const base = await this.extractAndVerify(basePackagePath);
    const patchRoot = fs.mkdtempSync(path.join(this.tempRoot, "patch-apply-"));
    try {
      await extractZip(patchPath, { dir: patchRoot });
      const manifestPath = path.join(patchRoot, "dorn-patch.json");
      if (!fs.existsSync(manifestPath)) {
        throw installerError("DORN-INSTALL-042", "El archivo no contiene un manifiesto de parche DORN.");
      }
      const patch = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (patch.schema !== PATCH_SCHEMA || patch.basePackageSha256 !== base.packageSha256) {
        throw installerError("DORN-INSTALL-045", "El parche no corresponde exactamente al paquete base seleccionado.");
      }
      if (patch.productId !== base.manifest.id || patch.fromVersion !== base.manifest.version) {
        throw installerError("DORN-INSTALL-046", "El producto o la versión base del parche no coincide.");
      }
      const targetManifest = patch.targetManifest;
      normalizedProject(targetManifest);
      const changed = new Set([...(patch.changes?.added || []), ...(patch.changes?.changed || [])]);
      const entries = [{
        name: "dorn-package.json",
        buffer: Buffer.from(JSON.stringify(targetManifest, null, 2), "utf8"),
        mode: 0o600
      }];
      for (const file of targetManifest.files) {
        const sourceRoot = changed.has(file.relativePath)
          ? path.join(patchRoot, "payload")
          : path.join(base.temporary, "payload");
        const absolutePath = safeJoin(sourceRoot, file.relativePath);
        if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size !== file.sizeBytes || sha256File(absolutePath) !== file.sha256) {
          throw installerError("DORN-INSTALL-047", `No se pudo reconstruir ${file.relativePath} desde el parche.`);
        }
        entries.push({ name: `payload/${file.relativePath}`, absolutePath, mode: file.mode });
      }
      await writeEntriesArchive(outputPath, entries);
      const rebuiltHash = sha256File(outputPath);
      if (rebuiltHash !== patch.targetPackageSha256) {
        fs.rmSync(outputPath, { force: true });
        throw installerError("DORN-INSTALL-048", "El paquete reconstruido no coincide con la versión objetivo.");
      }
      return {
        outputPath: path.resolve(outputPath),
        productId: patch.productId,
        version: patch.toVersion,
        packageSha256: rebuiltHash,
        files: targetManifest.files.length
      };
    } finally {
      fs.rmSync(base.temporary, { recursive: true, force: true });
      fs.rmSync(patchRoot, { recursive: true, force: true });
    }
  }

  async createBundle(packagePaths, outputPath, metadata = {}) {
    if (!Array.isArray(packagePaths) || packagePaths.length < 2) {
      throw installerError("DORN-INSTALL-049", "Un DORN Bundle necesita al menos dos paquetes.");
    }
    const packages = [];
    const productIds = new Set();
    for (const packagePath of packagePaths) {
      const inspected = await this.inspectPackage(packagePath);
      if (productIds.has(inspected.manifest.id)) {
        throw installerError("DORN-INSTALL-050", `El Bundle repite el producto ${inspected.manifest.id}.`);
      }
      productIds.add(inspected.manifest.id);
      packages.push({
        fileName: `${inspected.manifest.id}-${inspected.manifest.version}.dornpkg`,
        absolutePath: path.resolve(packagePath),
        productId: inspected.manifest.id,
        name: inspected.manifest.name,
        version: inspected.manifest.version,
        sizeBytes: fs.statSync(packagePath).size,
        sha256: inspected.packageSha256
      });
    }
    const manifest = {
      schema: BUNDLE_SCHEMA,
      id: validateIdentifier(metadata.id || `dorn.bundle.${Date.now()}`, "El Bundle"),
      name: String(metadata.name || "DORN Bundle").slice(0, 160),
      version: validateVersion(metadata.version || "1.0.0"),
      createdAt: now(),
      packages: packages.map(({ absolutePath, ...entry }) => entry)
    };
    await writeEntriesArchive(outputPath, [
      {
        name: "dorn-bundle.json",
        buffer: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
        mode: 0o600
      },
      ...packages.map((entry) => ({
        name: `packages/${entry.fileName}`,
        absolutePath: entry.absolutePath,
        mode: 0o600
      }))
    ]);
    return {
      bundlePath: path.resolve(outputPath),
      bundleSha256: sha256File(outputPath),
      bundleBytes: fs.statSync(outputPath).size,
      manifest
    };
  }

  async extractBundle(bundlePath, destination) {
    const temporary = fs.mkdtempSync(path.join(this.tempRoot, "bundle-"));
    try {
      await extractZip(bundlePath, { dir: temporary });
      const manifestPath = path.join(temporary, "dorn-bundle.json");
      if (!fs.existsSync(manifestPath)) {
        throw installerError("DORN-INSTALL-051", "El archivo no contiene un manifiesto DORN Bundle.");
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.schema !== BUNDLE_SCHEMA || !Array.isArray(manifest.packages)) {
        throw installerError("DORN-INSTALL-052", "El DORN Bundle no es compatible.");
      }
      ensureDirectory(destination);
      const extracted = [];
      for (const entry of manifest.packages) {
        const source = safeJoin(path.join(temporary, "packages"), entry.fileName);
        if (!fs.existsSync(source) || fs.statSync(source).size !== entry.sizeBytes || sha256File(source) !== entry.sha256) {
          throw installerError("DORN-INSTALL-053", `El paquete ${entry.fileName} falta o está dañado.`);
        }
        const target = safeJoin(destination, entry.fileName);
        if (fs.existsSync(target)) throw installerError("DORN-INSTALL-054", `El destino ya contiene ${entry.fileName}.`);
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        extracted.push({ ...entry, path: target });
      }
      return { manifest, extracted };
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  analyzeDeduplication(manifests) {
    const hashes = new Map();
    let totalBytes = 0;
    for (const manifest of manifests) {
      for (const file of manifest.files) {
        totalBytes += file.sizeBytes;
        const record = hashes.get(file.sha256) || { sizeBytes: file.sizeBytes, occurrences: 0, files: [] };
        record.occurrences += 1;
        record.files.push(`${manifest.id}:${file.relativePath}`);
        hashes.set(file.sha256, record);
      }
    }
    const duplicates = Array.from(hashes.entries())
      .filter(([, record]) => record.occurrences > 1)
      .map(([sha256, record]) => ({
        sha256,
        ...record,
        reclaimableBytes: record.sizeBytes * (record.occurrences - 1)
      }))
      .sort((left, right) => right.reclaimableBytes - left.reclaimableBytes);
    return {
      totalBytes,
      uniqueBytes: Array.from(hashes.values()).reduce((sum, record) => sum + record.sizeBytes, 0),
      reclaimableBytes: duplicates.reduce((sum, record) => sum + record.reclaimableBytes, 0),
      duplicates
    };
  }

  cleanupTemporary(maxAgeHours = 24) {
    const threshold = Date.now() - Math.max(1, maxAgeHours) * 60 * 60 * 1000;
    const removed = [];
    for (const entry of fs.readdirSync(this.tempRoot, { withFileTypes: true })) {
      const target = path.join(this.tempRoot, entry.name);
      if (fs.statSync(target).mtimeMs < threshold) {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(entry.name);
      }
    }
    return { removed, checkedAt: now() };
  }
}

module.exports = {
  PACKAGE_SCHEMA,
  MULTIPART_SCHEMA,
  PATCH_SCHEMA,
  BUNDLE_SCHEMA,
  DornInstallerEngine,
  normalizedProject,
  globExpression,
  compareVersions,
  signManifest,
  verifyManifestSignature
};
