"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { EvidenceCore } = require("../out/main/dorn-core/evidence-core");
const { DurableJobRuntime } = require("../out/main/dorn-core/job-runtime");

function fixture(context, id = "jobs_project") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-${id}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id });
  const project = { id, name: id, rootPath: root };
  const evidenceCore = new EvidenceCore();
  const runtime = new DurableJobRuntime({ projectCore, evidenceCore, maxConcurrency: 1 });
  context.after(() => { runtime.closeAll(); evidenceCore.closeAll(); });
  return { root, project, projectCore, evidenceCore, runtime };
}

function passingEvidence(evidenceCore, project, job, files) {
  return evidenceCore.record(project, {
    evidenceType: "COMMAND",
    command: "node --test independent.test.cjs",
    result: "PASSED",
    exitCode: 0,
    truthState: "VERIFIED",
    files,
    environment: { independent: true, runner: "node:test" },
    tests: ["independent.test.cjs"],
    tasks: [job.id]
  });
}

test("Durable Jobs sólo completa con Evidence independiente ligada al Job y a los mismos bytes", async (context) => {
  const { root, project, evidenceCore, runtime } = fixture(context, "job_verified");
  fs.writeFileSync(path.join(root, "feature.js"), "module.exports = 1;\n");
  runtime.register("verify-feature", async ({ job }) => {
    const evidence = passingEvidence(evidenceCore, project, job, ["feature.js"]);
    return { successContractSatisfied: true, evidenceIds: [evidence.evidenceId] };
  }, { idempotent: true });
  const queued = runtime.enqueue(project, {
    type: "verify-feature",
    goal: "Verificar bytes exactos",
    scope: { expectedFiles: ["feature.js"], mutatesProject: false },
    idempotencyKey: "verify-feature:1"
  });
  const completed = await runtime.wait(project, queued.id);
  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.result.completionGate.completed, true);
  assert.equal(runtime.enqueue(project, {
    type: "verify-feature",
    scope: { expectedFiles: ["feature.js"] },
    idempotencyKey: "verify-feature:1"
  }).id, queued.id);
});

test("un resultado sin Evidence, sin enlace o con prueba no independiente nunca queda COMPLETED", async (context) => {
  const { root, project, evidenceCore, runtime } = fixture(context, "job_false_completion");
  fs.writeFileSync(path.join(root, "feature.js"), "module.exports = 1;\n");
  runtime.register("no-evidence", async () => ({ successContractSatisfied: true }), { idempotent: true });
  const missing = runtime.enqueue(project, { type: "no-evidence", scope: { expectedFiles: ["feature.js"] } });
  assert.equal((await runtime.wait(project, missing.id)).state, "PARTIAL");

  runtime.register("unlinked-evidence", async () => {
    const evidence = evidenceCore.record(project, {
      evidenceType: "COMMAND", command: "node --test", result: "PASSED", exitCode: 0, truthState: "VERIFIED",
      files: ["feature.js"], environment: { independent: true }
    });
    return { successContractSatisfied: true, evidenceIds: [evidence.evidenceId] };
  }, { idempotent: true });
  const unlinked = runtime.enqueue(project, { type: "unlinked-evidence", scope: { expectedFiles: ["feature.js"] } });
  const unlinkedResult = await runtime.wait(project, unlinked.id);
  assert.equal(unlinkedResult.state, "PARTIAL");
  assert.equal(unlinkedResult.error.code, "EVIDENCE_NOT_LINKED_TO_JOB");

  runtime.register("dependent-test", async ({ job }) => {
    const evidence = evidenceCore.record(project, {
      evidenceType: "COMMAND", command: "node --test", result: "PASSED", exitCode: 0, truthState: "VERIFIED",
      files: ["feature.js"], environment: { independent: false }, tasks: [job.id]
    });
    return { successContractSatisfied: true, evidenceIds: [evidence.evidenceId] };
  }, { idempotent: true });
  const dependent = runtime.enqueue(project, { type: "dependent-test", scope: { expectedFiles: ["feature.js"] } });
  const dependentResult = await runtime.wait(project, dependent.id);
  assert.equal(dependentResult.state, "PARTIAL");
  assert.equal(dependentResult.error.code, "INDEPENDENT_TEST_REQUIRED");
});

test("si los bytes cambian después de la prueba el completion gate exige retest", async (context) => {
  const { root, project, evidenceCore, runtime } = fixture(context, "job_mutation");
  fs.writeFileSync(path.join(root, "feature.js"), "before\n");
  runtime.register("mutate-after-test", async ({ job }) => {
    const evidence = passingEvidence(evidenceCore, project, job, ["feature.js"]);
    fs.writeFileSync(path.join(root, "feature.js"), "after-test\n");
    return { successContractSatisfied: true, evidenceIds: [evidence.evidenceId] };
  }, { idempotent: true });
  const queued = runtime.enqueue(project, { type: "mutate-after-test", scope: { expectedFiles: ["feature.js"], mutatesProject: true } });
  const result = await runtime.wait(project, queued.id);
  assert.equal(result.state, "PARTIAL");
  assert.equal(result.error.code, "EVIDENCE_NOT_VERIFIED");
});

