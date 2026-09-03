"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { WorktreeManager } = require("../out/main/dorn-core/worktree-manager");
const { PolicyEngine } = require("../out/main/dorn-core/policy-engine");
const { ExecutionCore, validateWslScopedNodeArguments } = require("../out/main/dorn-core/execution-core");
const { LinuxRuntimeManager, decodeWindowsOutput, parseWslList } = require("../out/main/dorn-core/linux-runtime");

function fakeWsl(root) {
  const executable = path.join(root, "wsl-test-host.cjs");
  fs.writeFileSync(executable, [
    "#!/usr/bin/env node",
    'const childProcess = require("node:child_process");',
    "const args = process.argv.slice(2);",
    'if (args[0] === "--list" && args[1] === "--verbose") {',
    '  process.stdout.write("  NAME                   STATE           VERSION\\n* Ubuntu-24.04           Running         2\\n  Legacy                 Stopped         1\\n");',
    "  process.exit(0);",
    "}",
    'const marker = args.indexOf("--exec");',
    'if (args[0] !== "--distribution" || marker !== 2 || args[3] !== "node") process.exit(64);',
    "const result = childProcess.spawnSync(process.execPath, args.slice(4), { cwd: process.cwd(), env: process.env, stdio: \"inherit\", shell: false });",
    "process.exit(Number.isInteger(result.status) ? result.status : 1);",
    ""
  ].join("\n"), { mode: 0o755 });
  return executable;
}

