"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { EvidenceCore } = require("../out/main/dorn-core/evidence-core");
const { DurableJobRuntime } = require("../out/main/dorn-core/job-runtime");
const { WorktreeManager } = require("../out/main/dorn-core/worktree-manager");
const { PolicyEngine } = require("../out/main/dorn-core/policy-engine");
const { ExecutionCore } = require("../out/main/dorn-core/execution-core");
const { GOLDEN_FILES } = require("../out/main/dorn-core/web-golden-project");
const { JOB_TYPE, WebGoldenRuntime, expectedFiles, targetDirectory } = require("../out/main/dorn-core/web-golden-runtime");

function fixture(context, id = "web_golden_runtime") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-${id}-`));
  const isolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-${id}-isolation-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  context.after(() => fs.rmSync(isolationRoot, { recursive: true, force: true }));
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const evidenceCore = new EvidenceCore();
  const worktreeManager = new WorktreeManager({ projectCore, isolationRoot, maxFiles: 1000, maxBytes: 64 * 1024 * 1024 });
  const policyEngine = new PolicyEngine({ projectCore, resolvePermissionMode: () => "full-control" });
  const executionCore = new ExecutionCore({ projectCore, policyEngine, worktreeManager, evidenceCore, maxOutputBytes: 512 * 1024 });
  executionCore.discoverDefaults();
  const jobRuntime = new DurableJobRuntime({ projectCore, evidenceCore, maxConcurrency: 1 });
  const webRuntime = new WebGoldenRuntime({ worktreeManager, executionCore, evidenceCore }).register(jobRuntime);
  context.after(() => { executionCore.stop(); jobRuntime.closeAll(); evidenceCore.closeAll(); });
  return { root, project, projectCore, evidenceCore, worktreeManager, policyEngine, executionCore, jobRuntime, webRuntime };
}

test("el Golden Project atraviesa Jobs, Worktree, Policy, Execution e Evidence sin fingir navegador", async (context) => {
  const { root, project, evidenceCore, worktreeManager, jobRuntime, webRuntime } = fixture(context);
  const queued = webRuntime.enqueue(jobRuntime, project, {
    targetDirectory: "dorn-web-golden",
    brief: { siteName: "DORN Web Lab", headline: "Diseño que resiste la crítica." },
    idempotencyKey: "web-golden:test:1"
  });
  assert.equal(queued.type, JOB_TYPE);
  assert.deepEqual(queued.scope.expectedFiles, expectedFiles("dorn-web-golden"));

  const finished = await jobRuntime.wait(project, queued.id, { timeoutMs: 30_000 });
  assert.equal(finished.state, "PARTIAL", JSON.stringify({ error: finished.error, result: finished.result }, null, 2));
  assert.equal(finished.error.code, "SUCCESS_CONTRACT_UNSATISFIED");
  assert.equal(finished.result.visualState, "BLOCKED_ENVIRONMENT");
  assert.equal(finished.result.browserBlocker, "BROWSER_BINARY_UNAVAILABLE");
  assert.equal(finished.result.testedTreeHash, finished.result.integratedTreeHash);

  for (const relativePath of GOLDEN_FILES) {
    const target = path.join(root, "dorn-web-golden", ...relativePath.split("/"));
    assert.equal(fs.lstatSync(target).isFile(), true, relativePath);
  }
  const staticEvidence = evidenceCore.evaluate(project, finished.result.staticEvidenceId);
  assert.equal(staticEvidence.truthState, "VERIFIED");
  assert.equal(staticEvidence.environment.independent, true);
  assert.deepEqual(staticEvidence.sourceFiles, expectedFiles("dorn-web-golden"));
  const visualEvidence = evidenceCore.evaluate(project, finished.result.visualEvidenceId);
  assert.equal(visualEvidence.truthState, "BLOCKED");
  assert.equal(visualEvidence.environment.browser, "NOT_EXECUTED");
  assert.equal(visualEvidence.screenshot, null);

  const unit = worktreeManager.get(project, finished.result.workUnitId);
  assert.equal(unit.state, "INTEGRATED");
  assert.equal(unit.executionRootAvailable, false);
});

test("la carpeta destino y el Change Scope no pueden ampliarse silenciosamente", async (context) => {
  const { project, webRuntime } = fixture(context, "web_golden_scope");
  for (const value of ["../escape", "folder/nested", ".hidden", "A", "space name"]) {
    assert.throws(() => targetDirectory(value), (error) => error.code === "WEB_GOLDEN_TARGET_INVALID");
  }
  await assert.rejects(
    webRuntime.produce({
      project,
      job: { id: "job-scope", payload: { targetDirectory: "golden-site", brief: {} }, scope: { expectedFiles: ["golden-site/index.html"] } }
    }),
    (error) => error.code === "WEB_GOLDEN_SCOPE_MISMATCH"
  );
});

test("Web Golden permanece en main y no entrega escritura, ejecución ni navegador al renderer", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(main, /const \{ WebGoldenRuntime \} = require\("\.\/dorn-core\/web-golden-runtime"\)/);
  assert.match(main, /webGoldenRuntime\.register\(jobRuntime\)/);
  assert.doesNotMatch(preload, /WebGoldenRuntime|web\.golden\.produce|writeWebGoldenFiles|BROWSER_BINARY_UNAVAILABLE/);
});
