"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  GOLDEN_FILES,
  generateWebGoldenProject,
  writeWebGoldenFiles
} = require("./web-golden-project");

const JOB_TYPE = "web.golden.produce";

function runtimeError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function targetDirectory(value) {
  const target = String(value || "dorn-web-golden").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(target)) throw runtimeError("WEB_GOLDEN_TARGET_INVALID", "La carpeta del Golden Project necesita un nombre simple y estable.");
  return target;
}

function expectedFiles(target) {
  return GOLDEN_FILES.map((relativePath) => `${target}/${relativePath}`).sort();
}

class WebGoldenRuntime {
  constructor(options = {}) {
    if (!options.worktreeManager || !options.executionCore || !options.evidenceCore) {
      throw new Error("Web Golden Runtime necesita Worktree, Execution y Evidence.");
    }
    this.worktreeManager = options.worktreeManager;
    this.executionCore = options.executionCore;
    this.evidenceCore = options.evidenceCore;
    this.browserVerifier = typeof options.browserVerifier === "function" ? options.browserVerifier : null;
  }

  worktreeManager;
  executionCore;
  evidenceCore;
  browserVerifier;

  register(jobRuntime) {
    if (!jobRuntime?.register) throw new Error("Web Golden Runtime necesita Durable Jobs.");
    jobRuntime.register(JOB_TYPE, (context) => this.produce(context), { idempotent: false });
    return this;
  }

  enqueue(jobRuntime, project, input = {}) {
    const target = targetDirectory(input.targetDirectory);
    return jobRuntime.enqueue(project, {
      type: JOB_TYPE,
      goal: String(input.goal || "Crear y verificar un sitio web profesional completo").slice(0, 4000),
      payload: { targetDirectory: target, brief: input.brief || {} },
      scope: { expectedFiles: expectedFiles(target), mutatesProject: true },
      successContract: {
        requiresVerifiedEvidence: true,
        requiresIndependentTest: true,
        description: "Los ocho archivos web deben coincidir con la prueba independiente y la captura real de navegador."
      },
      priority: input.priority || "NORMAL",
      conversationId: input.conversationId || null,
      idempotencyKey: input.idempotencyKey || null,
      maxAttempts: 1
    });
  }

