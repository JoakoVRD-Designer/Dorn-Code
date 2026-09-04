"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectCore } = require("../out/main/dorn-core/project-core");
const { EvidenceCore, inspectScreenshot, sourceHash } = require("../out/main/dorn-core/evidence-core");

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function temporary(context, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function adopted(context, id = "evidence_project") {
  const root = temporary(context, `dorn-${id}-`);
  const projects = new ProjectCore();
  projects.adopt(root, { projectId: id, name: id });
  const project = { id, name: id, rootPath: root };
  const evidence = new EvidenceCore();
  context.after(() => evidence.closeAll());
  return { root, project, projects, evidence };
}

function passInput(overrides = {}) {
  return {
    evidenceType: "COMMAND",
    command: "node --test",
    result: "PASSED",
    exitCode: 0,
    truthState: "VERIFIED",
    ...overrides
  };
}

function digest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("Evidence enlaza requisito y prueba al hash exacto, y degrada la verdad al mutar la fuente", (context) => {
  const { root, project, evidence } = adopted(context, "source_mutation");
  fs.writeFileSync(path.join(root, "feature.js"), "export const state = 'verified';\n");
  const recorded = evidence.record(project, passInput({
    files: ["feature.js"],
    requirements: ["PDF-CURRENT-REQ-001"],
    tests: ["feature.test.cjs"]
  }));
  assert.equal(recorded.truthState, "VERIFIED");
  assert.equal(recorded.sourceComplete, true);
  assert.equal(evidence.evaluate(project, recorded.evidenceId).truthState, "VERIFIED");
  assert.equal(evidence.lineage(project, { reference: "PDF-CURRENT-REQ-001" }).entries[0].evidenceId, recorded.evidenceId);

  fs.writeFileSync(path.join(root, "feature.js"), "export const state = 'changed-after-test';\n");
  const evaluated = evidence.evaluate(project, recorded.evidenceId);
  assert.equal(evaluated.truthState, "NEEDS_RETEST");
  assert.notEqual(evaluated.currentSourceHash, recorded.sourceHash);
  assert.equal(evidence.status(project).needsRetest, 1);
});

test("Evidence bloquea hashes falsos y rutas inseguras, y nunca verifica un alcance incompleto", { skip: process.platform === "win32" }, (context) => {
  const { root, project, evidence } = adopted(context, "unsafe_scope");
  fs.writeFileSync(path.join(root, "safe.txt"), "safe\n");
  assert.throws(
    () => evidence.record(project, passInput({ files: ["safe.txt"], sourceHash: "0".repeat(64) })),
    (error) => error.code === "EVIDENCE_SOURCE_HASH_MISMATCH"
  );
  assert.throws(() => evidence.record(project, passInput({ files: [path.join(root, "safe.txt")] })), (error) => error.code === "EVIDENCE_PATH_UNSAFE");
  assert.throws(() => evidence.record(project, passInput({ files: ["folder/../safe.txt"] })), (error) => error.code === "EVIDENCE_PATH_UNSAFE");
  assert.throws(() => evidence.record(project, passInput({ files: ["./safe.txt"] })), (error) => error.code === "EVIDENCE_PATH_UNSAFE");

  const unscoped = evidence.record(project, passInput({ sourceHash: "1".repeat(64) }));
  assert.equal(unscoped.sourceComplete, false);
  assert.equal(unscoped.truthState, "TESTED");

  const missing = evidence.record(project, passInput({ files: ["missing.txt"] }));
  assert.equal(missing.sourceComplete, false);
  assert.equal(missing.truthState, "TESTED");

  const outside = path.join(temporary(context, "dorn-evidence-outside-"), "secret.txt");
  fs.writeFileSync(outside, "outside\n");
  fs.symlinkSync(outside, path.join(root, "linked.txt"));
  const linked = evidence.record(project, passInput({ files: ["linked.txt"] }));
  assert.equal(linked.sourceComplete, false);
  assert.equal(linked.truthState, "TESTED");
  assert.throws(() => evidence.record(project, passInput({ artifactRefs: [{ relativePath: "linked.txt" }] })), (error) => error.code === "EVIDENCE_ARTIFACT_UNSAFE");
});

test("la verificación visual exige una captura real completa y detecta su reemplazo", (context) => {
  const { root, project, evidence } = adopted(context, "visual_capture");
  assert.throws(
    () => evidence.record(project, passInput({ evidenceType: "VISUAL_REGRESSION" })),
    (error) => error.code === "EVIDENCE_SCREENSHOT_REQUIRED"
  );
  const screenshotPath = path.join(root, "capture.png");
  fs.writeFileSync(screenshotPath, PNG_1X1);
  const inspected = inspectScreenshot(root, { relativePath: "capture.png", source: "REAL_BROWSER_CAPTURE", route: "dorn://settings" });
  assert.equal(inspected.width, 1);
  assert.equal(inspected.height, 1);
  const recorded = evidence.record(project, passInput({
    evidenceType: "VISUAL_REGRESSION",
    screenshot: { relativePath: "capture.png", source: "REAL_BROWSER_CAPTURE", route: "dorn://settings" }
  }));
  assert.equal(recorded.truthState, "VERIFIED");
  fs.writeFileSync(screenshotPath, Buffer.from("not-an-image"));
  const evaluated = evidence.evaluate(project, recorded.evidenceId);
  assert.equal(evaluated.truthState, "NEEDS_RETEST");
  assert.match(evaluated.screenshotError, /Screenshot/);
});

test("Evidence vuelve a inspeccionar cada artefacto local antes de mantener VERIFIED", (context) => {
  const { root, project, evidence } = adopted(context, "artifact_mutation");
  const artifactPath = path.join(root, "output.bin");
  fs.writeFileSync(artifactPath, Buffer.from("verified-output"));
  const recorded = evidence.record(project, passInput({ artifactRefs: [{ relativePath: "output.bin", kind: "binary" }] }));
  assert.equal(recorded.truthState, "VERIFIED");
  assert.equal(recorded.artifactRefs[0].sha256, digest(artifactPath));
  fs.writeFileSync(artifactPath, Buffer.from("changed-output"));
  const evaluated = evidence.evaluate(project, recorded.evidenceId);
  assert.equal(evaluated.truthState, "NEEDS_RETEST");
  assert.match(evaluated.artifactError, /hash declarado/);
});

test("la base Evidence queda ligada a la identidad y rechaza metadatos enlazados", { skip: process.platform === "win32" }, (context) => {
  const first = adopted(context, "identity_a");
  fs.writeFileSync(path.join(first.root, "source.txt"), "source\n");
  first.evidence.record(first.project, passInput({ files: ["source.txt"] }));
  first.evidence.closeAll();
  const manifestPath = path.join(first.root, ".dorn", "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, projectId: "identity_b" }, null, 2));
  const reopened = new EvidenceCore();
  context.after(() => reopened.closeAll());
  assert.throws(
    () => reopened.status({ id: "identity_b", rootPath: first.root }),
    (error) => error.code === "EVIDENCE_PROJECT_IDENTITY_MISMATCH"
  );

  const linkedDirectory = adopted(context, "linked_directory");
  linkedDirectory.evidence.closeAll();
  const outsideDirectory = temporary(context, "dorn-evidence-dir-outside-");
  fs.rmSync(path.join(linkedDirectory.root, ".dorn", "evidence"), { recursive: true });
  fs.symlinkSync(outsideDirectory, path.join(linkedDirectory.root, ".dorn", "evidence"), "dir");
  assert.throws(() => new EvidenceCore().status(linkedDirectory.project), (error) => error.code === "EVIDENCE_METADATA_UNSAFE");
  assert.deepEqual(fs.readdirSync(outsideDirectory), []);

  const linkedDatabase = adopted(context, "linked_database");
  linkedDatabase.evidence.closeAll();
  const outsideDatabase = path.join(temporary(context, "dorn-evidence-db-outside-"), "outside.db");
  fs.writeFileSync(outsideDatabase, "do not touch");
  fs.symlinkSync(outsideDatabase, path.join(linkedDatabase.root, ".dorn", "evidence", "evidence.db"));
  assert.throws(() => new EvidenceCore().status(linkedDatabase.project), (error) => error.code === "EVIDENCE_METADATA_UNSAFE");
  assert.equal(fs.readFileSync(outsideDatabase, "utf8"), "do not touch");
});

test("un índice heredado corrupto se rechaza sin sobrescribir sus bytes", (context) => {
  const { root, project, evidence } = adopted(context, "legacy_corrupt");
  const legacyPath = path.join(root, ".dorn", "evidence", "index.json");
  fs.writeFileSync(legacyPath, "{not-json");
  const before = digest(legacyPath);
  assert.throws(() => evidence.status(project), (error) => error.code === "EVIDENCE_LEGACY_INVALID");
  assert.equal(digest(legacyPath), before);
});

test("sourceHash es determinista, ordenado y marca ausencias sin inventar aprobación", (context) => {
  const { root } = adopted(context, "source_hash");
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  fs.writeFileSync(path.join(root, "b.txt"), "b\n");
  const left = sourceHash(root, { files: ["b.txt", "a.txt", "a.txt"] });
  const right = sourceHash(root, { files: ["a.txt", "b.txt"] });
  assert.equal(left.hash, right.hash);
  assert.deepEqual(left.sourceFiles, ["a.txt", "b.txt"]);
  assert.equal(left.complete, true);
  assert.equal(sourceHash(root, { files: ["missing.txt"] }).complete, false);
});

test("la aplicación expone Evidence por proyecto sin reemplazar ni privilegiar el renderer 4.0", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "out", "preload", "index.js"), "utf8");
  assert.match(main, /const \{ EvidenceCore \} = require\("\.\/dorn-core\/evidence-core"\)/);
  assert.match(main, /evidenceCore = new EvidenceCore\(\{ eventBus \}\)/);
  assert.match(main, /eventBus\.register\("EVIDENCE_RECORDED"/);
  assert.match(main, /handle\("dorn:evidence_record"/);
  assert.match(main, /handle\("dorn:evidence_evaluate"/);
  assert.match(main, /handle\("dorn:evidence_status"/);
  assert.match(main, /handle\("dorn:evidence_lineage"/);
  assert.match(main, /evidenceCore\?\.closeAll\(\)/);
  assert.match(preload, /evidence:\s*\{/);
  assert.match(preload, /record: \(projectId, input\) => electron\.ipcRenderer\.invoke\("dorn:evidence_record"/);
  assert.match(preload, /evaluate: \(projectId, evidenceId\) => electron\.ipcRenderer\.invoke\("dorn:evidence_evaluate"/);
  assert.doesNotMatch(preload, /DatabaseSync|evidence\.db|node:fs/);
  assert.doesNotMatch(main, /PRE-IDE.*renderer|renderer.*4\.9/i);
});
