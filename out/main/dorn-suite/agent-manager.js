"use strict";

const crypto = require("node:crypto");
const { DornSuiteError, now, redact } = require("./common");

const ROLES = {
  coordinator: {
    label: "Coordinador",
    capabilities: ["planning", "routing", "budget"],
    instruction: "Interpreta el objetivo, restricciones y entregables. Produce un plan mínimo verificable."
  },
  researcher: {
    label: "Investigador",
    capabilities: ["research", "files", "sources"],
    instruction: "Recopila antecedentes necesarios, distingue fuentes y señala información faltante."
  },
  programmer: {
    label: "Programador",
    capabilities: ["code", "tests", "build"],
    instruction: "Produce cambios mantenibles, pruebas y una lista exacta de archivos afectados."
  },
  engineering: {
    label: "Ingeniería",
    capabilities: ["engineering", "geometry", "measurements"],
    instruction: "Trabaja con unidades, tolerancias, supuestos y advertencias profesionales."
  },
  visual: {
    label: "Visual",
    capabilities: ["vision", "design", "image"],
    instruction: "Analiza composición, legibilidad, consistencia visual y entregables gráficos."
  },
  mathematical: {
    label: "Matemático",
    capabilities: ["math", "latex", "charts"],
    instruction: "Verifica cálculos, unidades y notación; conserva el procedimiento comprobable."
  },
  critic: {
    label: "Crítico",
    capabilities: ["review", "risk", "contradictions"],
    instruction: "Busca errores, contradicciones, riesgos y requisitos no satisfechos."
  },
  supervisor: {
    label: "Supervisor",
    capabilities: ["compose", "verify", "completion"],
    instruction: "Integra resultados sin repetición, verifica consistencia y decide si el trabajo está completo."
  },
  emergency: {
    label: "Emergencia local",
    capabilities: ["errors", "offline", "diagnostics"],
    instruction: "Explica fallos localmente, propone acciones seguras y no inventa diagnósticos."
  }
};

function classifyObjective(objective) {
  const text = String(objective).toLowerCase();
  if (/3d|stl|obj|gltf|glb|step|cad|solidworks|freecad|medid|geometr/.test(text)) return "engineering";
  if (/c[oó]digo|program|aplicaci[oó]n|web|script|error|compilar|prueba/.test(text)) return "programmer";
  if (/imagen|diseño|logo|captura|fotograf|visual/.test(text)) return "visual";
  if (/ecuaci[oó]n|f[oó]rmula|matem|latex|gr[aá]fic/.test(text)) return "mathematical";
  if (/investig|buscar|fuente|comparar|antecedente/.test(text)) return "researcher";
  return "researcher";
}

class AgentManager {
  constructor({ modeManager, audit = () => {} }) {
    this.modeManager = modeManager;
    this.audit = audit;
    this.active = new Map();
  }

  roles() {
    return Object.entries(ROLES).map(([id, value]) => ({ id, ...value }));
  }

