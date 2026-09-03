"use strict";

const fs = require("node:fs");
const { atomicJson } = require("../dorn-suite/common");

class StateCore {
  constructor(options = {}) {
    this.filePath = options.filePath || null;
    this.eventBus = options.eventBus || null;
    this.resolveConversation = typeof options.resolveConversation === "function" ? options.resolveConversation : null;
    this.state = this.restore();
  }

  filePath;
  eventBus;
  resolveConversation;
  generation = 0;
  state;

  restore() {
    let stored = {};
    try {
      if (this.filePath && fs.existsSync(this.filePath)) stored = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      stored = {};
    }
    const jobs = stored.jobs && typeof stored.jobs === "object" && !Array.isArray(stored.jobs) ? stored.jobs : {};
    return {
      schema: "dorn.state/1",
      lifecycle: "CORE_READY",
      active: { conversationId: null, projectId: null, workingSetId: null, status: "NO_PROJECT", generation: 0 },
      jobs: structuredClone(jobs),
      updatedAt: new Date().toISOString()
    };
  }

  snapshot() {
    return structuredClone(this.state);
  }

  persist() {
    this.state.updatedAt = new Date().toISOString();
    if (this.filePath) atomicJson(this.filePath, this.state);
  }

  async selectConversation(conversationId, hooks = {}) {
    const requestedId = String(conversationId || "").trim();
    if (!requestedId || requestedId.length > 160) throw new Error("State Core recibió una conversación inválida.");
    const generation = ++this.generation;
    const previous = { ...this.state.active };
    this.state.active = { ...previous, status: "SWITCHING", generation };
    const conversation = this.resolveConversation ? await this.resolveConversation(requestedId) : { id: requestedId, projectId: null };
    if (!conversation || String(conversation.id) !== requestedId) throw new Error("State Core no pudo resolver la conversación solicitada.");
    if (generation !== this.generation) return { stale: true, state: this.snapshot() };

    if (previous.workingSetId && typeof hooks.unload === "function") {
      this.state.active.status = "UNLOADING";
      await hooks.unload(previous);
      if (generation !== this.generation) return { stale: true, state: this.snapshot() };
    }

    const projectId = conversation.projectId || null;
    this.state.active = {
      conversationId: requestedId,
      projectId,
      workingSetId: null,
      status: projectId ? "LOADING" : "NO_PROJECT",
      generation
    };
    if (projectId && typeof hooks.load === "function") {
      const workingSet = await hooks.load({ projectId, conversationId: requestedId, generation });
      if (generation !== this.generation) return { stale: true, state: this.snapshot() };
      this.state.active.workingSetId = workingSet?.id || `${projectId}:${generation}`;
      this.state.active.status = "READY";
    } else if (projectId) {
      this.state.active.status = "PROJECT_BOUND";
    }
    this.persist();
    await this.emit("CONVERSATION_CHANGED", { previous, active: this.state.active }, {
      conversationId: requestedId,
      projectId,
      idempotencyKey: `conversation:${requestedId}:${generation}`
    });
    if (projectId) {
      await this.emit("PROJECT_CONTEXT_READY", { workingSetId: this.state.active.workingSetId }, {
        conversationId: requestedId,
        projectId,
        idempotencyKey: `context:${requestedId}:${generation}`
      });
    }
    return { stale: false, state: this.snapshot() };
  }

  bindJob(job) {
    if (!job?.id) throw new Error("El Job necesita una identidad estable.");
    const previous = this.state.jobs[job.id] || {};
    this.state.jobs[job.id] = {
      ...previous,
      jobId: String(job.id),
      projectId: job.projectId || previous.projectId || null,
      conversationId: job.conversationId || previous.conversationId || null,
      state: job.state || previous.state || "QUEUED",
      updatedAt: new Date().toISOString()
    };
    this.persist();
    return { ...this.state.jobs[job.id] };
  }

  assertScope(scope = {}) {
    if (scope.conversationId && scope.conversationId !== this.state.active.conversationId) throw new Error("La conversación ya no es el scope activo.");
    if (scope.projectId !== undefined && scope.projectId !== this.state.active.projectId) throw new Error("El proyecto no pertenece al scope activo.");
    if (scope.generation !== undefined && Number(scope.generation) !== this.state.active.generation) throw new Error("Resultado async obsoleto descartado por State Core.");
    return true;
  }

  async emit(type, payload, meta) {
    if (!this.eventBus) return null;
    return this.eventBus.publish(type, payload, meta);
  }
}

module.exports = { StateCore };
