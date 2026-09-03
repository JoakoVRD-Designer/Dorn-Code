"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const {
  DornSuiteError,
  atomicJson,
  readJson,
  similarity,
  now
} = require("./common");

const MODES = {
  automatic: {
    id: "automatic",
    label: "Automático",
    localFirst: true,
    allowExternalProviders: true,
    telemetry: false,
    sync: false,
    maxAgents: 3,
    maxIterations: 2,
    maxTools: 12,
    maxFiles: 40,
    timeBudgetSeconds: 300,
    tokenBudget: 12000,
    parallel: false,
    unloadHeavyOnBattery: true
  },
  manual: {
    id: "manual",
    label: "Manual",
    localFirst: false,
    allowExternalProviders: true,
    telemetry: false,
    sync: false,
    maxAgents: 1,
    maxIterations: 1,
    maxTools: 20,
    maxFiles: 80,
    timeBudgetSeconds: 600,
    tokenBudget: 24000,
    parallel: false,
    unloadHeavyOnBattery: false
  },
  economic: {
    id: "economic",
    label: "Económico",
    localFirst: true,
    allowExternalProviders: true,
    telemetry: false,
    sync: false,
    maxAgents: 2,
    maxIterations: 1,
    maxTools: 8,
    maxFiles: 24,
    timeBudgetSeconds: 180,
    tokenBudget: 6000,
    parallel: false,
    unloadHeavyOnBattery: true
  },
  private: {
    id: "private",
    label: "Privado",
    localFirst: true,
    allowExternalProviders: false,
    telemetry: false,
    sync: false,
    maxAgents: 2,
    maxIterations: 2,
    maxTools: 10,
    maxFiles: 30,
    timeBudgetSeconds: 300,
    tokenBudget: 10000,
    parallel: false,
    unloadHeavyOnBattery: true
  },
  performance: {
    id: "performance",
    label: "Máximo rendimiento",
    localFirst: false,
    allowExternalProviders: true,
    telemetry: false,
    sync: false,
    maxAgents: 6,
    maxIterations: 3,
    maxTools: 24,
    maxFiles: 100,
    timeBudgetSeconds: 900,
    tokenBudget: 48000,
    parallel: true,
    unloadHeavyOnBattery: false
  },
  battery: {
    id: "battery",
    label: "Batería",
    localFirst: true,
    allowExternalProviders: true,
    telemetry: false,
    sync: false,
    maxAgents: 1,
    maxIterations: 1,
    maxTools: 6,
    maxFiles: 16,
    timeBudgetSeconds: 120,
    tokenBudget: 4000,
    parallel: false,
    unloadHeavyOnBattery: true
  }
};

const RESPONSE_STRATEGIES = {
  single: {
    id: "single",
    label: "Una IA por respuesta",
    description: "DORN usa una sola conexión y conserva el cambio automático entre claves equivalentes únicamente como respaldo ante cuota o error.",
    maxProviders: 1,
    confirmationRequired: false
  },
  multi: {
    id: "multi",
    label: "Varias IAs por respuesta",
    description: "DORN coordina entre 2 y 4 motores distintos y pide confirmación antes de realizar varias llamadas de API.",
    maxProviders: 4,
    confirmationRequired: true
  }
};

class ModeManager {
  constructor(stateRoot) {
    this.filePath = path.join(stateRoot, "modes.json");
    this.state = readJson(this.filePath, {
      globalMode: "automatic",
      projects: {},
      responseStrategy: "single",
      projectStrategies: {},
      schemaVersion: 3,
      updatedAt: now()
    });
    if (this.state.schemaVersion !== 3) {
      const legacyTeam = this.state.globalMode === "team" || Object.values(this.state.projects || {}).includes("team");
      if (!MODES[this.state.globalMode]) this.state.globalMode = "automatic";
      this.state.projects = Object.fromEntries(
        Object.entries(this.state.projects || {}).filter(([, modeId]) => Boolean(MODES[modeId]))
      );
      this.state.responseStrategy = legacyTeam ? "multi" : "single";
      this.state.projectStrategies = {};
      this.state.schemaVersion = 3;
      this.state.updatedAt = now();
      atomicJson(this.filePath, this.state);
    }
  }

