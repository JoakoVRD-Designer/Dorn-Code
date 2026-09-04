"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DeveloperSecurity } = require("../out/main/dorn-suite/developer-security");
const { CreationRuntime, CATEGORY } = require("../out/main/dorn-suite/creation-runtime");
const { DornAdminClient } = require("../out/main/dorn-suite/auth-client");
const { createDornV3Core, PERMISSION_KEYS } = require("../out/main/dorn-v3-core");
const adminServerModule = path.resolve(__dirname, "../../DORN_Admin_Permanent_1.0.0-alpha.4_Editable/out/server.js");
const adminIntegrationAvailable = fs.existsSync(adminServerModule);
const DornAdminServer = adminIntegrationAvailable ? require(adminServerModule).DornAdminServer : null;

class TestEmail {
  constructor() { this.messages = []; }
  status() { return { provider: "test", configured: true, state: "connected", lastCheckedAt: new Date().toISOString(), lastError: "" }; }
  async sendCode(message) { this.messages.push({ ...message }); return { accepted: true }; }
  latest(to, purpose) { return this.messages.filter((entry) => entry.to === to && entry.purpose === purpose).at(-1)?.code; }
}

test("Alpha 7 conserva la autenticación futura pero la mantiene oculta por defecto", () => {
  const html = fs.readFileSync(path.join(__dirname, "../out/renderer/index.html"), "utf8");
  const featureFlags = fs.readFileSync(path.join(__dirname, "../out/renderer/vendor/dorn-feature-flags.js"), "utf8");
  const auth = fs.readFileSync(path.join(__dirname, "../out/renderer/vendor/dorn-auth.js"), "utf8");
  const splash = fs.readFileSync(path.join(__dirname, "../resources/startup/splash.html"), "utf8");
  assert.match(html, /dorn-feature-flags\.js/);
  assert.match(html, /dorn-auth\.js/);
  assert.doesNotMatch(html, /<script type="module"[^>]+index-CBtOwcb-/);
  assert.match(featureFlags, /accountAuthentication:\s*false/);
  assert.match(featureFlags, /accountControls:\s*false/);
  assert.match(auth, /if \(!authenticationEnabled\) \{\s*loadApplication\(\);\s*return;/);
  assert.doesNotMatch(splash, /product-mark/);
  for (const icon of ["ai", "design", "editor", "education", "machine", "studio3d"]) {
    assert.ok(fs.statSync(path.join(__dirname, `../resources/startup/icons/${icon}-v4.png`)).size > 500);
  }
});

test("DORN reconoce archivos comprimidos, imágenes, audio, video y documentos", () => {
  assert.deepEqual(CATEGORY[".zip"], ["archive", "application/zip"]);
  assert.equal(CATEGORY[".png"][0], "image");
  assert.equal(CATEGORY[".mp3"][0], "audio");
  assert.equal(CATEGORY[".mp4"][0], "video");
  assert.equal(CATEGORY[".docx"][0], "document");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-results-"));
  try {
    for (const name of ["resultado.png", "audio.mp3", "paquete.zip"]) fs.writeFileSync(path.join(root, name), `fixture:${name}`);
    const project = { id: "project-alpha5", name: "Alpha 5", rootPath: root };
    const runtime = new CreationRuntime({ database: { listProjects: () => [project] }, shell: {}, stateRoot: root });
    assert.equal(runtime.scanProject(project).files, 3);
    const listed = runtime.list({ limit: 10 });
    assert.equal(listed.find((entry) => entry.category === "audio").previewUrl.startsWith("dorn-result://"), true);
    assert.equal(listed.find((entry) => entry.category === "archive").previewUrl, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Desarrollador guarda sólo autorización de solicitud y la revoca al desactivarse", { skip: process.platform === "win32" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-developer-"));
  try {
    const security = new DeveloperSecurity({ stateRoot: root, dialog: { showMessageBox: async () => ({ response: 1 }) }, parentWindow: () => undefined });
    const enabled = await security.setEnabled(true);
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.uacRequestAuthorized, true);
    assert.equal(enabled.permanentUacTokenStored, false);
    assert.equal(enabled.approvalScope, "task-or-console");
    assert.equal(enabled.fullAccess, true);
    const projectRoot = path.join(root, "project");
    fs.mkdirSync(projectRoot);
    const core = createDornV3Core({ database: { getProject: () => ({ id: "full", rootPath: projectRoot, permissionMode: "advisor" }), audit: () => {} }, userDataPath: root, developerSecurity: security });
    assert.equal(PERMISSION_KEYS.every((key) => core.permissions("full")[key] === true), true);
    assert.equal(security.commandNeedsElevation("winget install Git.Git"), true);
    const disabled = await security.setEnabled(false);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.uacRequestAuthorized, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("una identidad DORN AI sirve a toda la suite y no colisiona con el operador de DORN Admin", { skip: !adminIntegrationAvailable }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-auth-alpha5-"));
  const email = new TestEmail();
  const server = new DornAdminServer({ host: "127.0.0.1", port: 0, databasePath: path.join(root, "admin.sqlite"), emailService: email, codeSecret: "prueba-integracion-alpha6" });
  await server.start();
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString("utf8") };
  const client = new DornAdminClient({ stateRoot: path.join(root, "client"), version: "4.0.0-alpha.7", safeStorage, openExternal: async () => {} });
  try {
    const sharedEmail = "misma.persona@dorn.test";
    const repeatedName = "Joaquín";
    const owner = server.bootstrapOwner({ email: sharedEmail, password: "claveadministrativa2026", displayName: repeatedName });
    const invitation = server.createInvitation({ userId: owner.user.id }, { maxUses: 1 });
    await client.configureServer(server.address().url);
    const pending = await client.register({ email: sharedEmail, password: "claveusuario2026", displayName: repeatedName, invitationCode: invitation.code, maintainSession: true });
    assert.equal(pending.verificationRequired, true);
    const status = await client.verifyEmail({ email: sharedEmail, code: email.latest(sharedEmail, "verify_email"), maintainSession: true });
    assert.equal(status.authenticated, true);
    assert.equal(status.user.accountScope, "dorn_ai");
    await client.sendPresence("away");
    await client.reportError({ kind: "test", message: "error sin conversación", stack: "stack" });
    const snapshot = server.adminSnapshot(server.sessionFromToken(owner.token));
    assert.equal(snapshot.counts.users, 2);
    assert.equal(snapshot.counts.errors, 1);
    assert.equal(snapshot.users.filter((user) => user.email === sharedEmail).length, 2);
    assert.deepEqual(snapshot.users.filter((user) => user.email === sharedEmail).map((user) => user.account_scope).sort(), ["dorn_admin", "dorn_ai"]);
    assert.equal(snapshot.users.find((user) => user.account_scope === "dorn_ai").status, "away");
  } finally {
    await client.stop();
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
