"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { EnvironmentCapsule, canonicalVersion, versionSatisfies } = require("../out/main/dorn-core/environment-capsule");

function fixture(context, id = `environment_${crypto.randomUUID().replaceAll("-", "")}`, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-environment-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const observedTools = options.observedTools || new Map();
  const executionCore = {
    list: () => [...observedTools.values()].map((entry) => ({ toolId: entry.toolId, installed: entry.installed !== false })),
    health: (toolId) => structuredClone(observedTools.get(toolId)?.health || { toolId, installed: false, health: "NOT_INSTALLED", provenance: { official: false } })
  };
  const capsule = new EnvironmentCapsule({
    projectCore, executionCore, environment: options.environment || {}, environmentPath: options.environmentPath || "",
    spawnSync: options.spawnSync || (() => { throw new Error("No debía ejecutar una herramienta no registrada."); }),
    serviceProbe: options.serviceProbe || null
  });
  return { root, projectCore, project, observedTools, executionCore, capsule };
}
function nodeTool(version = "v24.1.0") {
  return {
    toolId: "node",
    health: {
      toolId: "node", installed: true, health: "HEALTHY", version,
      executableSha256: "a".repeat(64), provenance: { official: true }
    }
  };
}

test("detección estática separa requisitos de scripts y nunca ejecuta package.json", (context) => {
  const item = fixture(context);
  const marker = path.join(item.root, "NO-DEBE-EJECUTARSE");
  fs.writeFileSync(path.join(item.root, "package.json"), JSON.stringify({
    packageManager: "pnpm@10.5.0+sha512.deadbeef", engines: { node: ">=24 <25" },
    scripts: { postinstall: `node -e \"require('fs').writeFileSync('${marker}','x')\"` }
  }));
  fs.writeFileSync(path.join(item.root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const detected = item.capsule.detect(item.project);
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(detected.requirements.map((entry) => entry.id), ["node", "pnpm"]);
  assert.equal(detected.requirements.find((entry) => entry.id === "node").versionRange, ">=24.0.0 <25.0.0");
  assert.equal(detected.requirements.find((entry) => entry.id === "pnpm").versionRange, "10.5.0");
});

test("requisitos del proyecto y observaciones del PC son estados distintos", (context) => {
  const tools = new Map([["node", nodeTool()]]);
  const item = fixture(context, undefined, { observedTools: tools });
  const requiredOs = process.platform === "win32" ? "linux" : "windows";
  item.capsule.declare(item.project, {
    target: { os: requiredOs, arch: "x64" },
    requirements: [{ id: "node", kind: "RUNTIME", versionRange: ">=24 <25" }]
  });
  const observation = item.capsule.observe(item.project, { persist: true });
  assert.equal(observation.requirements.find((entry) => entry.id === "node").versionRange, ">=24.0.0 <25.0.0");
  assert.equal(observation.results.find((entry) => entry.id === "node").state, "SATISFIED");
  assert.equal(observation.target.os, requiredOs);
  assert.notEqual(observation.host.os, requiredOs);
  assert.equal(observation.state, "TARGET_MISMATCH");
  assert.equal(item.capsule.latest(item.project).capsuleHash, observation.capsuleHash);
});

test("health check exige versión compatible y conserva hash del ejecutable observado", (context) => {
  const tools = new Map([["node", nodeTool("v22.9.0")]]);
  const item = fixture(context, undefined, { observedTools: tools });
  item.capsule.declare(item.project, { requirements: [{ id: "node", kind: "RUNTIME", versionRange: ">=24" }] });
  const observation = item.capsule.observe(item.project);
  const node = observation.results.find((entry) => entry.id === "node");
  assert.equal(node.state, "VERSION_MISMATCH");
  assert.equal(node.version, "22.9.0");
  assert.equal(node.executableSha256, "a".repeat(64));
  assert.equal(observation.state, "NEEDS_PREPARATION");
  assert.deepEqual(canonicalVersion("node v24.3.1").version, "24.3.1");
  assert.equal(versionSatisfies("24.3.1", ">=24.0.0 <25.0.0-0"), true);
});

test("variables no secretas guardan sólo presencia; credenciales se envían al Secret Vault", (context) => {
  const item = fixture(context, undefined, { environment: { CI: "true", SAFE_MODE: "enabled" } });
  item.capsule.declare(item.project, { requirements: [{ id: "safe-mode", kind: "ENVIRONMENT", variable: "SAFE_MODE" }] });
  const observation = item.capsule.observe(item.project, { persist: true });
  const variable = observation.results.find((entry) => entry.id === "safe-mode");
  assert.deepEqual(variable, { id: "safe-mode", kind: "ENVIRONMENT", state: "SATISFIED", present: true, valueStored: false });
  assert.doesNotMatch(fs.readFileSync(path.join(item.root, ".dorn", "manifests", "environment-observation-v2.json"), "utf8"), /enabled/);
  assert.throws(() => item.capsule.declare(item.project, { requirements: [{ id: "moonshot-key", kind: "ENVIRONMENT", variable: "MOONSHOT_API_KEY" }] }), (error) => error.code === "ENVIRONMENT_SECRET_REFERENCE_REQUIRED");
});

test("preparación bloquea nombres ambiguos y sólo entrega fuentes fijadas al Supply Chain Guard", (context) => {
  const item = fixture(context);
  item.capsule.declare(item.project, { requirements: [{ id: "godot", kind: "RUNTIME", versionRange: ">=4.4" }] });
  const ambiguous = item.capsule.observe(item.project, { persist: true });
  const blocked = item.capsule.preparationPlan(item.project, { capsule: ambiguous });
  assert.equal(blocked.state, "BLOCKED");
  assert.equal(blocked.actions[0].state, "BLOCKED_UNVERIFIED_SOURCE");
  assert.equal(blocked.mutatesSystem, false);

  item.capsule.declare(item.project, { requirements: [{
    id: "godot", kind: "RUNTIME", versionRange: ">=4.4",
    source: { url: "https://github.com/godotengine/godot/releases/download/4.4/godot.zip", sha256: "b".repeat(64), license: "MIT" }
  }] });
  const pinned = item.capsule.observe(item.project, { persist: true });
  assert.equal(item.capsule.preparationPlan(item.project, { capsule: pinned }).actions[0].state, "AWAITING_EXPLICIT_APPROVAL");
  const authorized = item.capsule.preparationPlan(item.project, { capsule: pinned, authorization: { approved: true, projectId: item.project.id } });
  assert.equal(authorized.state, "AUTHORIZED_PLAN");
  assert.equal(authorized.actions[0].state, "AUTHORIZED_FOR_SUPPLY_CHAIN_FETCH");
  assert.equal(authorized.actions[0].executable, false, "Environment Capsule no descarga ni instala por su cuenta.");
});

test("servicios no abren red sin scope explícito y un probe inyectado no ve credenciales", (context) => {
  let calls = 0;
  const item = fixture(context, undefined, { serviceProbe: ({ requirement }) => { calls += 1; assert.equal(requirement.service.host, "localhost"); return { healthy: true, detail: "ready" }; } });
  item.capsule.declare(item.project, { requirements: [{ id: "local-db", kind: "SERVICE", service: { protocol: "tcp", host: "localhost", port: 5432 } }] });
  assert.equal(item.capsule.observe(item.project).results[0].state, "NOT_PROBED");
  assert.equal(calls, 0);
  assert.equal(item.capsule.observe(item.project, { allowServiceHealth: true }).results[0].state, "SATISFIED");
  assert.equal(calls, 1);
});

test("estado corrupto o enlazado se rechaza sin sobrescribir", { skip: process.platform === "win32" }, (context) => {
  const item = fixture(context);
  const requirementsPath = path.join(item.root, ".dorn", "manifests", "environment-requirements-v2.json");
  fs.writeFileSync(requirementsPath, "{broken");
  const before = fs.readFileSync(requirementsPath);
  assert.throws(() => item.capsule.declare(item.project, { requirements: [] }), (error) => error.code === "ENVIRONMENT_STATE_CORRUPT");
  assert.deepEqual(fs.readFileSync(requirementsPath), before);
  fs.unlinkSync(requirementsPath);
  const outside = path.join(os.tmpdir(), `dorn-env-outside-${crypto.randomUUID()}.json`);
  fs.writeFileSync(outside, "{}");
  context.after(() => fs.rmSync(outside, { force: true }));
  fs.symlinkSync(outside, requirementsPath);
  assert.throws(() => item.capsule.declared(item.project), (error) => error.code === "ENVIRONMENT_STATE_UNSAFE");
});

test("manifest enlazado y fuente HTTP se bloquean antes de observar o preparar", { skip: process.platform === "win32" }, (context) => {
  const item = fixture(context);
  const outside = path.join(os.tmpdir(), `dorn-package-outside-${crypto.randomUUID()}.json`);
  fs.writeFileSync(outside, JSON.stringify({ engines: { node: ">=24" } }));
  context.after(() => fs.rmSync(outside, { force: true }));
  fs.symlinkSync(outside, path.join(item.root, "package.json"));
  assert.throws(() => item.capsule.detect(item.project), (error) => error.code === "ENVIRONMENT_MANIFEST_UNSAFE");
  fs.unlinkSync(path.join(item.root, "package.json"));
  assert.throws(() => item.capsule.declare(item.project, { requirements: [{ id: "godot", source: { url: "http://example.com/godot.zip", sha256: "c".repeat(64), license: "MIT" } }] }), (error) => error.code === "ENVIRONMENT_SOURCE_URL_UNSAFE");
});

test("cambio A→B→A conserva cápsulas por identidad sin contaminación", (context) => {
  const first = fixture(context, "environment_a", { observedTools: new Map([["node", nodeTool("v24.2.0")]]) });
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-environment-b-"));
  context.after(() => fs.rmSync(secondRoot, { recursive: true, force: true }));
  first.projectCore.adopt(secondRoot, { projectId: "environment_b", name: "B", trustState: "TRUSTED" });
  const second = { id: "environment_b", name: "B", rootPath: secondRoot };
  first.capsule.declare(first.project, { requirements: [{ id: "node", versionRange: ">=24 <25" }] });
  first.capsule.declare(second, { requirements: [{ id: "node", versionRange: ">=22 <23" }] });
  assert.equal(first.capsule.observe(first.project).results[0].state, "SATISFIED");
  assert.equal(first.capsule.observe(second).results[0].state, "VERSION_MISMATCH");
  assert.equal(first.capsule.observe(first.project).results[0].state, "SATISFIED");
});

test("Environment Capsule queda en main y el renderer recibe sólo resumen acotado", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(main, /const \{ EnvironmentCapsule \} = require\("\.\/dorn-core\/environment-capsule"\)/);
  assert.match(main, /environmentCapsule = new EnvironmentCapsule\(\{/);
  assert.match(main, /environmentCapsule\.summary\(environmentCapsule\.observe\(project/);
  assert.doesNotMatch(preload, /EnvironmentCapsule|environment-observation-v2|executableSha256|preparationPlan/);
});
