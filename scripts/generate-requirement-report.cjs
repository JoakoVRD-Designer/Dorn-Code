"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "dorn-v3-requirements.json"), "utf8"));
const requirements = data.requirements || data.items || data;
const counts = requirements.reduce((result, item) => {
  result[item.status] = (result[item.status] || 0) + 1;
  return result;
}, {});
const escape = (value) => String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const rows = requirements.map((item) => [
  item.number,
  escape(item.title),
  escape(item.module),
  escape(item.status),
  escape((item.evidence || []).join("; "))
].join(" | "));
const pending = requirements.filter((item) => item.status === "pending");
const report = [
  "# DORN AI 3.0.0-alpha.10 — estado de los 152 puntos",
  "",
  "Este informe se genera directamente desde `dorn-v3-requirements.json`. Un estado `partial-*` significa que existe una base comprobable, pero no cubre todo el alcance del Word.",
  "",
  "## Resumen",
  "",
  ...Object.entries(counts).sort().map(([status, count]) => `- ${status}: ${count}`),
  `- Total: ${requirements.length}`,
  "",
  "## Matriz completa",
  "",
  "N.º | Requisito | Módulo | Estado | Evidencia o límite",
  "--- | --- | --- | --- | ---",
  ...rows,
  "",
  "## Pendientes que necesitan otra etapa",
  "",
  ...pending.map((item) => `- **${item.number}. ${item.title}:** ${({
    48: "requiere un motor de virtualización/emulación autorizado, imágenes de sistema, compatibilidad de hardware y pruebas en Windows.",
    150: "depende de cerrar y probar la primera versión visual del Installer Studio.",
    151: "depende de servicios, firma, publicación, pipelines y pruebas virtualizadas."
  })[item.number] || "requiere una fase posterior."}`),
  "",
  "## Anotaciones manuales integradas hasta alpha.10",
  "",
  "- Campo de mensaje ampliado a 320 px, con saltos y espacios preservados.",
  "- KaTeX comprobado para fórmulas en línea y bloques como `i = \\sqrt{-1}`.",
  "- Preferencia para precargar DORN Local una vez al iniciar y reutilizar `llama-server`.",
  "- Perfiles Directo, Mentor, Cercano, Aprendizaje, Ingeniería, Gamers y Desarrollador.",
  "- Sugerencias de espacio sin mover conversaciones automáticamente.",
  "- Guías de proveedores y acceso al formulario amplio de APIs existente.",
  "- Panel de productos, gestor local de plugins y Designer inicial de Installer Studio.",
  "- Catálogo unificado con cinco modelos locales verificables y doce guías de conexión local/API.",
  "- DORN Design separado: documento versionado, lienzo SVG, capas, inspector y exportación.",
  "- DORN Editor separado: proyecto audiovisual no destructivo, medios, pistas, cortes y subtítulos.",
  "- Envío del documento de Design o la secuencia de Editor al compositor de DORN AI.",
  "- SDK específico de plugins de Installer Studio; su host aislado todavía está pendiente.",
  "- Contrato CAD/Bridge para Open CASCADE, Assimp y aplicaciones propietarias autorizadas.",
  "- Acciones reales por respuesta: copiar, regenerar en rama, escuchar, compartir, exportar y valorar.",
  "- Edición no destructiva: una modificación del mensaje crea una rama y conserva la conversación original.",
  "- Gestión de conversaciones: buscar, renombrar, anclar, archivar, restaurar, duplicar, exportar y eliminar con confirmación.",
  "- Exportación portable de conversaciones en Markdown o JSON versionado.",
  "- Configuración Gamers ampliada con objetivo, experiencia, motor, plataforma y seis prioridades persistentes.",
  "- Editor de Colores con siete paletas, valores HEX libres, vista previa, contraste e importación/exportación.",
  "- Aplicación de la paleta al núcleo, chat, menús, configuración y centro de control.",
  "- Apariencia compartida y persistente entre DORN AI, Design, Editor y Studio3D.",
  "- Actualización en vivo de fondos, paneles, controles, densidad y movimiento reducido en las aplicaciones abiertas.",
  "- Studio3D actualiza también el fondo WebGL, la rejilla y el resaltado del objeto seleccionado.",
  "- No se implementó evasión de inactividad de Roblox, anti-cheat ni acceso silencioso al sistema.",
  "- Inicio de sesión Google, telemetría pública, marketplace remoto y servidores siguen dependiendo de infraestructura y credenciales oficiales.",
  ""
].join("\n");

fs.writeFileSync(path.join(root, "ESTADO-152-PUNTOS-ALPHA10.md"), report);
console.log(`Informe generado: ${requirements.length} requisitos, ${pending.length} pendientes.`);
