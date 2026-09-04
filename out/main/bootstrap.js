"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function failureText(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack || ""}`.trim();
  }
  return String(error);
}

function bootstrapLogPath(electron) {
  try {
    return path.join(electron.app.getPath("userData"), "dorn-bootstrap.log");
  } catch {
    return path.join(os.tmpdir(), "DORN-AI-dorn-bootstrap.log");
  }
}

function appendLog(logPath, message, error) {
  const detail = error === undefined ? "" : `\n${failureText(error)}`;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] ${message}${detail}\n`,
      "utf8"
    );
  } catch {
    process.stderr.write(`${message}${detail}\n`);
  }
}

let electron;
let logPath = path.join(os.tmpdir(), "DORN-AI-dorn-bootstrap.log");

try {
  electron = require("electron");
  logPath = bootstrapLogPath(electron);

  const installerAgentArgument = process.argv.find((argument) => argument.startsWith("--dorn-installer-agent="));
  if (installerAgentArgument) {
    if (process.platform !== "win32" || !electron.app.isPackaged) {
      throw new Error("El agente de instalación DORN sólo funciona dentro del paquete oficial para Windows.");
    }
    const { runInstallerAgent } = require("./dorn-core/installer-transaction-v2.js");
    const result = runInstallerAgent(process.argv.slice(1));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  }

  appendLog(
    logPath,
    `Bootstrap DORN 4.0.0-alpha.7 · ${process.platform} ${process.arch} · Electron ${process.versions.electron || "desconocido"} · Node ${process.versions.node}`
  );

  require("node:sqlite");
  for (const dependency of ["zod", "archiver", "extract-zip"]) {
    require(dependency);
  }

  require("./index.js");
} catch (error) {
  appendLog(logPath, "ERROR FATAL ANTES DE ABRIR LA INTERFAZ", error);
  try {
    electron?.dialog.showErrorBox(
      "DORN AI no pudo iniciar",
      `Falló una dependencia esencial antes de abrir la interfaz.\n\nRegistro: ${logPath}\n\nDetalle: ${failureText(error).split("\n")[0].slice(0, 500)}`
    );
  } catch {
  }
  try {
    electron?.app.exit(1);
  } catch {
    process.exitCode = 1;
  }
}