function fixture(context, id) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-linux-${id}-`));
  const isolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-linux-${id}-worktrees-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  context.after(() => fs.rmSync(isolationRoot, { recursive: true, force: true }));
  const wslExecutable = fakeWsl(root);
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const worktrees = new WorktreeManager({ projectCore, isolationRoot, maxFiles: 1_000, maxBytes: 64 * 1024 * 1024 });
  const policy = new PolicyEngine({ projectCore, resolvePermissionMode: () => "full-control" });
  const execution = new ExecutionCore({ projectCore, policyEngine: policy, worktreeManager: worktrees, maxOutputBytes: 512 * 1024 });
  execution.discoverDefaults();
  context.after(() => execution.stop());
  const options = { projectCore, worktreeManager: worktrees, executionCore: execution, platform: "win32", wslExecutable };
  return { root, project, projectCore, worktrees, execution, options, manager: new LinuxRuntimeManager(options) };
}

test("la salida UTF-16 de WSL se decodifica y sólo conserva distribuciones observadas", () => {
  const raw = Buffer.from("  NAME          STATE        VERSION\r\n* Ubuntu        Running      2\r\n  Legacy        Stopped      1\r\n", "utf16le");
  assert.match(decodeWindowsOutput(raw), /Ubuntu/);
  assert.deepEqual(parseWslList(raw), [
    { name: "Ubuntu", default: true, state: "Running", wslVersion: 2 },
    { name: "Legacy", default: false, state: "Stopped", wslVersion: 1 }
  ]);
});

test("Linux Runtime detecta WSL 2 por hash y no presenta targets futuros como disponibles", (context) => {
  const { manager } = fixture(context, "linux_discovery");
  const observation = manager.discover();
  assert.equal(observation.state, "READY");
  assert.equal(observation.defaultDistro, "Ubuntu-24.04");
  assert.match(observation.executable.sha256, /^[a-f0-9]{64}$/);
  assert.equal(observation.distributions.find((entry) => entry.name === "Legacy").wslVersion, 1);
  const publicStatus = manager.publicStatus();
  assert.equal(publicStatus.state, "READY");
  assert.equal(publicStatus.executablePresent, true);
  assert.equal(Object.hasOwn(publicStatus, "executable"), false);
  assert.doesNotMatch(JSON.stringify(publicStatus), /wsl-test-host|stderr|sha256/i);
  const catalog = manager.targetCatalog();
  assert.equal(catalog.find((entry) => entry.targetId === "LOCAL_WSL").state, "READY");
  assert.equal(catalog.find((entry) => entry.targetId === "CLOUD_WORKER").state, "NOT_IMPLEMENTED");
  const setup = manager.setupPlan();
  assert.equal(setup.outcome, "READY");
  assert.equal(setup.installerIndependent, true);
  assert.equal(setup.projectStorage.recommended, "WSL_EXT4_MANAGED");
});

test("DORN inspecciona lenguajes Linux sin shell ni argumentos dinámicos", (context) => {
  const { manager } = fixture(context, "linux_toolchain");
  const toolchain = manager.inspectToolchain({ distro: "Ubuntu-24.04" });
  assert.equal(toolchain.distro, "Ubuntu-24.04");
  assert.equal(toolchain.tools.node.installed, true);
  assert.match(toolchain.tools.node.version, /^v\d+/);
  assert.equal(toolchain.tools.python3.installed, false);
});

test("WSL sólo permite Node acotado y bloquea shell, sudo, eval y rutas externas", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-linux-args-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "safe.cjs"), "console.log('safe');\n");
  assert.doesNotThrow(() => validateWslScopedNodeArguments(["--distribution", "Ubuntu", "--exec", "node", "safe.cjs"], root));
  assert.throws(() => validateWslScopedNodeArguments(["--distribution", "Ubuntu", "--exec", "bash", "-c", "echo unsafe"], root), (error) => error.code === "EXECUTION_WSL_CONTRACT_INVALID");
  assert.throws(() => validateWslScopedNodeArguments(["--distribution", "Ubuntu", "--exec", "node", "--eval", "1+1"], root), (error) => error.code === "EXECUTION_NODE_FLAG_DENIED");
  assert.throws(() => validateWslScopedNodeArguments(["--distribution", "../Ubuntu", "--exec", "node", "safe.cjs"], root), (error) => error.code === "EXECUTION_WSL_DISTRO_INVALID");
});

test("una Work Unit Linux se crea, guarda, ejecuta, reabre y recupera sin tocar el proyecto principal", async (context) => {
  const { root, project, worktrees, options, manager } = fixture(context, "linux_vertical");
  fs.writeFileSync(path.join(root, "worker.cjs"), [
    'const fs = require("node:fs");',
    'fs.writeFileSync("result.txt", "DORN Linux P0\\n");',
    'console.log("linux-work-unit-ok");',
    ""
  ].join("\n"));
  const prepared = manager.prepare(project, {
    runtimeUnitId: "linux_unit_1", distro: "Ubuntu-24.04",
    expectedFiles: ["result.txt"], requiredFiles: ["result.txt"]
  });
  assert.equal(prepared.unit.state, "PREPARED");
  assert.equal(fs.existsSync(path.join(root, "result.txt")), false);
  const result = await manager.executeNode(project, "linux_unit_1", { args: ["worker.cjs"], action: "process.execute" }).promise;
  assert.equal(result.truthState, "EXECUTED");
  assert.match(result.stdout, /linux-work-unit-ok/);
  assert.equal(fs.readFileSync(path.join(prepared.workUnit.executionRoot, "result.txt"), "utf8"), "DORN Linux P0\n");
  assert.equal(fs.existsSync(path.join(root, "result.txt")), false);
  const reopened = new LinuxRuntimeManager(options);
  assert.equal(reopened.get(project, "linux_unit_1").state, "EXECUTED");
  reopened.updateExecution(project, "linux_unit_1", { state: "RUNNING", lastExecution: { executionId: "interrupted-test", state: "RUNNING" } });
  const recovery = new LinuxRuntimeManager(options).recover(project);
  assert.deepEqual(recovery.interrupted, ["linux_unit_1"]);
  assert.equal(new LinuxRuntimeManager(options).get(project, "linux_unit_1").state, "INTERRUPTED");
  worktrees.dispose(project, "linux_unit_1", { force: true });
});

test("Linux Runtime permanece en main y el preload sólo expone operaciones acotadas", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  const controlCenter = fs.readFileSync(path.join(root, "out", "renderer", "vendor", "dorn-control-center.js"), "utf8");
  assert.match(main, /const \{ LinuxRuntimeManager \} = require\("\.\/dorn-core\/linux-runtime"\)/);
  assert.match(main, /linuxRuntime = new LinuxRuntimeManager\(/);
  assert.match(main, /linuxRuntime\.publicStatus\(\)/);
  assert.match(preload, /linuxRuntime:\s*\{/);
  assert.match(preload, /dorn:linux_runtime_setup_plan/);
  assert.match(preload, /dorn:linux_runtime_execute_node/);
  assert.doesNotMatch(preload, /wsl\.exe|child_process|spawn\(|exec\(/);
  assert.match(controlCenter, /navButton\("linux", "DORN Linux"\)/);
  assert.match(controlCenter, /data-page="linux"/);
  assert.match(controlCenter, /window\.dorn\.linuxRuntime\.status\(\)/);
  assert.match(controlCenter, /window\.dorn\.linuxRuntime\.toolchain/);
  assert.match(controlCenter, /Work Units aisladas/);
});
