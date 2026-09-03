"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { WorktreeManager, fingerprint } = require("../out/main/dorn-core/worktree-manager");

function fixture(context, id = "worktree_project", options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-${id}-`));
  const isolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-${id}-isolated-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  context.after(() => fs.rmSync(isolationRoot, { recursive: true, force: true }));
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const manager = new WorktreeManager({ projectCore, isolationRoot, maxFiles: options.maxFiles || 1000, maxBytes: options.maxBytes || 64 * 1024 * 1024 });
  return { root, isolationRoot, projectCore, project, manager };
}

function modify(unit, relativePath, content) {
  const target = path.join(unit.executionRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function recordPass(manager, project, unit, command = ["node", "--test"]) {
  return manager.recordTest(project, unit.workUnitId, { passed: true, independent: true, exitCode: 0, command });
}

test("el sandbox integra únicamente bytes probados y conserva rollback exacto", (context) => {
  const { root, project, manager } = fixture(context, "worktree_integrate");
  fs.writeFileSync(path.join(root, "feature.js"), "before\n");
  const before = fingerprint(root, ["feature.js"]);
  const unit = manager.create(project, { workUnitId: "unit_integrate", expectedFiles: ["feature.js"] });
  assert.equal(unit.isolationMode, "BOUNDED_COPY_SANDBOX");
  modify(unit, "feature.js", "after\n");
  assert.equal(recordPass(manager, project, unit).state, "TESTED");
  assert.equal(manager.prepareIntegration(project, unit.workUnitId).state, "READY_TO_INTEGRATE");
  const integrated = manager.integrate(project, unit.workUnitId);
  assert.equal(integrated.state, "INTEGRATED");
  assert.equal(fs.readFileSync(path.join(root, "feature.js"), "utf8"), "after\n");
  const rolledBack = manager.rollback(project, unit.workUnitId);
  assert.equal(rolledBack.state, "ROLLED_BACK");
  assert.equal(fingerprint(root, ["feature.js"]).treeHash, before.treeHash);
  assert.equal(manager.dispose(project, unit.workUnitId).executionRootAvailable, false);
});

test("un archivo no declarado impide preparar e integrar aunque el test diga passed", (context) => {
  const { root, project, manager } = fixture(context, "worktree_undeclared");
  fs.writeFileSync(path.join(root, "feature.js"), "before\n");
  const unit = manager.create(project, { workUnitId: "unit_undeclared", expectedFiles: ["feature.js"] });
  modify(unit, "feature.js", "after\n");
  modify(unit, "hidden.js", "unexpected\n");
  const tested = recordPass(manager, project, unit);
  assert.equal(tested.state, "REWORK_REQUIRED");
  assert.deepEqual(tested.test.undeclared, ["hidden.js"]);
  assert.equal(manager.prepareIntegration(project, unit.workUnitId).state, "REWORK_REQUIRED");
  assert.throws(() => manager.integrate(project, unit.workUnitId), (error) => error.code === "WORKTREE_NOT_READY");
  assert.equal(fs.readFileSync(path.join(root, "feature.js"), "utf8"), "before\n");
  manager.dispose(project, unit.workUnitId);
});

test("mutar el aislamiento después de probar exige retest", (context) => {
  const { root, project, manager } = fixture(context, "worktree_after_test");
  fs.writeFileSync(path.join(root, "feature.js"), "before\n");
  const unit = manager.create(project, { workUnitId: "unit_after_test", expectedFiles: ["feature.js"] });
  modify(unit, "feature.js", "tested\n");
  recordPass(manager, project, unit);
  modify(unit, "feature.js", "changed-after-test\n");
  const prepared = manager.prepareIntegration(project, unit.workUnitId);
  assert.equal(prepared.state, "REWORK_REQUIRED");
  assert.equal(prepared.integration.bytesUnchangedSinceTest, false);
  assert.equal(fs.readFileSync(path.join(root, "feature.js"), "utf8"), "before\n");
  manager.dispose(project, unit.workUnitId);
});

test("cambiar el proyecto principal durante el aislamiento bloquea bytes obsoletos", (context) => {
  const { root, project, manager } = fixture(context, "worktree_main_changed");
  fs.writeFileSync(path.join(root, "feature.js"), "before\n");
  const unit = manager.create(project, { workUnitId: "unit_main_changed", expectedFiles: ["feature.js"] });
  modify(unit, "feature.js", "isolated\n");
  recordPass(manager, project, unit);
  fs.writeFileSync(path.join(root, "feature.js"), "human-change\n");
  const prepared = manager.prepareIntegration(project, unit.workUnitId);
  assert.equal(prepared.state, "REWORK_REQUIRED");
  assert.equal(prepared.integration.mainUnchanged, false);
  assert.equal(fs.readFileSync(path.join(root, "feature.js"), "utf8"), "human-change\n");
  manager.dispose(project, unit.workUnitId);
});

test("una falla después del primer archivo restaura todo el proyecto sin integración parcial", (context) => {
  const { root, project, manager } = fixture(context, "worktree_atomic_rollback");
  const unit = manager.create(project, {
    workUnitId: "unit_atomic_rollback",
    expectedFiles: ["a.js", "nested/b.js"]
  });
  modify(unit, "a.js", "created-a\n");
  modify(unit, "nested/b.js", "created-b\n");
  recordPass(manager, project, unit);
  fs.writeFileSync(path.join(root, "nested"), "path-conflict\n");
  assert.throws(() => manager.integrate(project, unit.workUnitId));
  assert.equal(fs.existsSync(path.join(root, "a.js")), false);
  assert.equal(fs.readFileSync(path.join(root, "nested"), "utf8"), "path-conflict\n");
  assert.equal(manager.get(project, unit.workUnitId).state, "BLOCKED");
  manager.dispose(project, unit.workUnitId);
});

test("un Git real usa worktree separado y conserva cambios locales de la fuente", { skip: !childProcess.spawnSync("git", ["--version"]).stdout }, (context) => {
  const { root, project, manager } = fixture(context, "worktree_git");
  fs.writeFileSync(path.join(root, "feature.js"), "committed\n");
  childProcess.execFileSync("git", ["-C", root, "init", "-q"]);
  childProcess.execFileSync("git", ["-C", root, "add", "feature.js"]);
  childProcess.execFileSync("git", ["-C", root, "-c", "user.name=DORN Test", "-c", "user.email=dorn@example.invalid", "commit", "-qm", "baseline"]);
  fs.writeFileSync(path.join(root, "feature.js"), "dirty-source\n");
  const unit = manager.create(project, { workUnitId: "unit_git", expectedFiles: ["feature.js"] });
  assert.equal(unit.isolationMode, "GIT_WORKTREE");
  assert.equal(fs.readFileSync(path.join(unit.executionRoot, "feature.js"), "utf8"), "dirty-source\n");
  modify(unit, "feature.js", "isolated-change\n");
  recordPass(manager, project, unit);
  assert.equal(manager.integrate(project, unit.workUnitId).state, "INTEGRATED");
  assert.equal(fs.readFileSync(path.join(root, "feature.js"), "utf8"), "isolated-change\n");
  manager.dispose(project, unit.workUnitId);
});

test("enlaces simbólicos y rutas reservadas no entran al sandbox", { skip: process.platform === "win32" }, (context) => {
  const { root, project, manager } = fixture(context, "worktree_symlink");
  const outside = path.join(os.tmpdir(), `dorn-outside-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(outside, "outside\n");
  context.after(() => fs.rmSync(outside, { force: true }));
  fs.symlinkSync(outside, path.join(root, "linked.txt"));
  assert.throws(
    () => manager.create(project, { workUnitId: "unit_link", expectedFiles: ["linked.txt"] }),
    (error) => error.code === "WORKTREE_ENTRY_UNSAFE"
  );
  assert.throws(
    () => manager.create(project, { workUnitId: "unit_reserved", expectedFiles: [".dorn/project.json"] }),
    (error) => error.code === "WORKTREE_PATH_UNSAFE"
  );
});

test("un registro corrupto se rechaza sin sobrescribirlo", (context) => {
  const { root, project, manager } = fixture(context, "worktree_corrupt");
  const statePath = path.join(root, ".dorn", "tasks", "worktrees.json");
  fs.writeFileSync(statePath, "{not-json");
  const before = crypto.createHash("sha256").update(fs.readFileSync(statePath)).digest("hex");
  assert.throws(
    () => manager.create(project, { workUnitId: "unit_corrupt", expectedFiles: ["feature.js"] }),
    (error) => error.code === "WORKTREE_STATE_CORRUPT"
  );
  const after = crypto.createHash("sha256").update(fs.readFileSync(statePath)).digest("hex");
  assert.equal(after, before);
});

test("Worktree Manager permanece en main y no expone acceso de archivos o Git al renderer", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(main, /const \{ WorktreeManager \} = require\("\.\/dorn-core\/worktree-manager"\)/);
  assert.match(main, /worktreeManager = new WorktreeManager\(/);
  assert.doesNotMatch(preload, /WorktreeManager|worktrees\.json|child_process|spawnSync|gitChangedPaths/);
});
