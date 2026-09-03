"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { WorktreeManager } = require("../out/main/dorn-core/worktree-manager");
const { PolicyEngine } = require("../out/main/dorn-core/policy-engine");
const { ExecutionCore, safeArguments, safeEnvironment, validateGitArguments } = require("../out/main/dorn-core/execution-core");

function fixture(context, id = "execution_project", options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-${id}-`));
  const isolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-${id}-isolated-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  context.after(() => fs.rmSync(isolationRoot, { recursive: true, force: true }));
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: options.trustState || "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const worktrees = new WorktreeManager({ projectCore, isolationRoot, maxFiles: 1000, maxBytes: 64 * 1024 * 1024 });
  const policy = new PolicyEngine({ projectCore, resolvePermissionMode: () => options.mode || "full-control" });
  const execution = new ExecutionCore({ projectCore, policyEngine: policy, worktreeManager: worktrees, maxOutputBytes: options.maxOutputBytes || 512 * 1024 });
  execution.discoverDefaults();
  context.after(() => execution.stop());
  return { root, isolationRoot, projectCore, project, worktrees, policy, execution };
}

function createUnit(worktrees, project, id, files) {
  const unit = worktrees.create(project, { workUnitId: id, expectedFiles: files });
  for (const [relativePath, content] of Object.entries(files.reduce((map, item) => ({ ...map, [item]: "" }), {}))) {
    if (content) fs.writeFileSync(path.join(unit.executionRoot, relativePath), content);
  }
  return unit;
}

test("Execution Core ejecuta node --test en el Worktree sin shell y devuelve un registro observable", async (context) => {
  const { project, worktrees, execution } = fixture(context, "execution_test");
  const unit = createUnit(worktrees, project, "unit_node_test", ["sample.test.cjs"]);
  fs.writeFileSync(path.join(unit.executionRoot, "sample.test.cjs"), [
    'const test = require("node:test");',
    'const assert = require("node:assert/strict");',
    'test("works", () => assert.equal(2 + 2, 4));',
    ''
  ].join("\n"));
  const run = execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, args: ["--test", "sample.test.cjs"], timeoutMs: 10_000 });
  const result = await run.promise;
  assert.equal(result.exitCode, 0);
  assert.equal(result.truthState, "EXECUTED");
  assert.equal(result.workUnitId, unit.workUnitId);
  assert.equal(result.isolation.filesystem, "BOUNDED_COPY_SANDBOX");
  assert.equal(result.isolation.network, "NOT_ENFORCED_LOCAL_TARGET");
  assert.match(result.stdout, /works/);
  const recorded = worktrees.recordTest(project, unit.workUnitId, { passed: true, independent: true, exitCode: result.exitCode, command: ["node", "--test", "sample.test.cjs"] });
  assert.equal(recorded.state, "TESTED");
  worktrees.dispose(project, unit.workUnitId, { force: true });
});

test("los scripts relativos se validan desde el cwd solicitado sin salir del Worktree", async (context) => {
  const { project, worktrees, execution } = fixture(context, "execution_nested_cwd");
  const unit = createUnit(worktrees, project, "unit_nested_cwd", ["nested/sample.test.cjs"]);
  fs.mkdirSync(path.join(unit.executionRoot, "nested"), { recursive: true });
  fs.writeFileSync(path.join(unit.executionRoot, "nested", "sample.test.cjs"), [
    'const test = require("node:test");',
    'const assert = require("node:assert/strict");',
    'test("nested", () => assert.equal(process.cwd().endsWith("nested"), true));',
    ''
  ].join("\n"));
  const result = await execution.execute(project, {
    toolId: "node", workUnitId: unit.workUnitId, relativeCwd: "nested",
    args: ["--test", "sample.test.cjs"], timeoutMs: 10_000
  }).promise;
  assert.equal(result.exitCode, 0);
  assert.equal(result.cwdRelative, "nested");
  assert.throws(
    () => execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, relativeCwd: "nested", args: ["../../outside.js"] }),
    (error) => error.code === "EXECUTION_SCRIPT_OUTSIDE_SCOPE"
  );
  worktrees.dispose(project, unit.workUnitId, { force: true });
});

test("Node eval, preload, scripts externos y URLs se bloquean antes de spawn", (context) => {
  const { root, project, worktrees, execution } = fixture(context, "execution_args");
  const unit = createUnit(worktrees, project, "unit_args", ["safe.js"]);
  fs.writeFileSync(path.join(unit.executionRoot, "safe.js"), "console.log('safe');\n");
  assert.throws(
    () => execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, args: ["-e", "console.log(1)"] }),
    (error) => error.code === "EXECUTION_NODE_FLAG_DENIED"
  );
  assert.throws(
    () => execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, args: ["--require", "safe.js"] }),
    (error) => error.code === "EXECUTION_NODE_FLAG_DENIED"
  );
  assert.throws(
    () => execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, args: [path.join(root, "outside.js")] }),
    (error) => error.code === "EXECUTION_SCRIPT_OUTSIDE_SCOPE"
  );
  assert.throws(
    () => execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, args: ["https://example.com/script.js"] }),
    (error) => error.code === "EXECUTION_URL_ARG_DENIED"
  );
  worktrees.dispose(project, unit.workUnitId, { force: true });
});

test("argumentos, entorno y salida nunca conservan credenciales literales", async (context) => {
  const { project, worktrees, execution } = fixture(context, "execution_secrets");
  const unit = createUnit(worktrees, project, "unit_secrets", ["print.js"]);
  fs.writeFileSync(path.join(unit.executionRoot, "print.js"), "console.log('api_key=abcdefghijklmnop');\n");
  assert.throws(() => safeArguments(["token=abcdefghijklmnop"]), (error) => error.code === "EXECUTION_ARG_SECRET_OR_INVALID");
  assert.throws(() => safeEnvironment({ API_KEY: "abcdefghijklmnop" }), (error) => error.code === "EXECUTION_ENV_KEY_DENIED");
  const result = await execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, args: ["print.js"] }).promise;
  assert.doesNotMatch(result.stdout, /abcdefghijklmnop/);
  assert.match(result.stdout, /OCULTO/);
  worktrees.dispose(project, unit.workUnitId, { force: true });
});

test("cwd enlazado o fuera del aislamiento se rechaza", { skip: process.platform === "win32" }, (context) => {
  const { project, worktrees, execution } = fixture(context, "execution_cwd");
  const unit = createUnit(worktrees, project, "unit_cwd", ["safe.js"]);
  fs.writeFileSync(path.join(unit.executionRoot, "safe.js"), "console.log('safe');\n");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-execution-outside-"));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(unit.executionRoot, "linked"), "dir");
  assert.throws(
    () => execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, relativeCwd: "linked", args: ["safe.js"] }),
    (error) => error.code === "EXECUTION_CWD_UNSAFE"
  );
  assert.throws(
    () => execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, relativeCwd: "../", args: ["safe.js"] }),
    (error) => error.code === "EXECUTION_CWD_UNSAFE"
  );
  fs.unlinkSync(path.join(unit.executionRoot, "linked"));
  worktrees.dispose(project, unit.workUnitId, { force: true });
});

test("timeout cancela el grupo de proceso y no produce un falso EXECUTED", async (context) => {
  const { project, worktrees, execution } = fixture(context, "execution_timeout");
  const unit = createUnit(worktrees, project, "unit_timeout", ["wait.js"]);
  fs.writeFileSync(path.join(unit.executionRoot, "wait.js"), "setInterval(() => {}, 1000);\n");
  const run = execution.execute(project, { toolId: "node", workUnitId: unit.workUnitId, args: ["wait.js"], timeoutMs: 120 });
  await assert.rejects(run.promise, (error) => error.code === "EXECUTION_TIMEOUT" && error.execution?.truthState === "FAILED");
  assert.equal(execution.active.size, 0);
  worktrees.dispose(project, unit.workUnitId, { force: true });
});

test("una herramienta reemplazada después de registrarse requiere nueva revisión", (context) => {
  const { project, worktrees, execution, root } = fixture(context, "execution_tool_swap");
  const unit = createUnit(worktrees, project, "unit_swap", ["safe.js"]);
  const executable = path.join(root, "tool.sh");
  fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  execution.register({ toolId: "temporary-tool", executable, action: "test.execute", argumentPolicy: "NODE_SCOPED", provenance: { source: "test", official: false } });
  fs.writeFileSync(executable, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.throws(
    () => execution.execute(project, { toolId: "temporary-tool", workUnitId: unit.workUnitId, args: [] }),
    (error) => error.code === "EXECUTABLE_CHANGED"
  );
  worktrees.dispose(project, unit.workUnitId, { force: true });
});

test("Git de Execution Core es sólo lectura y no puede convertirse en fetch, push o config", () => {
  assert.doesNotThrow(() => validateGitArguments(["status", "--porcelain=v1"]));
  assert.throws(() => validateGitArguments(["push", "origin", "main"]), (error) => error.code === "EXECUTION_GIT_ACTION_DENIED");
  assert.throws(() => validateGitArguments(["-c", "core.pager=cat", "status"]), (error) => error.code === "EXECUTION_GIT_FLAG_DENIED");
});

test("Execution Core no expone spawn, shell ni herramientas genéricas al renderer", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(main, /const \{ PolicyEngine \} = require\("\.\/dorn-core\/policy-engine"\)/);
  assert.match(main, /const \{ ExecutionCore \} = require\("\.\/dorn-core\/execution-core"\)/);
  assert.match(main, /executionCore = new ExecutionCore\(/);
  assert.match(main, /executionCore\.discoverDefaults\(\)/);
  assert.match(main, /executionCore\?\.stop\(\)/);
  assert.doesNotMatch(preload, /executionCore|child_process|spawn\(|shell:\s*true|process\.execute/);
});
