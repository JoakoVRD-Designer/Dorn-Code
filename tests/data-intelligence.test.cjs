"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { EvidenceCore } = require("../out/main/dorn-core/evidence-core");
const {
  DataIntelligence,
  DataIntelligenceManager,
  fileHash
} = require("../out/main/dorn-core/data-intelligence");

function temporary(context, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture(context, id = "data_project") {
  const root = temporary(context, `dorn-${id}-`);
  const projectCore = new ProjectCore();
  projectCore.adopt(root, { projectId: id, name: id, trustState: "TRUSTED" });
  const project = { id, name: id, rootPath: root };
  const evidenceCore = new EvidenceCore();
  const data = new DataIntelligence({ project, projectCore, evidenceCore });
  context.after(() => evidenceCore.closeAll());
  return { root, projectCore, project, evidenceCore, data };
}

function createDatabase(root, relativePath = "app.sqlite", rows = 3) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      api_token TEXT DEFAULT 'private-default-value'
    );
    CREATE INDEX users_name_idx ON users(name);
    BEGIN;
  `);
  const insert = db.prepare("INSERT INTO users(id,name,api_token) VALUES(?,?,?)");
  for (let index = 1; index <= rows; index += 1) insert.run(index, `User ${index}`, `secret-${index}`);
  db.exec("COMMIT;");
  db.close();
  return filePath;
}

function safeAlterInput(expectedCount = 3) {
  return {
    statements: ["ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''"],
    checks: [{ name: "rows-preserved", table: "users", sql: "SELECT COUNT(*) AS count FROM users", column: "count", equals: expectedCount }],
    fixtures: [{ name: "representative-users", table: "users", sql: "SELECT id,name FROM users ORDER BY id", expectedCount }]
  };
}

test("esquema y consultas son acotados y ocultan defaults y credenciales", (context) => {
  const { root, data } = fixture(context, "data_schema");
  createDatabase(root, "catalog.sqlite", 1_000);
  const schema = data.schema("catalog.sqlite");
  assert.equal(schema.schema, "dorn.data-schema/2");
  assert.equal(schema.tables[0].name, "users");
  assert.match(schema.tables[0].sqlHash, /^[0-9a-f]{64}$/);
  const privateColumn = schema.tables[0].columns.find((column) => column.name === "api_token");
  assert.equal(privateColumn.hasDefault, true);
  assert.match(privateColumn.defaultDigest, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(schema), /private-default-value|secret-1/);

  const page = data.queryPage("catalog.sqlite", { table: "users", key: "id", limit: 25 });
  assert.equal(page.rows.length, 25);
  assert.equal(page.hasMore, true);
  assert.equal(page.rows[0].api_token, "[REDACTED]");
  assert.equal(page.nextCursor, 25);
});

test("la validación SQL rechaza destrucción, operaciones múltiples y verificaciones cosméticas", (context) => {
  const { data } = fixture(context, "data_sql_guard");
  const denied = [
    "DROP TABLE users",
    "DELETE FROM users",
    "PRAGMA writable_schema=ON",
    "ATTACH DATABASE 'other.sqlite' AS other",
    "ALTER TABLE users ADD COLUMN age INTEGER; DROP TABLE users",
    "ALTER TABLE users ADD COLUMN age INTEGER; -- oculto\nDELETE FROM users"
  ];
  for (const statement of denied) {
    assert.throws(() => data.validateMigrationInput({ statements: [statement] }), (error) => error.code === "DATA_MIGRATION_SQL_DENIED", statement);
  }
  assert.throws(() => data.validateMigrationInput({
    statements: ["ALTER TABLE users ADD COLUMN age INTEGER"],
    checks: [{ table: "users", sql: "SELECT 1 AS ok", column: "ok", equals: 1 }]
  }), (error) => error.code === "DATA_MIGRATION_CHECK_INVALID");
  assert.throws(() => data.validateMigrationInput({
    statements: ["UPDATE users SET name='changed'"],
    checks: [{ table: "users", sql: "SELECT COUNT(*) AS count FROM users", column: "count", equals: 1 }],
    fixtures: [{ table: "users", sql: "SELECT id,name FROM users", expectedCount: 1 }]
  }), (error) => error.code === "DATA_MIGRATION_FIXTURE_REQUIRED");
  for (const invalidFixture of [{ expectedCount: Number.NaN }, { expectedCount: 101 }, { expectedDigest: "not-a-sha256" }]) {
    assert.throws(() => data.validateMigrationInput({
      statements: ["ALTER TABLE users ADD COLUMN age INTEGER"],
      fixtures: [{ table: "users", sql: "SELECT id,name FROM users", ...invalidFixture }]
    }), (error) => error.code === "DATA_MIGRATION_FIXTURE_INVALID");
  }
});

test("migration probada exige Evidence exacta, aplica bytes verificados y restaura el backup", async (context) => {
  const { root, project, evidenceCore, data } = fixture(context, "data_apply_restore");
  const databasePath = createDatabase(root);
  const originalHash = fileHash(databasePath);
  const tested = await data.testMigration("app.sqlite", safeAlterInput(3));
  assert.equal(tested.state, "TESTED");
  assert.equal(tested.readiness, "READY");
  assert.equal(tested.representativeVerified, true);
  assert.equal(fileHash(databasePath), originalHash, "la prueba no debe mutar el origen");
  await assert.rejects(data.applyMigration("app.sqlite", tested.migrationTestId), (error) => error.code === "DATA_EVIDENCE_REQUIRED");

  const evidence = evidenceCore.record(project, {
    evidenceType: "DATA_MIGRATION",
    command: "node --test tests/data-intelligence.test.cjs",
    result: "PASSED",
    exitCode: 0,
    truthState: "VERIFIED",
    files: ["app.sqlite"],
    tests: ["tests/data-intelligence.test.cjs"],
    details: { migrationTestId: tested.migrationTestId, migratedHash: tested.migratedHash }
  });
  assert.equal(evidence.truthState, "VERIFIED");
  data.attachEvidence(tested.migrationTestId, evidence.evidenceId);

  const applied = await data.applyMigration("app.sqlite", tested.migrationTestId);
  assert.equal(applied.state, "APPLIED");
  assert.equal(applied.idempotent, false);
  assert.equal(applied.sha256, tested.migratedHash);
  const migrated = new DatabaseSync(databasePath, { readOnly: true });
  assert.ok(migrated.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "nickname"));
  assert.equal(Number(migrated.prepare("SELECT COUNT(*) AS count FROM users").get().count), 3);
  migrated.close();

  const repeated = await data.applyMigration("app.sqlite", tested.migrationTestId);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.state, "ALREADY_APPLIED");

  const restored = await data.restore("app.sqlite", applied.backup, {
    expectedCurrentHash: applied.sha256,
    migrationTestId: tested.migrationTestId
  });
  assert.equal(restored.restored, true);
  assert.equal(restored.sha256, applied.backup.sha256);
  const rolledBack = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(rolledBack.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "nickname"), false);
  assert.equal(Number(rolledBack.prepare("SELECT COUNT(*) AS count FROM users").get().count), 3);
  rolledBack.close();
});

test("cualquier mutación de la copia probada bloquea la aplicación", async (context) => {
  const { root, project, evidenceCore, data } = fixture(context, "data_working_mutation");
  createDatabase(root);
  const tested = await data.testMigration("app.sqlite", safeAlterInput(3));
  const evidence = evidenceCore.record(project, {
    evidenceType: "DATA_MIGRATION", command: "independent migration test", result: "PASSED", exitCode: 0, truthState: "VERIFIED",
    files: ["app.sqlite"], details: { migrationTestId: tested.migrationTestId, migratedHash: tested.migratedHash }
  });
  data.attachEvidence(tested.migrationTestId, evidence.evidenceId);
  fs.appendFileSync(tested.workingPath, Buffer.from("tampered"));
  await assert.rejects(data.applyMigration("app.sqlite", tested.migrationTestId), (error) => error.code === "DATA_MIGRATION_WORKING_COPY_CHANGED");
});

test("si el origen cambia después de Evidence, exige volver a probar", async (context) => {
  const { root, project, evidenceCore, data } = fixture(context, "data_source_mutation");
  const databasePath = createDatabase(root);
  const tested = await data.testMigration("app.sqlite", safeAlterInput(3));
  const evidence = evidenceCore.record(project, {
    evidenceType: "DATA_MIGRATION", command: "independent migration test", result: "PASSED", exitCode: 0, truthState: "VERIFIED",
    files: ["app.sqlite"], details: { migrationTestId: tested.migrationTestId, migratedHash: tested.migratedHash }
  });
  data.attachEvidence(tested.migrationTestId, evidence.evidenceId);
  const db = new DatabaseSync(databasePath);
  db.prepare("INSERT INTO users(id,name,api_token) VALUES(?,?,?)").run(4, "Changed", "secret-4");
  db.close();
  await assert.rejects(data.applyMigration("app.sqlite", tested.migrationTestId), (error) => error.code === "DATA_EVIDENCE_NEEDS_RETEST");
});

test("rutas enlazadas, metadatos enlazados y manifests corruptos se rechazan sin borrarlos", { skip: process.platform === "win32" }, async (context) => {
  const { root, data } = fixture(context, "data_links");
  createDatabase(root);
  const outside = temporary(context, "dorn-data-outside-");
  const externalDatabase = createDatabase(outside, "outside.sqlite");
  fs.symlinkSync(externalDatabase, path.join(root, "linked.sqlite"));
  assert.throws(() => data.schema("linked.sqlite"), (error) => error.code === "DATA_PATH_OUTSIDE_PROJECT");

  const snapshots = path.join(root, ".dorn", "tasks", "data-intelligence", "snapshots");
  fs.symlinkSync(outside, snapshots);
  await assert.rejects(data.currentSnapshot("app.sqlite"), (error) => error.code === "DATA_METADATA_UNSAFE");
  fs.unlinkSync(snapshots);

  const tested = await data.testMigration("app.sqlite", safeAlterInput(3));
  const manifestPath = data.manifestPath(tested.migrationTestId);
  fs.writeFileSync(manifestPath, "{invalid-json");
  assert.throws(() => data.getMigrationTest(tested.migrationTestId), (error) => error.code === "DATA_MIGRATION_MANIFEST_CORRUPT");
  assert.equal(fs.readFileSync(manifestPath, "utf8"), "{invalid-json");
});

test("Manager mantiene aislamiento A→B→A por identidad de proyecto", (context) => {
  const projectCore = new ProjectCore();
  const evidenceCore = new EvidenceCore();
  context.after(() => evidenceCore.closeAll());
  const roots = [temporary(context, "dorn-data-a-"), temporary(context, "dorn-data-b-")];
  const projects = roots.map((root, index) => {
    const id = `data_${index === 0 ? "a" : "b"}`;
    projectCore.adopt(root, { projectId: id, name: id });
    createDatabase(root);
    return { id, name: id, rootPath: root };
  });
  const manager = new DataIntelligenceManager({ projectCore, evidenceCore });
  const firstA = manager.forProject(projects[0]);
  const instanceB = manager.forProject(projects[1]);
  const secondA = manager.forProject(projects[0]);
  assert.equal(firstA, secondA);
  assert.notEqual(firstA, instanceB);
  assert.equal(firstA.schema("app.sqlite").projectId, "data_a");
  assert.equal(instanceB.schema("app.sqlite").projectId, "data_b");
  manager.closeAll();
});

test("la paginación conserva memoria acotada con 100.000 filas", (context) => {
  const { root, data } = fixture(context, "data_scale");
  createDatabase(root, "large.sqlite", 100_000);
  const before = process.memoryUsage().heapUsed;
  const page = data.queryPage("large.sqlite", { table: "users", key: "id", limit: 50, cursor: 99_900, columns: ["id", "name", "api_token"] });
  const growth = process.memoryUsage().heapUsed - before;
  assert.equal(page.rows.length, 50);
  assert.equal(page.rows[0].id, 99_901);
  assert.equal(page.rows[0].api_token, "[REDACTED]");
  assert.ok(growth < 32 * 1024 * 1024, `La consulta creció ${growth} bytes de heap.`);
});

test("Data Intelligence queda interno al main y no entrega SQLite o migraciones al renderer", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(main, /const \{ DataIntelligenceManager \} = require\("\.\/dorn-core\/data-intelligence"\)/);
  assert.match(main, /dataIntelligence = new DataIntelligenceManager\(\{ projectCore, evidenceCore, eventBus \}\)/);
  for (const event of ["DATA_MIGRATION_TESTED", "DATA_MIGRATION_APPLIED", "DATA_MIGRATION_RESTORED"]) assert.match(main, new RegExp(event));
  assert.doesNotMatch(preload, /dataIntelligence|dataMigration|DatabaseSync|node:sqlite/);
});