  list() {
    return Object.values(MODES).map((mode) => ({ ...mode }));
  }

  current(projectId = null) {
    const id = projectId && this.state.projects[projectId]
      ? this.state.projects[projectId]
      : this.state.globalMode;
    return { ...(MODES[id] || MODES.automatic) };
  }

  select(modeId, projectId = null) {
    if (!MODES[modeId]) {
      throw new DornSuiteError("DORN-MODE-001", "modes", "El modo solicitado no existe.", {
        actions: [`Elige uno de: ${Object.keys(MODES).join(", ")}.`]
      });
    }
    if (projectId) this.state.projects[projectId] = modeId;
    else {
      this.state.globalMode = modeId;
      // La elección global reemplaza modos antiguos guardados por proyecto.
      // Así, Automático continúa activo al añadir o quitar proveedores.
      this.state.projects = {};
    }
    this.state.updatedAt = now();
    atomicJson(this.filePath, this.state);
    return this.current(projectId);
  }

  strategies() {
    return Object.values(RESPONSE_STRATEGIES).map((strategy) => ({ ...strategy }));
  }

  strategy(projectId = null) {
    const id = projectId && this.state.projectStrategies?.[projectId]
      ? this.state.projectStrategies[projectId]
      : this.state.responseStrategy;
    return { ...(RESPONSE_STRATEGIES[id] || RESPONSE_STRATEGIES.single) };
  }

  selectStrategy(strategyId, projectId = null) {
    if (!RESPONSE_STRATEGIES[strategyId]) {
      throw new DornSuiteError("DORN-STRATEGY-001", "modes", "La estrategia de respuesta solicitada no existe.", {
        actions: [`Elige una de: ${Object.keys(RESPONSE_STRATEGIES).join(", ")}.`]
      });
    }
    if (projectId) {
      if (!this.state.projectStrategies) this.state.projectStrategies = {};
      this.state.projectStrategies[projectId] = strategyId;
    } else {
      this.state.responseStrategy = strategyId;
      this.state.projectStrategies = {};
    }
    this.state.updatedAt = now();
    atomicJson(this.filePath, this.state);
    return this.strategy(projectId);
  }

  validateExternalAccess(projectId = null) {
    const mode = this.current(projectId);
    if (!mode.allowExternalProviders) {
      throw new DornSuiteError("DORN-PRIVACY-001", "modes", "El modo privado bloqueó el proveedor externo.", {
        cause: "Este modo sólo permite procesamiento local.",
        actions: ["Selecciona DORN Local.", "Cambia de modo de forma explícita."]
      });
    }
    return true;
  }
}

class MemoryEngine {
  constructor(stateRoot) {
    this.filePath = path.join(stateRoot, "memory.json");
    this.state = readJson(this.filePath, {
      enabled: true,
      personalEnabled: false,
      personal: [],
      projects: {},
      graph: { nodes: [], edges: [] },
      updatedAt: now()
    });
  }

  persist() {
    this.state.updatedAt = now();
    atomicJson(this.filePath, this.state);
  }

  settings() {
    return {
      enabled: Boolean(this.state.enabled),
      personalEnabled: Boolean(this.state.personalEnabled),
      updatedAt: this.state.updatedAt
    };
  }

  configure(patch) {
    if (typeof patch.enabled === "boolean") this.state.enabled = patch.enabled;
    if (typeof patch.personalEnabled === "boolean") this.state.personalEnabled = patch.personalEnabled;
    this.persist();
    return this.settings();
  }

