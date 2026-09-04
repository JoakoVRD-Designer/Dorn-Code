"use strict";

const MAX_ACTIONS = 25;
const ACTION_BLOCK = /```dorn-action\s*([\s\S]*?)```/gi;
const ACTION_MARKER = "```dorn-action";

function actionProtocolPrompt() {
  return [
    "HERRAMIENTAS REALES DE DORN WINDOWS 3.0",
    "La conversación está conectada a una carpeta de proyecto autorizada.",
    "Cuando el usuario solicite explícitamente crear o modificar archivos, carpetas o programas, prepara acciones estructuradas al final de la respuesta.",
    "No afirmes que una acción fue ejecutada. DORN mostrará una vista previa y esperará la aprobación del usuario.",
    "Usa un bloque por operación y rutas relativas a la carpeta del proyecto.",
    "Crear o modificar archivo:",
    "```dorn-action",
    '{"action":"write","relativePath":"src/index.js","content":"contenido completo del archivo"}',
    "```",
    "Crear carpeta:",
    "```dorn-action",
    '{"action":"mkdir","relativePath":"src"}',
    "```",
    "Renombrar:",
    "```dorn-action",
    '{"action":"rename","relativePath":"archivo.txt","targetRelativePath":"archivo-nuevo.txt"}',
    "```",
    "Eliminar:",
    "```dorn-action",
    '{"action":"delete","relativePath":"archivo.txt"}',
    "```",
    "Ejecutar una compilación, prueba o comando:",
    "```dorn-action",
    '{"action":"terminal","shell":"terminal","command":"npm test","relativeCwd":"","timeoutMs":120000}',
    "```",
    "Reglas: incluye contenido completo y válido; ordena primero carpetas, luego archivos y al final pruebas; máximo 25 operaciones por respuesta; no incluyas acciones si el usuario solo pide explicación; no solicites ni escribas claves, tokens o contraseñas."
  ].join("\n");
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("La acción debe ser un objeto JSON.");
  }
  const action = String(raw.action || "");
  if (action === "write") {
    return {
      action,
      relativePath: String(raw.relativePath || ""),
      content: String(raw.content ?? ""),
      encoding: raw.encoding === "base64" ? "base64" : "utf8"
    };
  }
  if (action === "mkdir" || action === "delete") {
    return {
      action,
      relativePath: String(raw.relativePath || "")
    };
  }
  if (action === "rename") {
    return {
      action,
      relativePath: String(raw.relativePath || ""),
      targetRelativePath: String(raw.targetRelativePath || "")
    };
  }
  if (action === "terminal") {
    return {
      action,
      shell: ["terminal", "powershell", "cmd"].includes(raw.shell) ? raw.shell : "terminal",
      command: String(raw.command || ""),
      relativeCwd: String(raw.relativeCwd || ""),
      timeoutMs: Number.isFinite(raw.timeoutMs) ? Number(raw.timeoutMs) : 120e3
    };
  }
  throw new Error(`Acción no compatible: ${action || "(vacía)"}.`);
}

function extractDornActions(text) {
  const actions = [];
  const errors = [];
  const matches = [...String(text).matchAll(ACTION_BLOCK)];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const entries = Array.isArray(parsed?.actions) ? parsed.actions : [parsed];
      for (const entry of entries) {
        if (actions.length >= MAX_ACTIONS) {
          throw new Error(`Se superó el máximo de ${MAX_ACTIONS} acciones.`);
        }
        actions.push(normalizeAction(entry));
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    actions,
    errors,
    cleanedText: String(text).replace(ACTION_BLOCK, "").trim()
  };
}

function isApproveCommand(text) {
  return /^(?:aprobar|confirmar|aplicar)(?:\s+(?:los?\s+)?(?:cambios?|acci[oó]n|acciones))?[.!]?$/i.test(String(text).trim());
}

function isCancelCommand(text) {
  return /^(?:cancelar|rechazar|descartar)(?:\s+(?:los?\s+)?(?:cambios?|acci[oó]n|acciones))?[.!]?$/i.test(String(text).trim());
}

function createActionSafeStreamer(onSafeDelta) {
  let pending = "";
  let blocked = false;

  return {
    push(delta) {
      if (blocked) return;
      pending += String(delta);
      const markerIndex = pending.toLowerCase().indexOf(ACTION_MARKER);
      if (markerIndex >= 0) {
        const safe = pending.slice(0, markerIndex);
        if (safe) onSafeDelta(safe);
        pending = "";
        blocked = true;
        return;
      }

      const retainedLength = Math.min(ACTION_MARKER.length - 1, pending.length);
      const safeLength = pending.length - retainedLength;
      if (safeLength > 0) {
        onSafeDelta(pending.slice(0, safeLength));
        pending = pending.slice(safeLength);
      }
    },
    finish() {
      if (!blocked && pending) onSafeDelta(pending);
      pending = "";
    }
  };
}

function actionLabel(preview) {
  const summary = preview.summary;
  if (preview.kind === "terminal") {
    return `Ejecutar en ${summary.shell}: ${summary.command}`;
  }
  const labels = {
    write: summary.exists ? "Modificar archivo" : "Crear archivo",
    mkdir: "Crear carpeta",
    rename: "Renombrar",
    delete: "Eliminar con recuperación"
  };
  const target = summary.targetRelativePath ? ` → ${summary.targetRelativePath}` : "";
  return `${labels[summary.action] || summary.action}: ${summary.relativePath}${target}`;
}

function formatPreparedMessage(cleanedText, previews) {
  const lead = cleanedText ? `${cleanedText}\n\n` : "";
  const lines = previews.map((preview, index) => `${index + 1}. ${actionLabel(preview)}`);
  return [
    `${lead}DORN preparó ${previews.length} acción(es) real(es):`,
    "",
    ...lines,
    "",
    "Ningún archivo ni proceso fue modificado todavía.",
    "Usa el panel de aprobación de DORN para revisar, ejecutar todo el plan o cancelarlo. Esta decisión es local y no consume tokens."
  ].join("\n");
}

function preparedActions(previews) {
  return previews.map((preview, index) => ({
    index: index + 1,
    kind: preview.kind,
    label: actionLabel(preview)
  }));
}

function formatAppliedMessage(results) {
  const lines = results.map((entry, index) => {
    if (!entry.ok) return `${index + 1}. Error: ${entry.error}`;
    if (entry.kind === "terminal") {
      return `${index + 1}. Comando finalizado con código ${entry.result.exitCode}.`;
    }
    return `${index + 1}. ${entry.result.action} completado: ${entry.result.relativePath}.`;
  });
  const completed = results.filter((entry) => entry.ok).length;
  return [
    `DORN completó ${completed} de ${results.length} acción(es).`,
    "",
    ...lines,
    "",
    results.every((entry) => entry.ok)
      ? "Los cambios quedaron registrados en el historial recuperable del proyecto."
      : "La ejecución se detuvo al encontrar un error. Los cambios completados conservan recuperación."
  ].join("\n");
}

module.exports = {
  MAX_ACTIONS,
  actionProtocolPrompt,
  extractDornActions,
  isApproveCommand,
  isCancelCommand,
  createActionSafeStreamer,
  formatPreparedMessage,
  formatAppliedMessage,
  preparedActions
};
