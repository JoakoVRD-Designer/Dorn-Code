"use strict";

const crypto = require("node:crypto");

const PRIORITIES = Object.freeze({ INTERACTIVE: 0, HIGH: 1, NORMAL: 2, BACKGROUND: 3, MAINTENANCE: 4 });

class DornEventBus {
  constructor(options = {}) {
    this.maxTrace = Math.max(100, Math.min(10000, Number(options.maxTrace) || 2000));
    this.onDiagnostic = typeof options.onDiagnostic === "function" ? options.onDiagnostic : () => {};
  }

  schemas = new Map();
  subscribers = new Map();
  seen = new Map();
  sequences = new Map();
  trace = [];
  maxTrace;
  onDiagnostic;

  register(type, definition = {}) {
    const name = String(type || "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_.-]{2,79}$/.test(name)) throw new Error("El tipo de evento no cumple el schema de DORN.");
    const version = Math.max(1, Number(definition.version) || 1);
    this.schemas.set(name, { version, validate: typeof definition.validate === "function" ? definition.validate : null });
    return this;
  }

  subscribe(type, consumerId, handler, options = {}) {
    const name = String(type || "*").trim().toUpperCase();
    if (typeof handler !== "function") throw new TypeError("El consumidor del Event Bus debe ser una función.");
    const record = {
      id: String(consumerId || crypto.randomUUID()),
      handler,
      versions: Array.isArray(options.versions) ? new Set(options.versions.map(Number)) : null,
      retry: Math.max(0, Math.min(3, Number(options.retry) || 0))
    };
    if (!this.subscribers.has(name)) this.subscribers.set(name, new Map());
    this.subscribers.get(name).set(record.id, record);
    return () => this.subscribers.get(name)?.delete(record.id);
  }

  async publish(type, payload = {}, meta = {}) {
    const name = String(type || "").trim().toUpperCase();
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Evento sin schema registrado: ${name || "(vacío)"}.`);
    const version = Number(meta.version || schema.version);
    if (version !== schema.version) throw new Error(`Versión no soportada para ${name}: ${version}.`);
    if (schema.validate && schema.validate(payload) !== true) throw new Error(`Payload inválido para ${name}.`);

    this.pruneSeen();
    const idempotencyKey = String(meta.idempotencyKey || meta.eventId || crypto.randomUUID());
    const duplicate = this.seen.get(idempotencyKey);
    if (duplicate) return { ...duplicate, duplicate: true };

    const stream = [meta.projectId || "-", meta.conversationId || "-", meta.jobId || "-", name].join(":");
    const previousSequence = this.sequences.get(stream) || 0;
    const sequence = Number(meta.sequence || previousSequence + 1);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error(`Secuencia inválida para ${name}.`);
    if (sequence <= previousSequence) {
      const discarded = { status: "DISCARDED_OUT_OF_ORDER", eventId: String(meta.eventId || crypto.randomUUID()), type: name, sequence };
      this.record(discarded);
      return discarded;
    }
    this.sequences.set(stream, sequence);

    const event = Object.freeze({
      schema: "dorn.event/1",
      eventId: String(meta.eventId || crypto.randomUUID()),
      idempotencyKey,
      type: name,
      version,
      sequence,
      timestamp: new Date().toISOString(),
      priority: Object.hasOwn(PRIORITIES, meta.priority) ? meta.priority : "NORMAL",
      projectId: meta.projectId || null,
      conversationId: meta.conversationId || null,
      jobId: meta.jobId || null,
      payload: structuredClone(payload)
    });
    const result = { status: "PUBLISHED", eventId: event.eventId, type: name, sequence, consumed: 0, failures: [] };
    this.seen.set(idempotencyKey, { ...result, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    this.record(event);

    const consumers = [
      ...(this.subscribers.get(name)?.values() || []),
      ...(this.subscribers.get("*")?.values() || [])
    ].filter((consumer) => !consumer.versions || consumer.versions.has(version));
    for (const consumer of consumers) {
      let lastError = null;
      for (let attempt = 0; attempt <= consumer.retry; attempt += 1) {
        try {
          await consumer.handler(event);
          lastError = null;
          result.consumed += 1;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) {
        const failure = { consumerId: consumer.id, message: String(lastError.message || lastError), status: "DEAD_LETTER" };
        result.failures.push(failure);
        this.onDiagnostic({ event, failure });
      }
    }
    this.seen.set(idempotencyKey, { ...result, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    return result;
  }

  record(entry) {
    this.trace.push(entry);
    if (this.trace.length > this.maxTrace) this.trace.splice(0, this.trace.length - this.maxTrace);
  }

  recent(limit = 100) {
    return structuredClone(this.trace.slice(-Math.max(1, Math.min(500, Number(limit) || 100))));
  }

  pruneSeen() {
    const timestamp = Date.now();
    for (const [key, value] of this.seen) if (value.expiresAt < timestamp) this.seen.delete(key);
  }
}

module.exports = { DornEventBus, PRIORITIES };