  bucket(projectId) {
    if (!this.state.projects[projectId]) {
      this.state.projects[projectId] = {
        objective: "",
        decisions: [],
        errors: [],
        versions: [],
        models: [],
        pending: [],
        restrictions: [],
        preferences: [],
        semantic: []
      };
    }
    return this.state.projects[projectId];
  }

  rememberProject(projectId, entry) {
    if (!this.state.enabled) return { stored: false, reason: "disabled" };
    const type = String(entry.type || "semantic");
    const value = String(entry.value || "").trim();
    if (!value) throw new DornSuiteError("DORN-MEMORY-001", "memory", "No hay contenido para recordar.");
    if (/(api[_-]?key|token|secret|password|contrase(?:ña|na))/i.test(value)) {
      throw new DornSuiteError("DORN-MEMORY-002", "memory", "La memoria rechazó contenido que parece un secreto.", {
        actions: ["Guarda las credenciales mediante el almacén seguro de proveedores."]
      });
    }
    const bucket = this.bucket(projectId);
    if (type === "objective") bucket.objective = value;
    else if (Array.isArray(bucket[type])) bucket[type].push({ id: crypto.randomUUID(), value, at: now() });
    else bucket.semantic.push({ id: crypto.randomUUID(), type, value, at: now() });
    this.persist();
    return { stored: true, type, value };
  }

  rememberPersonal(entry) {
    if (!this.state.personalEnabled) {
      throw new DornSuiteError("DORN-MEMORY-003", "memory", "La memoria personal no está autorizada.", {
        actions: ["Activa memoria personal de forma explícita."]
      });
    }
    const value = String(entry.value || "").trim();
    if (!value) throw new DornSuiteError("DORN-MEMORY-001", "memory", "No hay contenido para recordar.");
    this.state.personal.push({
      id: crypto.randomUUID(),
      category: String(entry.category || "preference"),
      value,
      at: now()
    });
    this.persist();
    return this.state.personal.at(-1);
  }

  search(projectId, query, limit = 8) {
    if (!this.state.enabled) return [];
    const bucket = this.bucket(projectId);
    const entries = [];
    if (bucket.objective) entries.push({ type: "objective", value: bucket.objective });
    for (const [type, values] of Object.entries(bucket)) {
      if (!Array.isArray(values)) continue;
      for (const entry of values) entries.push({ type, ...entry });
    }
    if (this.state.personalEnabled) {
      for (const entry of this.state.personal) entries.push({ type: "personal", ...entry });
    }
    return entries
      .map((entry) => ({ ...entry, score: similarity(query, entry.value) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(50, limit)));
  }

  getProject(projectId) {
    return structuredClone(this.bucket(projectId));
  }

  remove(projectId, type, entryId = null) {
    const bucket = this.bucket(projectId);
    if (type === "objective") bucket.objective = "";
    else if (Array.isArray(bucket[type])) {
      bucket[type] = entryId ? bucket[type].filter((entry) => entry.id !== entryId) : [];
    }
    this.persist();
    return this.getProject(projectId);
  }

  addGraphRelation(relation) {
    const from = String(relation.from || "").trim();
    const to = String(relation.to || "").trim();
    const kind = String(relation.kind || "relates-to").trim();
    if (!from || !to) throw new DornSuiteError("DORN-GRAPH-001", "memory", "La relación necesita origen y destino.");
    const nodeId = (label) => {
      let node = this.state.graph.nodes.find((entry) => entry.label === label);
      if (!node) {
        node = { id: crypto.randomUUID(), label, type: String(relation.type || "concept") };
        this.state.graph.nodes.push(node);
      }
      return node.id;
    };
    const edge = {
      id: crypto.randomUUID(),
      from: nodeId(from),
      to: nodeId(to),
      kind,
      projectId: relation.projectId || null,
      at: now()
    };
    this.state.graph.edges.push(edge);
    this.persist();
    return edge;
  }

  exportAll() {
    return structuredClone(this.state);
  }
}

module.exports = {
  MODES,
  RESPONSE_STRATEGIES,
  ModeManager,
  MemoryEngine
};