  async produce(context = {}) {
    const { project, job, signal, checkpoint, progress } = context;
    if (!project || !job) throw runtimeError("WEB_GOLDEN_JOB_INVALID", "El Job web no tiene identidad de proyecto.");
    const target = targetDirectory(job.payload?.targetDirectory);
    const scope = expectedFiles(target);
    if (JSON.stringify(scope) !== JSON.stringify([...(job.scope?.expectedFiles || [])].sort())) {
      throw runtimeError("WEB_GOLDEN_SCOPE_MISMATCH", "El Change Scope del Job no coincide con el contrato del Golden Project.");
    }
    const workUnitId = `web-golden-${job.id}`;
    progress?.({ phase: "ISOLATING", completed: 0, total: 6 });
    const unit = this.worktreeManager.create(project, { workUnitId, expectedFiles: scope, requiredFiles: scope });
    checkpoint?.("Worktree web creado", { workUnitId, isolationMode: unit.isolationMode, expectedFiles: scope });
    if (signal?.aborted) throw signal.reason || runtimeError("WEB_GOLDEN_CANCELLED", "Golden Project cancelado.");

    const generated = generateWebGoldenProject(job.payload?.brief || {});
    const isolatedTarget = path.join(unit.executionRoot, target);
    if (!isolatedTarget.startsWith(`${unit.executionRoot}${path.sep}`)) throw runtimeError("WEB_GOLDEN_TARGET_ESCAPE", "La carpeta web sale del Worktree.");
    fs.mkdirSync(isolatedTarget, { recursive: false, mode: 0o700 });
    writeWebGoldenFiles(isolatedTarget, generated.files);
    progress?.({ phase: "AUTHORED", completed: 1, total: 6, files: scope.length });

    const execution = this.executionCore.execute(project, {
      toolId: "node",
      workUnitId,
      relativeCwd: target,
      action: "test.execute",
      args: ["--test", "tests/golden.test.cjs"],
      timeoutMs: 30_000,
      environment: { CI: "1", NO_COLOR: "1" }
    }, { signal });
    const executionResult = await execution.promise;
    progress?.({ phase: "TESTED", completed: 2, total: 6, executionId: executionResult.executionId });

    const tested = this.worktreeManager.recordTest(project, workUnitId, {
      testId: crypto.randomUUID(),
      passed: executionResult.truthState === "EXECUTED",
      independent: true,
      command: ["node", "--test", "tests/golden.test.cjs"],
      exitCode: executionResult.exitCode
    });
    if (tested.state !== "TESTED") {
      throw runtimeError("WEB_GOLDEN_TEST_SCOPE_FAILED", "La prueba encontró archivos ausentes, extra o fuera del Change Scope.", { test: tested.test });
    }
    const ready = this.worktreeManager.prepareIntegration(project, workUnitId);
    if (ready.state !== "READY_TO_INTEGRATE") {
      throw runtimeError("WEB_GOLDEN_INTEGRATION_GATE_FAILED", "Los bytes web cambiaron después de la prueba.", { integration: ready.integration });
    }
    progress?.({ phase: "READY_TO_INTEGRATE", completed: 3, total: 6, treeHash: tested.test.treeHash });

    const integrated = this.worktreeManager.integrate(project, workUnitId);
    progress?.({ phase: "INTEGRATED", completed: 4, total: 6, treeHash: integrated.integration.integratedTreeHash });
    let staticEvidence;
    let visualEvidence;
    try {
      staticEvidence = this.evidenceCore.record(project, {
        evidenceType: "WEB_GOLDEN_STATIC",
        command: "node --test tests/golden.test.cjs",
        scenario: "Autor, validador independiente, Execution Core, Worktree y bytes integrados del Golden Project web.",
        result: "PASSED",
        exitCode: 0,
        truthState: "VERIFIED",
        files: scope,
        environment: {
          independent: true,
          runner: "node:test",
          filesystemIsolation: executionResult.isolation.filesystem,
          networkIsolation: executionResult.isolation.network,
          browser: "NOT_EXECUTED"
        },
        verifier: { id: "dorn-web-golden-validator", checks: generated.report.checks },
        details: { treeHash: integrated.integration.integratedTreeHash, stdout: executionResult.stdout.slice(0, 4000) },
        requirements: ["PARITY-P0-03", "PARITY-P0-11", "PLAN-P0-ULTRA-UX-PERF"],
        tests: ["tests/golden.test.cjs"],
        tasks: [job.id]
      });

      if (!this.browserVerifier) {
        visualEvidence = this.evidenceCore.record(project, {
          evidenceType: "WEB_GOLDEN_VISUAL",
          scenario: "Captura real de escritorio y móvil, DOM, consola, red, interacción por teclado y crítico visual.",
          result: "BLOCKED",
          exitCode: null,
          truthState: "BLOCKED",
          files: scope,
          environment: { independent: true, blocker: "BROWSER_BINARY_UNAVAILABLE", browser: "NOT_EXECUTED" },
          details: { reason: "Este entorno no dispone de un navegador ejecutable verificable; no se infiere calidad visual desde HTML/CSS." },
          requirements: ["PARITY-P0-03", "PARITY-P0-11"],
          tests: ["browser-golden-pending"],
          tasks: [job.id]
        });
      } else {
        throw runtimeError("WEB_GOLDEN_BROWSER_ADAPTER_UNIMPLEMENTED", "El adaptador de navegador aún no tiene un contrato activable.");
      }
    } catch (error) {
      try { this.worktreeManager.rollback(project, workUnitId); }
      catch (rollbackError) { error.rollbackError = String(rollbackError?.message || rollbackError).slice(0, 2000); }
      throw error;
    }
    progress?.({ phase: "EVIDENCE_RECORDED", completed: 5, total: 6, staticEvidenceId: staticEvidence.evidenceId, visualState: visualEvidence.truthState });
    this.worktreeManager.dispose(project, workUnitId);
    progress?.({ phase: "PARTIAL_BROWSER_BLOCKED", completed: 6, total: 6 });
    return {
      schema: "dorn.web-golden-result/1",
      successContractSatisfied: false,
      evidenceIds: [staticEvidence.evidenceId],
      staticEvidenceId: staticEvidence.evidenceId,
      visualEvidenceId: visualEvidence.evidenceId,
      visualState: "BLOCKED_ENVIRONMENT",
      browserBlocker: "BROWSER_BINARY_UNAVAILABLE",
      workUnitId,
      targetDirectory: target,
      files: scope,
      testedTreeHash: tested.test.treeHash,
      integratedTreeHash: integrated.integration.integratedTreeHash
    };
  }
}

module.exports = { JOB_TYPE, WebGoldenRuntime, expectedFiles, targetDirectory };