  plan(raw) {
    const objective = String(raw.objective || "").trim();
    if (!objective) throw new DornSuiteError("DORN-AGENT-001", "agents", "La tarea no tiene un objetivo.");
    const projectId = raw.projectId || null;
    const policy = this.modeManager.current(projectId);
    const collaboration = raw.collaboration === true;
    const requestedMax = Number(raw.maxAgents || policy.maxAgents);
    const maxAgents = collaboration
      ? Math.max(1, Math.min(4, requestedMax))
      : Math.max(1, Math.min(policy.maxAgents, requestedMax));
    const specialist = classifyObjective(objective);
    let roleIds;
    if (collaboration) {
      roleIds = maxAgents === 1
        ? [specialist]
        : maxAgents === 2
          ? [specialist, "supervisor"]
          : maxAgents === 3
            ? ["coordinator", specialist, "supervisor"]
            : ["coordinator", specialist, "critic", "supervisor"];
    } else {
      roleIds = objective.length < 120 ? [specialist] : ["coordinator", specialist, "critic", "supervisor"];
    }
    roleIds = [...new Set(roleIds)].slice(0, maxAgents);
    const task = {
      taskId: crypto.randomUUID(),
      objective,
      projectId,
      priority: ["low", "normal", "high"].includes(raw.priority) ? raw.priority : "normal",
      privacy: policy.id === "private" ? "local-only" : "local-first",
      maxAgents,
      maxIterations: Math.max(1, Math.min(policy.maxIterations, Number(raw.maxIterations || policy.maxIterations))),
      tokenBudget: Math.max(512, Math.min(policy.tokenBudget, Number(raw.tokenBudget || policy.tokenBudget))),
      timeBudgetSeconds: Math.max(15, Math.min(policy.timeBudgetSeconds, Number(raw.timeBudgetSeconds || policy.timeBudgetSeconds))),
      maxTools: policy.maxTools,
      maxFiles: policy.maxFiles,
      allowExternalProviders: policy.allowExternalProviders,
      allowFileModification: Boolean(raw.allowFileModification),
      requireApprovalBeforeWriting: true,
      parallel: collaboration ? true : policy.parallel,
      collaboration,
      agents: roleIds.map((role, index) => ({
        id: crypto.randomUUID(),
        role,
        label: ROLES[role].label,
        instruction: ROLES[role].instruction,
        order: index + 1,
        status: "pending"
      })),
      createdAt: now()
    };
    this.audit(projectId, "agents.plan.created", {
      taskId: task.taskId,
      roles: roleIds,
      policy: policy.id
    });
    return task;
  }

  async run(task, executor, signal) {
    if (typeof executor !== "function") {
      throw new DornSuiteError("DORN-AGENT-002", "agents", "No existe un ejecutor de modelos para esta tarea.");
    }
    const started = Date.now();
    const deadline = started + task.timeBudgetSeconds * 1000;
    const state = {
      ...structuredClone(task),
      status: "running",
      startedAt: now(),
      results: []
    };
    this.active.set(task.taskId, state);
    try {
      const executeAgent = async (agent, contextEntries = state.results) => {
        if (signal?.aborted) throw signal.reason || new Error("Tarea cancelada.");
        if (Date.now() > deadline) {
          throw new DornSuiteError("DORN-AGENT-003", "agents", "La tarea alcanzó su límite de tiempo.", {
            actions: ["Aumenta el presupuesto de tiempo.", "Reduce el alcance de la petición."],
            retryable: true
          });
        }
        agent.status = "running";
        const context = contextEntries.map((entry) => ({
          role: entry.role,
          result: entry.result
        }));
        const result = await executor({
          taskId: task.taskId,
          agentId: agent.id,
          objective: task.objective,
          role: agent.role,
          instruction: agent.instruction,
          context,
          tokenBudget: Math.floor(task.tokenBudget / state.agents.length),
          allowExternalProviders: task.allowExternalProviders,
          signal
        });
        agent.status = "completed";
        return {
          agentId: agent.id,
          role: agent.role,
          result: redact(typeof result === "string" ? result : JSON.stringify(result)),
          completedAt: now()
        };
      };
      if (task.parallel && state.agents.length > 2) {
        const coordinator = state.agents[0];
        const supervisor = state.agents.at(-1);
        const specialists = state.agents.slice(1, -1);
        state.results.push(await executeAgent(coordinator));
        const sharedContext = [...state.results];
        const specialistResults = await Promise.all(specialists.map((agent) => executeAgent(agent, sharedContext)));
        state.results.push(...specialistResults);
        state.results.push(await executeAgent(supervisor));
      } else {
        for (const agent of state.agents) state.results.push(await executeAgent(agent));
      }
      state.status = "completed";
      state.completedAt = now();
      state.durationMs = Date.now() - started;
      this.audit(task.projectId, "agents.task.completed", {
        taskId: task.taskId,
        durationMs: state.durationMs,
        agents: state.agents.length
      });
      return structuredClone(state);
    } catch (error) {
      state.status = signal?.aborted ? "cancelled" : "failed";
      state.error = redact(error instanceof Error ? error.message : String(error));
      state.completedAt = now();
      this.audit(task.projectId, "agents.task.failed", {
        taskId: task.taskId,
        error: state.error
      });
      throw error;
    } finally {
      this.active.delete(task.taskId);
    }
  }

  activeTasks() {
    return [...this.active.values()].map((entry) => structuredClone(entry));
  }
}

module.exports = {
  ROLES,
  AgentManager
};
