"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { PolicyEngine, safeHost } = require("../out/main/dorn-core/policy-engine");

function fixture(context, id = "policy_project", mode = "full-control", trustState = "TRUSTED") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dorn-${id}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState });
  const project = { id, name: id, rootPath: root };
  const policy = new PolicyEngine({ projectCore, resolvePermissionMode: () => mode });
  return { root, projectCore, project, policy };
}

test("full-control permite procesos dentro de un proyecto TRUSTED pero no elimina checkpoints críticos", (context) => {
  const { root, project, policy } = fixture(context, "policy_full");
  const allowed = policy.evaluate(project, { action: "process.execute", path: root, toolId: "node", args: ["--test"] });
  assert.equal(allowed.decision, "ALLOW");
  assert.equal(allowed.reason, "SCOPED_AUTONOMY");
  const critical = policy.evaluate(project, { action: "filesystem.delete", path: path.join(root, "output.txt"), irreversible: true });
  assert.equal(critical.decision, "CONFIRM");
  assert.equal(critical.reason, "CRITICAL_CONFIRMATION_REQUIRED");
});

test("operator confirma procesos y advisor los deniega", (context) => {
  const operator = fixture(context, "policy_operator", "operator");
  assert.equal(operator.policy.evaluate(operator.project, { action: "process.execute", path: operator.root }).decision, "CONFIRM");
  const advisor = fixture(context, "policy_advisor", "advisor");
  const decision = advisor.policy.evaluate(advisor.project, { action: "process.execute", path: advisor.root });
  assert.equal(decision.decision, "DENY");
  assert.equal(decision.reason, "ACTION_SCOPE_DENIED");
});

test("ningún modo ejecuta scripts de un workspace UNTRUSTED", (context) => {
  const { root, project, policy } = fixture(context, "policy_untrusted", "full-control", "UNTRUSTED");
  const decision = policy.evaluate(project, { action: "test.execute", path: root });
  assert.equal(decision.decision, "DENY");
  assert.equal(decision.reason, "UNTRUSTED_WORKSPACE");
});

test("filesystem scope usa rutas reales y bloquea escapes por symlink", { skip: process.platform === "win32" }, (context) => {
  const { root, project, policy } = fixture(context, "policy_paths");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-policy-outside-"));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside\n");
  fs.symlinkSync(outside, path.join(root, "linked"), "dir");
  const decision = policy.evaluate(project, { action: "filesystem.read", path: path.join(root, "linked", "secret.txt") });
  assert.equal(decision.decision, "DENY");
  assert.equal(decision.reason, "FILESYSTEM_SCOPE_DENIED");
  assert.equal(policy.evaluate(project, { action: "filesystem.write", path: path.join(root, "new", "file.txt") }).decision, "ALLOW");
});

test("red exige host exacto y aislamiento verificable; un wildcard no cubre el dominio raíz", (context) => {
  const { project, policy } = fixture(context, "policy_network");
  policy.configure(project, { networkHosts: ["*.example.com", "api.openai.com"] });
  assert.equal(policy.evaluate(project, { action: "filesystem.read", host: "sub.example.com", networkEnforced: false }).reason, "NETWORK_ISOLATION_UNAVAILABLE");
  assert.equal(policy.evaluate(project, { action: "filesystem.read", host: "example.com", networkEnforced: true }).reason, "NETWORK_SCOPE_DENIED");
  assert.equal(policy.evaluate(project, { action: "filesystem.read", host: "api.openai.com", networkEnforced: true }).decision, "ALLOW");
  assert.throws(() => safeHost("*.com"), (error) => error.code === "POLICY_HOST_INVALID");
  assert.throws(() => safeHost("https://example.com"), (error) => error.code === "POLICY_HOST_INVALID");
});

test("una aprobación es de un solo uso y queda ligada a argumentos, proyecto y acción", (context) => {
  const { root, project, policy } = fixture(context, "policy_approval", "operator");
  const request = { action: "process.execute", path: root, toolId: "node", args: ["--test"] };
  const approval = policy.issueApproval(project, request);
  assert.throws(
    () => policy.authorize(project, { ...request, args: ["dangerous.js"] }, approval),
    (error) => error.code === "POLICY_APPROVAL_INVALID"
  );
  assert.equal(policy.authorize(project, request, approval).decision, "ALLOW");
  assert.throws(() => policy.authorize(project, request, approval), (error) => error.code === "POLICY_APPROVAL_INVALID");
});

test("secretos no entran a scoped autonomy ni a una política serializable", (context) => {
  const { project, policy } = fixture(context, "policy_secrets");
  const decision = policy.evaluate(project, { action: "secret.read", secret: true });
  assert.equal(decision.decision, "DENY");
  assert.equal(decision.reason, "SECRET_SCOPE_DENIED");
  assert.throws(
    () => policy.configure(project, { actions: ["filesystem.read"], networkHosts: ["token=abcdefghijklmnop"] }),
    (error) => ["POLICY_HOST_INVALID", "POLICY_SECRET_INLINE"].includes(error.code)
  );
});
