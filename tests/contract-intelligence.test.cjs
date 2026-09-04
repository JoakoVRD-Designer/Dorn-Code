"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { ProjectIntegrityEngine } = require("../out/main/dorn-core/project-integrity");
const {
  ContractIntelligence, compareJsonSchema, compareOpenApi, parseProto, compareProto
} = require("../out/main/dorn-core/contract-intelligence");
const { WorktreeManager } = require("../out/main/dorn-core/worktree-manager");

const sourceRoot = path.resolve(__dirname, "..");

function temporary(context, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture(context, id = "contracts_a") {
  const root = temporary(context, `dorn-${id}-`);
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const projectIntegrity = new ProjectIntegrityEngine({ projectCore });
  const contracts = new ContractIntelligence({ projectCore, projectIntegrity });
  context.after(() => { contracts.closeAll(); projectIntegrity.closeAll(); });
  return { root, projectCore, project, projectIntegrity, contracts };
}

function scan(engine, project) {
  let status = engine.start(project);
  let guard = 0;
  while (status.nextCursor && guard < 10_000) {
    status = engine.scanPage(project, { scanId: status.nextCursor, fileBudget: 1000, timeBudgetMs: 5000 });
    guard += 1;
  }
  assert.equal(status.state, "COMPLETED");
  return status;
}

function writeJson(root, relativePath, value, spacing = 0) {
  const absolute = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, spacing)}\n`);
}

function mapping(root, entries) {
  writeJson(root, "dorn.contracts.json", { schema: "dorn.contract-map/1", contracts: entries }, 2);
}

test("JSON Schema detecta campos requeridos, removidos, tipos y restricciones incompatibles", () => {
  const previous = {
    type: "object", required: ["id"], additionalProperties: true,
    properties: {
      id: { type: "string" }, legacy: { type: "number" },
      status: { type: "string", enum: ["active", "paused"] },
      age: { type: "integer", minimum: 0 }
    }
  };
  const next = {
    type: "object", required: ["id", "name"], additionalProperties: false,
    properties: {
      id: { type: "number" }, name: { type: "string" },
      status: { type: "string", enum: ["active"] },
      age: { type: "integer", minimum: 18 }
    }
  };
  const impact = compareJsonSchema(previous, next);
  const types = new Set(impact.breaking.map((entry) => entry.type));
  for (const expected of ["NEW_REQUIRED_FIELD", "FIELD_REMOVED", "TYPE_NARROWED_OR_CHANGED", "ENUM_VALUE_REMOVED", "CONSTRAINT_TIGHTENED", "ADDITIONAL_PROPERTIES_FORBIDDEN"]) assert.ok(types.has(expected), expected);
  assert.ok(impact.compatible.some((entry) => entry.type === "FIELD_ADDED" && entry.path === "$.name"));
});

test("OpenAPI compara rutas, operationId, parámetros, cuerpos y respuestas mediante referencias locales", () => {
  const previous = {
    openapi: "3.1.0", paths: {
      "/users/{id}": { get: {
        operationId: "getUser", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } } }
      } }
    }, components: { schemas: { User: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string" } } } } }
  };
  const next = {
    openapi: "3.1.0", paths: {
      "/users/{id}": { get: {
        operationId: "fetchUser", parameters: [
          { name: "id", in: "path", required: true, schema: { type: "number" } },
          { name: "tenant", in: "header", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } } }
      } }
    }, components: { schemas: { User: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } }
  };
  const impact = compareOpenApi(previous, next);
  const types = new Set(impact.breaking.map((entry) => entry.type));
  assert.ok(types.has("OPERATION_ID_CHANGED"));
  assert.ok(types.has("NEW_REQUIRED_PARAMETER"));
  assert.ok(types.has("TYPE_NARROWED_OR_CHANGED"));
  assert.ok(types.has("FIELD_REMOVED"));
});

test("Protobuf distingue una eliminación reservada de reutilización, RPC removido y enum renumerado", () => {
  const previous = parseProto(`
    syntax = "proto3"; package dorn.api;
    message User { string id = 1; string legacy = 2; }
    enum State { UNKNOWN = 0; READY = 1; }
    service Users { rpc Get (User) returns (User); }
  `);
  const reserved = parseProto(`
    syntax = "proto3"; package dorn.api;
    message User { string id = 1; reserved 2; reserved "legacy"; }
    enum State { UNKNOWN = 0; READY = 2; }
    service Users { }
  `);
  const impact = compareProto(previous, reserved);
  assert.ok(impact.compatible.some((entry) => entry.type === "PROTO_FIELD_REMOVED_AND_RESERVED"));
  assert.ok(impact.breaking.some((entry) => entry.type === "PROTO_RPC_REMOVED"));
  assert.ok(impact.breaking.some((entry) => entry.type === "PROTO_ENUM_VALUE_RENUMBERED"));
  const reused = parseProto(`syntax = "proto3"; package dorn.api; message User { string id = 1; int32 other = 2; }`);
  assert.ok(compareProto(previous, reused).breaking.some((entry) => entry.type === "PROTO_FIELD_NUMBER_REUSED_OR_RENAMED"));
});

test("inventario, baseline durable y análisis bloquean un breaking change y planifican productores/consumidores", (context) => {
  const { root, project, projectIntegrity, contracts } = fixture(context, "contracts_gate");
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "tests", "contract.test.js"), "// contract test placeholder\n");
  writeJson(root, "contracts/user.schema.json", {
    $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", required: ["id"],
    properties: { id: { type: "string" }, name: { type: "string" } }
  }, 2);
  writeJson(root, "contracts/openapi.json", {
    openapi: "3.1.0", info: { title: "DORN", version: "1" }, paths: { "/health": { get: { responses: { "200": { description: "ok" } } } } }
  }, 2);
  fs.writeFileSync(path.join(root, "contracts", "events.proto"), "syntax = \"proto3\"; package dorn.events; message Ready { string id = 1; }\n");
  mapping(root, [
    { path: "contracts/user.schema.json", producers: ["backend"], consumers: ["mobile", "web"], contractTests: ["tests/contract.test.js"], owner: "platform" },
    { path: "contracts/openapi.json", producers: ["backend"], consumers: ["web"], contractTests: ["tests/contract.test.js"] },
    { path: "contracts/events.proto", producers: ["firmware"], consumers: ["backend"], contractTests: ["tests/contract.test.js"] }
  ]);
  scan(projectIntegrity, project);
  const inventory = contracts.inventory(project);
  assert.equal(inventory.state, "READY");
  assert.equal(inventory.contracts.length, 3);
  assert.deepEqual(inventory.contracts.find((entry) => entry.path.endsWith("user.schema.json")).consumers, ["mobile", "web"]);
  const snapshot = contracts.snapshot(project, { label: "v1 accepted" });
  assert.match(snapshot.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(contracts.getSnapshot(project, snapshot.snapshotId).contracts.length, 3);

  writeJson(root, "contracts/user.schema.json", {
    $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", required: ["id", "email"],
    properties: { id: { type: "number" }, email: { type: "string" } }
  }, 2);
  scan(projectIntegrity, project);
  const analysis = contracts.analyze(project, { snapshotId: snapshot.snapshotId });
  assert.equal(analysis.state, "BLOCKED_BREAKING_CHANGE");
  assert.ok(analysis.breaking.some((entry) => entry.type === "NEW_REQUIRED_FIELD"));
  assert.deepEqual(analysis.affectedConsumers, ["mobile", "web"]);
  assert.deepEqual(analysis.contractTests, ["tests/contract.test.js"]);
  assert.equal(analysis.verificationPlan.find((gate) => gate.gate === "BREAKING_CHANGE_REVIEW").state, "BLOCKED");
  assert.equal(analysis.verificationPlan.find((gate) => gate.gate === "CONSUMER_TESTS").state, "REQUIRED");
});

test("un cambio sólo de formato sigue requiriendo contract tests, sin inventar un breaking change", (context) => {
  const { root, project, projectIntegrity, contracts } = fixture(context, "contracts_format");
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "tests", "format.test.js"), "// format contract test\n");
  const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { id: { type: "string" } } };
  writeJson(root, "api.schema.json", schema, 0);
  mapping(root, [{ path: "api.schema.json", producers: ["api"], consumers: ["client"], contractTests: ["tests/format.test.js"] }]);
  scan(projectIntegrity, project);
  const snapshot = contracts.snapshot(project, { label: "compact" });
  writeJson(root, "api.schema.json", schema, 2);
  scan(projectIntegrity, project);
  const analysis = contracts.analyze(project, { snapshotId: snapshot.snapshotId });
  assert.equal(analysis.breaking.length, 0);
  assert.equal(analysis.state, "COMPATIBLE_TESTS_REQUIRED");
  assert.ok(analysis.impacts[0].compatible.some((entry) => entry.type === "FORMAT_ONLY_CHANGE"));
});

test("inventarios sin mapping, con YAML no adaptado, secretos o índice obsoleto nunca crean baseline", (context) => {
  const { root, project, projectIntegrity, contracts } = fixture(context, "contracts_incomplete");
  writeJson(root, "api.schema.json", { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" });
  fs.writeFileSync(path.join(root, "openapi.yaml"), "openapi: 3.1.0\ninfo:\n  title: DORN\n  version: 1\npaths: {}\n");
  writeJson(root, "secret.schema.json", { $schema: "https://json-schema.org/draft/2020-12/schema", authorization: "Bearer this-is-a-real-secret-token" });
  assert.throws(() => contracts.inventory(project), (error) => error.code === "CONTRACT_SCAN_REQUIRED");
  scan(projectIntegrity, project);
  const inventory = contracts.inventory(project);
  assert.equal(inventory.state, "REVIEW_REQUIRED");
  assert.ok(inventory.contractsWithoutMapping.includes("api.schema.json"));
  assert.ok(inventory.adapterRequired.some((entry) => entry.format === "OPENAPI_YAML"));
  assert.ok(inventory.failures.some((entry) => entry.code === "CONTRACT_SECRET_INLINE"));
  assert.throws(() => contracts.snapshot(project, { label: "unsafe" }), (error) => error.code === "CONTRACT_INVENTORY_INCOMPLETE");
  projectIntegrity.invalidate(project, "api.schema.json");
  assert.throws(() => contracts.inventory(project), (error) => error.code === "CONTRACT_INDEX_STALE");
});

test("Contract Intelligence queda ligado al proyecto y detecta corrupción del snapshot", (context) => {
  const { root, project, projectIntegrity, contracts } = fixture(context, "contracts_identity");
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "tests", "identity.test.js"), "// identity contract test\n");
  writeJson(root, "identity.schema.json", { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string" });
  mapping(root, [{ path: "identity.schema.json", producers: ["core"], consumers: ["ui"], contractTests: ["tests/identity.test.js"] }]);
  scan(projectIntegrity, project);
  const snapshot = contracts.snapshot(project, { label: "identity" });
  const dbPath = path.join(root, ".dorn", "manifests", "contract-intelligence.db");
  contracts.closeAll();
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  const row = db.prepare("SELECT snapshot_json FROM contract_snapshots WHERE snapshot_id=?").get(snapshot.snapshotId);
  const tampered = JSON.parse(row.snapshot_json);
  tampered.label = "tampered";
  db.prepare("UPDATE contract_snapshots SET snapshot_json=? WHERE snapshot_id=?").run(JSON.stringify(tampered), snapshot.snapshotId);
  db.close();
  assert.throws(() => contracts.getSnapshot(project, snapshot.snapshotId), (error) => error.code === "CONTRACT_SNAPSHOT_CORRUPT");
});

test("Worktree bloquea contratos incompatibles y sólo admite compatibles con sus contract tests y Evidence", (context) => {
  const { root, project, projectCore, projectIntegrity, contracts } = fixture(context, "contracts_worktree_gate");
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "tests", "gate.test.js"), "// independent contract gate\n");
  const baselineSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", required: ["id"],
    properties: { id: { type: "string" }, name: { type: "string" } }
  };
  writeJson(root, "api.schema.json", baselineSchema, 2);
  mapping(root, [{ path: "api.schema.json", producers: ["backend"], consumers: ["web"], contractTests: ["tests/gate.test.js"] }]);
  scan(projectIntegrity, project);
  const snapshot = contracts.snapshot(project, { label: "worktree baseline" });
  const isolationRoot = temporary(context, "dorn-contract-worktrees-");
  const worktrees = new WorktreeManager({ projectCore, contractIntelligence: contracts, isolationRoot, maxFiles: 1000, maxBytes: 64 * 1024 * 1024 });

  const incompatible = worktrees.create(project, { workUnitId: "contract-breaking", expectedFiles: ["api.schema.json"], contractSnapshotId: snapshot.snapshotId });
  writeJson(incompatible.executionRoot, "api.schema.json", {
    ...baselineSchema, required: ["id", "email"], properties: { id: { type: "number" }, email: { type: "string" } }
  }, 2);
  worktrees.recordTest(project, incompatible.workUnitId, {
    passed: true, independent: true, exitCode: 0,
    command: ["node", "--test", "tests/gate.test.js"], evidenceIds: ["evidence-contract-breaking"]
  });
  const blocked = worktrees.prepareIntegration(project, incompatible.workUnitId);
  assert.equal(blocked.state, "REWORK_REQUIRED");
  assert.equal(blocked.integration.contractGate.state, "BLOCKED_BREAKING_CHANGE");
  assert.throws(() => worktrees.integrate(project, incompatible.workUnitId), (error) => error.code === "WORKTREE_NOT_READY");

  const compatible = worktrees.create(project, { workUnitId: "contract-compatible", expectedFiles: ["api.schema.json"], contractSnapshotId: snapshot.snapshotId });
  writeJson(compatible.executionRoot, "api.schema.json", {
    ...baselineSchema, properties: { ...baselineSchema.properties, nickname: { type: "string" } }
  }, 2);
  worktrees.recordTest(project, compatible.workUnitId, {
    passed: true, independent: true, exitCode: 0,
    command: ["node", "--test", "tests/gate.test.js"], evidenceIds: ["evidence-contract-compatible"]
  });
  const ready = worktrees.prepareIntegration(project, compatible.workUnitId);
  assert.equal(ready.state, "READY_TO_INTEGRATE");
  assert.equal(ready.integration.contractGate.state, "COMPATIBLE_TESTS_REQUIRED");
  assert.equal(ready.integration.contractGate.testsCovered, true);

  const falseEvidence = worktrees.create(project, { workUnitId: "contract-false-evidence", expectedFiles: ["api.schema.json"], contractSnapshotId: snapshot.snapshotId });
  writeJson(falseEvidence.executionRoot, "api.schema.json", { ...baselineSchema, properties: { ...baselineSchema.properties, optional: { type: "boolean" } } }, 2);
  worktrees.recordTest(project, falseEvidence.workUnitId, {
    passed: true, independent: true, exitCode: 0, command: ["node", "--test", "tests/gate.test.js"], evidenceIds: []
  });
  const noEvidence = worktrees.prepareIntegration(project, falseEvidence.workUnitId);
  assert.equal(noEvidence.state, "REWORK_REQUIRED");
  assert.equal(noEvidence.integration.contractGate.testsCovered, false);

  const missingBaseline = worktrees.create(project, { workUnitId: "contract-no-baseline", expectedFiles: ["api.schema.json"] });
  writeJson(missingBaseline.executionRoot, "api.schema.json", { ...baselineSchema, properties: { id: { type: "string" }, optional: { type: "boolean" } } }, 2);
  worktrees.recordTest(project, missingBaseline.workUnitId, { passed: true, independent: true, exitCode: 0, command: ["node", "--test", "tests/gate.test.js"], evidenceIds: ["evidence-no-baseline"] });
  const noBaseline = worktrees.prepareIntegration(project, missingBaseline.workUnitId);
  assert.equal(noBaseline.state, "REWORK_REQUIRED");
  assert.equal(noBaseline.integration.contractGate.state, "BASELINE_REQUIRED");
});

test("la aplicación integra Contract Intelligence en main sin exponer contratos mutables al renderer", () => {
  const main = fs.readFileSync(path.join(sourceRoot, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(sourceRoot, "out", "preload", "index.js"), "utf8");
  assert.match(main, /new ContractIntelligence\(\{ projectCore, projectIntegrity, eventBus \}\)/);
  assert.match(main, /CONTRACT_SNAPSHOT_CREATED/);
  assert.match(main, /CONTRACT_ANALYSIS_COMPLETED/);
  assert.match(main, /contractIntelligence,/);
  assert.match(main, /contractIntelligence\?\.closeAll\(\)/);
  assert.doesNotMatch(preload, /ContractIntelligence|contractSnapshot|contractAnalysis/i);
  assert.doesNotMatch(main, /PRE-IDE.*renderer|renderer.*4\.9/i);
});
