"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DornEventBus } = require("../out/main/dorn-core/event-bus");
const { StateCore } = require("../out/main/dorn-core/state-core");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("State Core descarta una carga A tardía después de activar B", async () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-state-race-"));
  try {
    const bus = new DornEventBus();
    bus.register("CONVERSATION_CHANGED", { validate: (payload) => Boolean(payload?.active?.conversationId) });
    bus.register("PROJECT_CONTEXT_READY", { validate: (payload) => payload && Object.hasOwn(payload, "workingSetId") });
    const conversations = new Map([
      ["conversation-a", { id: "conversation-a", projectId: "project-a" }],
      ["conversation-b", { id: "conversation-b", projectId: "project-b" }],
      ["conversation-null", { id: "conversation-null", projectId: null }]
    ]);
    const state = new StateCore({
      filePath: path.join(stateRoot, "state.json"),
      eventBus: bus,
      resolveConversation: async (id) => conversations.get(id)
    });
    let releaseA;
    const slowA = state.selectConversation("conversation-a", {
      load: () => new Promise((resolve) => { releaseA = resolve; })
    });
    await new Promise((resolve) => setImmediate(resolve));
    const quickB = await state.selectConversation("conversation-b", { load: async () => ({ id: "working-b" }) });
    releaseA({ id: "working-a" });
    assert.equal((await slowA).stale, true);
    assert.equal(quickB.state.active.projectId, "project-b");
    assert.equal(state.snapshot().active.workingSetId, "working-b");
    assert.throws(() => state.assertScope({ conversationId: "conversation-a" }), /scope activo/);
    await state.selectConversation("conversation-null");
    assert.equal(state.snapshot().active.projectId, null);
    assert.equal(state.snapshot().active.status, "NO_PROJECT");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("State Core persiste Jobs pero nunca reactiva silenciosamente el scope de una sesión anterior", async () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-state-restore-"));
  const filePath = path.join(stateRoot, "state.json");
  try {
    const first = new StateCore({ filePath, resolveConversation: async (id) => ({ id, projectId: "project-a" }) });
    await first.selectConversation("conversation-a");
    first.bindJob({ id: "job-a", projectId: "project-a", conversationId: "conversation-a", state: "RUNNING" });
    const restored = new StateCore({ filePath });
    assert.equal(restored.snapshot().active.conversationId, null);
    assert.equal(restored.snapshot().active.status, "NO_PROJECT");
    assert.equal(restored.snapshot().jobs["job-a"].projectId, "project-a");
    assert.equal(restored.snapshot().jobs["job-a"].state, "RUNNING");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("Event Bus valida, deduplica, ordena, reintenta y aísla fallos", async () => {
  const diagnostics = [];
  const bus = new DornEventBus({ onDiagnostic: (entry) => diagnostics.push(entry) });
  bus.register("FILE_MODIFIED", { version: 1, validate: (payload) => Boolean(payload.relativePath) });
  let consumed = 0;
  let retryAttempts = 0;
  bus.subscribe("FILE_MODIFIED", "index", async (event) => {
    consumed += 1;
    assert.equal(event.payload.relativePath, "src/a.js");
  });
  bus.subscribe("FILE_MODIFIED", "retry", async () => {
    retryAttempts += 1;
    if (retryAttempts === 1) throw new Error("temporal");
  }, { retry: 1 });
  bus.subscribe("FILE_MODIFIED", "broken", async () => { throw new Error("fallo aislado"); });
  const payload = { relativePath: "src/a.js" };
  const first = await bus.publish("FILE_MODIFIED", payload, { projectId: "p", sequence: 1, idempotencyKey: "same" });
  payload.relativePath = "mutated-after-publish.js";
  const duplicate = await bus.publish("FILE_MODIFIED", { relativePath: "src/a.js" }, { projectId: "p", sequence: 1, idempotencyKey: "same" });
  const old = await bus.publish("FILE_MODIFIED", { relativePath: "src/b.js" }, { projectId: "p", sequence: 1, idempotencyKey: "old" });
  assert.equal(first.consumed, 2);
  assert.equal(first.failures.length, 1);
  assert.equal(first.failures[0].status, "DEAD_LETTER");
  assert.equal(duplicate.duplicate, true);
  assert.equal(old.status, "DISCARDED_OUT_OF_ORDER");
  assert.equal(consumed, 1);
  assert.equal(retryAttempts, 2);
  assert.equal(diagnostics.length, 1);
  assert.equal(bus.recent(10)[0].payload.relativePath, "src/a.js");
  await assert.rejects(() => bus.publish("FILE_MODIFIED", {}, { projectId: "p" }), /Payload inválido/);
  await assert.rejects(() => bus.publish("NOT_REGISTERED", {}, {}), /sin schema/);
  await assert.rejects(() => bus.publish("FILE_MODIFIED", { relativePath: "x" }, { sequence: -1 }), /Secuencia inválida/);
});

test("la integración activa scope al abrir una conversación sin sustituir el renderer 4.0", () => {
  const main = read("out/main/index.js");
  const preload = read("out/preload/index.js");
  assert.match(main, /new DornEventBus\(/);
  assert.match(main, /new StateCore\(/);
  assert.match(main, /stateCore\.selectConversation\(conversation\.id,\s*\{/);
  assert.match(main, /stateCore:\s*stateCore\.snapshot\(\)/);
  assert.match(main, /dorn:core_events_recent/);
  assert.match(preload, /core:\s*\{/);
  assert.match(preload, /recentEvents: \(limit = 100\)/);
  assert.doesNotMatch(main, /out\/renderer.*4\.9|PRE-IDE.*renderer/i);
});