test("un reinicio convierte RUNNING en INTERRUPTED y nunca reanuda efectos sin revisión", async (context) => {
  const { root, project, projectCore, evidenceCore, runtime } = fixture(context, "job_restart");
  fs.writeFileSync(path.join(root, "feature.js"), "stable\n");
  const queued = runtime.enqueue(project, { type: "restart-sensitive", scope: { expectedFiles: ["feature.js"] } });
  runtime.closeAll();
  const databasePath = path.join(root, ".dorn", "tasks", "jobs.db");
  const db = new DatabaseSync(databasePath);
  db.prepare("UPDATE jobs SET state='RUNNING',finished_at=NULL WHERE id=?").run(queued.id);
  db.close();

  let executions = 0;
  const reopened = new DurableJobRuntime({ projectCore, evidenceCore, maxConcurrency: 1 });
  context.after(() => reopened.closeAll());
  reopened.register("restart-sensitive", async () => { executions += 1; return { successContractSatisfied: false }; }, { idempotent: true });
  assert.equal(reopened.get(project, queued.id).state, "INTERRUPTED");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(executions, 0);
  await reopened.reviewInterrupted(project, queued.id, { decision: "RETRY" });
  const reviewed = await reopened.wait(project, queued.id);
  assert.equal(executions, 1);
  assert.equal(reviewed.state, "PARTIAL");
  assert.match(reviewed.checkpoints[0].reason, /Reintento autorizado/);
});

test("Change Scope bloquea rutas inseguras y exige alcance explícito para mutaciones", (context) => {
  const { project, runtime } = fixture(context, "job_scope");
  assert.throws(
    () => runtime.enqueue(project, { type: "unsafe-scope", scope: { expectedFiles: ["../outside.txt"] } }),
    (error) => error.code === "JOB_SCOPE_PATH_UNSAFE"
  );
  assert.throws(
    () => runtime.enqueue(project, { type: "unsafe-scope", scope: { expectedFiles: [], mutatesProject: true } }),
    (error) => error.code === "JOB_SCOPE_REQUIRED"
  );
  assert.throws(
    () => runtime.enqueue(project, { type: "unsafe-scope", scope: { expectedFiles: ["folder//file.js"] } }),
    (error) => error.code === "JOB_SCOPE_PATH_UNSAFE"
  );
});

test("dependencias fallidas bloquean el Job siguiente y cancelar una cola no ejecuta su handler", async (context) => {
  const { project, runtime } = fixture(context, "job_dependency");
  runtime.register("fails", async () => { throw Object.assign(new Error("fallo de prueba"), { code: "EXPECTED_FAILURE" }); }, { idempotent: true });
  let executions = 0;
  runtime.register("dependent", async () => { executions += 1; return { successContractSatisfied: true }; }, { idempotent: true });
  const first = runtime.enqueue(project, { type: "fails", scope: {} });
  const second = runtime.enqueue(project, { type: "dependent", scope: {}, dependsOn: [first.id] });
  assert.equal((await runtime.wait(project, first.id)).state, "FAILED");
  const blocked = await runtime.wait(project, second.id);
  assert.equal(blocked.state, "BLOCKED");
  assert.equal(blocked.error.code, "JOB_DEPENDENCY_FAILED");
  assert.equal(executions, 0);

  const missingExecutor = runtime.enqueue(project, { type: "not-registered", scope: {} });
  assert.equal(runtime.cancel(project, missingExecutor.id).state, "CANCELLED");
});

test("la base de Jobs queda ligada a una identidad y rechaza enlaces simbólicos", { skip: process.platform === "win32" }, (context) => {
  const first = fixture(context, "job_identity_a");
  first.runtime.enqueue(first.project, { type: "not-registered", scope: {} });
  first.runtime.closeAll();
  const manifestPath = path.join(first.root, ".dorn", "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, projectId: "job_identity_b" }, null, 2));
  const secondRuntime = new DurableJobRuntime({ projectCore: first.projectCore, evidenceCore: first.evidenceCore });
  context.after(() => secondRuntime.closeAll());
  assert.throws(
    () => secondRuntime.list({ id: "job_identity_b", rootPath: first.root }),
    (error) => error.code === "JOB_PROJECT_IDENTITY_MISMATCH"
  );

  const linkedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-jobs-linked-"));
  context.after(() => fs.rmSync(linkedRoot, { recursive: true, force: true }));
  const linkedCore = new ProjectCore();
  linkedCore.adopt(linkedRoot, { projectId: "linked_jobs", name: "linked" });
  fs.rmSync(path.join(linkedRoot, ".dorn", "tasks"), { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-jobs-outside-"));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(linkedRoot, ".dorn", "tasks"), "dir");
  const linkedRuntime = new DurableJobRuntime({ projectCore: linkedCore });
  context.after(() => linkedRuntime.closeAll());
  assert.throws(
    () => linkedRuntime.list({ id: "linked_jobs", rootPath: linkedRoot }),
    (error) => error.code === "JOB_METADATA_UNSAFE"
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("la aplicación expone Jobs por IPC sin entregar SQLite ni ejecución al renderer", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(main, /const \{ DurableJobRuntime \} = require\("\.\/dorn-core\/job-runtime"\)/);
  assert.match(main, /jobRuntime = new DurableJobRuntime\(/);
  assert.match(main, /handle\("dorn:jobs_list"/);
  assert.match(main, /handle\("dorn:job_get"/);
  assert.match(main, /handle\("dorn:job_cancel"/);
  assert.match(main, /handle\("dorn:job_review_interrupted"/);
  assert.match(main, /jobRuntime\?\.closeAll\(\)/);
  assert.match(preload, /jobs:\s*\{/);
  assert.doesNotMatch(preload, /DatabaseSync|jobs\.db|node:sqlite|child_process/);
});
