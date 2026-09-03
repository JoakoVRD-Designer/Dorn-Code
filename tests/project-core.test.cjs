"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ProjectCore, PROJECT_DIRECTORIES } = require("../out/main/dorn-core/project-core");

const sourceRoot = path.resolve(__dirname, "..");
const readSource = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");
const digest = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

function temporary(context, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("Project Core sondea una carpeta sin escribir y sólo la adopta de forma explícita", (context) => {
  const root = temporary(context, "dorn-project-probe-");
  fs.writeFileSync(path.join(root, "README.md"), "proyecto existente\n");
  const projects = new ProjectCore();
  const before = fs.readdirSync(root);
  const probe = projects.probe(root);
  assert.equal(probe.status, "UNMANAGED");
  assert.deepEqual(fs.readdirSync(root), before);
  assert.equal(fs.existsSync(path.join(root, ".dorn")), false);

  const opened = projects.adopt(root, { projectId: "project_4_0", name: "Proyecto 4.0" });
  assert.equal(opened.projectId, "project_4_0");
  assert.equal(opened.trustState, "UNTRUSTED");
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), "proyecto existente\n");
  for (const directory of PROJECT_DIRECTORIES) assert.equal(fs.statSync(path.join(root, ".dorn", directory)).isDirectory(), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".dorn", "project.json"), "utf8"));
  assert.equal(manifest.schema, "dorn.project/1");
  assert.equal(manifest.projectId, "project_4_0");
});

test("Project Core no sobrescribe una identidad distinta ni metadatos dañados", (context) => {
  const conflictRoot = temporary(context, "dorn-project-conflict-");
  const projects = new ProjectCore();
  projects.adopt(conflictRoot, { projectId: "identity_a" });
  const manifestPath = path.join(conflictRoot, ".dorn", "project.json");
  const beforeHash = digest(manifestPath);
  assert.throws(
    () => projects.adopt(conflictRoot, { projectId: "identity_b" }),
    (error) => error.code === "PROJECT_IDENTITY_CONFLICT"
  );
  assert.equal(digest(manifestPath), beforeHash);

  const damagedRoot = temporary(context, "dorn-project-damaged-");
  fs.mkdirSync(path.join(damagedRoot, ".dorn"));
  fs.writeFileSync(path.join(damagedRoot, ".dorn", "project.json"), "{NO ES JSON");
  const damagedPath = path.join(damagedRoot, ".dorn", "project.json");
  const damagedHash = digest(damagedPath);
  assert.throws(
    () => projects.adopt(damagedRoot, { projectId: "safe_identity" }),
    (error) => error.code === "PROJECT_METADATA_INVALID"
  );
  assert.equal(digest(damagedPath), damagedHash);
});

test("Project Core rechaza .dorn y subdirectorios enlazados fuera del proyecto", { skip: process.platform === "win32" }, (context) => {
  const root = temporary(context, "dorn-project-link-");
  const outside = temporary(context, "dorn-project-outside-");
  fs.symlinkSync(outside, path.join(root, ".dorn"), "dir");
  const projects = new ProjectCore();
  assert.throws(() => projects.adopt(root, { projectId: "linked" }), (error) => error.code === "PROJECT_METADATA_UNSAFE");
  assert.deepEqual(fs.readdirSync(outside), []);

  fs.unlinkSync(path.join(root, ".dorn"));
  fs.mkdirSync(path.join(root, ".dorn"));
  fs.symlinkSync(outside, path.join(root, ".dorn", "evidence"), "dir");
  assert.throws(() => projects.adopt(root, { projectId: "linked_child" }), (error) => error.code === "PROJECT_METADATA_UNSAFE");
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("la inspección es estática, acotada y no ejecuta scripts ni persiste sin autorización", (context) => {
  const root = temporary(context, "dorn-project-inspect-");
  const executed = path.join(root, "NO-DEBE-EXISTIR");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: `node -e \\"require('fs').writeFileSync('${executed}', 'x')\\"` } }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const ready = true;\n");
  const projects = new ProjectCore();
  const capsule = projects.inspect(root, { maxFiles: 100, timeBudgetMs: 1000 });
  assert.equal(capsule.staticOnly, true);
  assert.deepEqual(capsule.packageScripts, ["test"]);
  assert.equal(capsule.languages.some((entry) => entry.name === "TypeScript"), true);
  assert.equal(fs.existsSync(executed), false);
  assert.equal(fs.existsSync(path.join(root, ".dorn")), false);
  projects.adopt(root, { projectId: "inspected" });
  projects.inspect(root, { persist: true });
  assert.equal(fs.existsSync(path.join(root, ".dorn", "manifests", "environment-capsule.json")), true);
});

test("la integración reconcilia la identidad antes de registrar o cargar un proyecto y conserva la UI 4.0", () => {
  const main = readSource("out/main/index.js");
  const preload = readSource("out/preload/index.js");
  assert.match(main, /const \{ ProjectCore \} = require\("\.\/dorn-core\/project-core"\)/);
  assert.match(main, /const probe = projectCore\.probe\(root\)/);
  assert.match(main, /projectCore\.adopt\(root, \{ projectId: finalProjectId, name: finalName \}\)/);
  assert.match(main, /database\.createProject\(finalName, kind, root, database\.getSettings\(\)\.permissionMode, finalProjectId\)/);
  assert.match(main, /load: async \(\{ projectId, generation \}\)/);
  assert.match(main, /projectCore\.adopt\(project\.rootPath, \{ projectId: project\.id, name: project\.name \}\)/);
  assert.match(main, /eventBus\.register\("PROJECT_OPENED"/);
  assert.match(preload, /metadata: \(id\) => electron\.ipcRenderer\.invoke\("dorn:project_metadata", id\)/);
  assert.match(preload, /inspect: \(id, options = \{\}\) => electron\.ipcRenderer\.invoke\("dorn:project_inspect", id, options\)/);
  assert.doesNotMatch(main, /PRE-IDE.*renderer|renderer.*4\.9/i);
});
