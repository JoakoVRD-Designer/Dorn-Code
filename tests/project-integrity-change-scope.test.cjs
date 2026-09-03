"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { ProjectIntegrityEngine } = require("../out/main/dorn-core/project-integrity");
const { ProjectWatcher } = require("../out/main/dorn-core/project-watcher");
const sourceRoot = path.resolve(__dirname, "..");

function temporary(context, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function adopted(context, id = "project_a") {
  const root = temporary(context, `dorn-${id}-`);
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id });
  return { root, projectCore, project: { id, name: id, rootPath: root } };
}

test("Project Integrity escanea por páginas y calcula impacto transitivo sin ejecutar el proyecto", (context) => {
  const { root, projectCore, project } = adopted(context, "integrity_a");
  fs.mkdirSync(path.join(root, "src", "ui"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(root, "src", "shared.js"), "export const shared = true;\n");
  fs.writeFileSync(path.join(root, "src", "feature.js"), "import { shared } from './shared.js'; export { shared };\n");
  fs.writeFileSync(path.join(root, "src", "ui", "view.js"), "import { shared } from '../feature.js'; export const view = shared;\n");
  fs.writeFileSync(path.join(root, "tests", "view.test.js"), "import { view } from '../src/ui/view.js'; void view;\n");
  const engine = new ProjectIntegrityEngine({ projectCore });
  context.after(() => engine.closeAll());
  let status = engine.start(project);
  let pages = 0;
  while (status.nextCursor && pages < 100) {
    status = engine.scanPage(project, { scanId: status.nextCursor, fileBudget: 1, timeBudgetMs: 2000 });
    assert.ok(status.page.files <= 1);
    pages += 1;
  }
  assert.equal(status.state, "COMPLETED");
  assert.equal(status.files, 5);
  assert.ok(pages >= 5);
  const impact = engine.impact(project, { changedPaths: ["src/shared.js"] });
  assert.equal(impact.state, "ANALYZED");
  assert.ok(impact.affectedPaths.includes("src/feature.js"));
  assert.ok(impact.affectedPaths.includes("src/ui/view.js"));
  assert.ok(impact.tests.includes("tests/view.test.js"));
  assert.equal(impact.verificationPlan.find((gate) => gate.gate === "TARGETED_TESTS").state, "REQUIRED");
  assert.equal(fs.existsSync(path.join(root, "NO-DEBE-EJECUTARSE")), false);
});

test("Project Integrity aísla cursores, identidad y metadatos enlazados", { skip: process.platform === "win32" }, (context) => {
  const a = adopted(context, "integrity_a2");
  const b = adopted(context, "integrity_b2");
  fs.writeFileSync(path.join(a.root, "a.js"), "a\n");
  const engine = new ProjectIntegrityEngine({ projectCore: a.projectCore });
  context.after(() => engine.closeAll());
  const started = engine.start(a.project);
  assert.throws(() => engine.scanPage(b.project, { scanId: started.scanId }), (error) => error.code === "INTEGRITY_PROJECT_MISMATCH");
  assert.throws(() => engine.scanStatus({ ...a.project, id: "different_id" }), (error) => error.code === "INTEGRITY_PROJECT_IDENTITY_MISMATCH");
  engine.closeAll();

  const linked = adopted(context, "integrity_linked");
  const outside = temporary(context, "dorn-integrity-outside-");
  fs.rmSync(path.join(linked.root, ".dorn", "manifests"), { recursive: true });
  fs.symlinkSync(outside, path.join(linked.root, ".dorn", "manifests"), "dir");
  const unsafe = new ProjectIntegrityEngine();
  assert.throws(() => unsafe.scanStatus(linked.project), (error) => error.code === "INTEGRITY_METADATA_UNSAFE");
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("Change Scope detecta cambios anidados no declarados incluso sin watcher recursivo", async (context) => {
  const { root, projectCore, project } = adopted(context, "scope_nested");
  fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "declared.js"), "base\n");
  fs.writeFileSync(path.join(root, "src", "nested", "other.js"), "base\n");
  const watcher = new ProjectWatcher({ projectCore });
  context.after(() => watcher.closeAll());
  const scope = watcher.begin(project, { workUnitId: "wu-nested", expectedPaths: ["src/declared.js"], coverage: { forceFallback: true } });
  assert.equal(watcher.prepare(scope.scopeId, ["src/declared.js"]).state, "READY_TO_INTEGRATE");
  fs.writeFileSync(path.join(root, "src", "declared.js"), "integrado\n");
  fs.writeFileSync(path.join(root, "src", "nested", "other.js"), "no declarado\n");
  const finished = await watcher.finish(scope.scopeId);
  assert.equal(finished.state, "REVIEW_REQUIRED");
  assert.ok(finished.undeclared.some((entry) => entry.relativePath === "src/nested/other.js"));
});

test("Change Scope restaura bytes originales, elimina archivos nuevos y bloquea snapshots enlazados", { skip: process.platform === "win32" }, (context) => {
  const { root, projectCore, project } = adopted(context, "scope_rollback");
  fs.writeFileSync(path.join(root, "existing.txt"), "original\n");
  const watcher = new ProjectWatcher({ projectCore });
  context.after(() => watcher.closeAll());
  const scope = watcher.begin(project, { workUnitId: "wu-rollback", expectedPaths: ["existing.txt", "new.txt"] });
  watcher.prepare(scope.scopeId, ["existing.txt", "new.txt"]);
  fs.writeFileSync(path.join(root, "existing.txt"), "changed\n");
  fs.writeFileSync(path.join(root, "new.txt"), "new\n");
  const rolledBack = watcher.rollback(scope.scopeId);
  assert.equal(rolledBack.state, "ROLLED_BACK");
  assert.equal(fs.readFileSync(path.join(root, "existing.txt"), "utf8"), "original\n");
  assert.equal(fs.existsSync(path.join(root, "new.txt")), false);

  const poisoned = watcher.begin(project, { workUnitId: "wu-poison", expectedPaths: ["existing.txt"] });
  const snapshotFile = path.join(root, ".dorn", "snapshots", `change-scope-${poisoned.scopeId}`, "existing.txt");
  const outside = path.join(temporary(context, "dorn-snapshot-outside-"), "outside.txt");
  fs.writeFileSync(outside, "original\n");
  fs.unlinkSync(snapshotFile);
  fs.symlinkSync(outside, snapshotFile);
  fs.writeFileSync(path.join(root, "existing.txt"), "changed twice\n");
  assert.throws(() => watcher.rollback(poisoned.scopeId), /Snapshot dañado/);
  assert.equal(fs.readFileSync(outside, "utf8"), "original\n");
});

test("Change Scope rechaza rutas absolutas, puntos ambiguos y solapamiento paralelo", (context) => {
  const { root, projectCore, project } = adopted(context, "scope_paths");
  fs.writeFileSync(path.join(root, "file.js"), "base\n");
  const watcher = new ProjectWatcher({ projectCore });
  context.after(() => watcher.closeAll());
  assert.throws(() => watcher.begin(project, { expectedPaths: [path.join(root, "file.js")] }), /absoluta/);
  assert.throws(() => watcher.begin(project, { expectedPaths: ["src/./file.js"] }), /insegura/);
  const a = watcher.begin(project, { workUnitId: "wu-a", expectedPaths: ["file.js"] });
  const b = watcher.begin(project, { workUnitId: "wu-b", expectedPaths: ["file.js"] });
  assert.equal(watcher.prepare(a.scopeId, ["file.js"]).state, "READY_TO_INTEGRATE");
  const conflict = watcher.prepare(b.scopeId, ["file.js"]);
  assert.equal(conflict.state, "REVIEW_REQUIRED");
  assert.equal(conflict.conflicts[0].reason, "PARALLEL_WORK_UNIT_OVERLAP");
});

test("la aplicación conecta watcher e integridad por Event Bus sin sustituir el renderer 4.0", () => {
  const main = fs.readFileSync(path.join(sourceRoot, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(sourceRoot, "out", "preload", "index.js"), "utf8");
  assert.match(main, /new ProjectIntegrityEngine\(\{ projectCore, eventBus \}\)/);
  assert.match(main, /new ProjectWatcher\(\{ projectCore, eventBus \}\)/);
  assert.match(main, /eventBus\.subscribe\("FILE_MODIFIED", "project-integrity-invalidator"/);
  assert.match(main, /projectWatcher\.watch\(project\)/);
  assert.match(main, /projectWatcher\?\.closeAll\(\)/);
  assert.match(main, /projectIntegrity\?\.closeAll\(\)/);
  assert.match(preload, /integrityScan: \(id, options = \{\}\)/);
  assert.match(preload, /impact: \(id, input\)/);
  assert.doesNotMatch(main, /PRE-IDE.*renderer|renderer.*4\.9/i);
});
