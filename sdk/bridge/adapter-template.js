"use strict";

const fs = require("node:fs");
const path = require("node:path");

function complete(request, artifacts, message, metrics = {}) {
  return {
    schema: "dorn-bridge/1",
    jobId: request.jobId,
    status: "completed",
    message,
    metrics,
    artifacts
  };
}

async function run(request) {
  if (request.operation !== "inspect-3d") {
    throw new Error(`Operación no implementada: ${request.operation}`);
  }
  const reportPath = path.join(request.outputDirectory, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    sourceName: request.input.file?.name || null,
    sourceSha256: request.input.file?.sha256 || null,
    note: "Reemplaza esta plantilla por una llamada autorizada al SDK de la aplicación."
  }, null, 2));
  return complete(
    request,
    [{ relativePath: "output/report.json", mediaType: "application/json" }],
    "Inspección de ejemplo completada."
  );
}

async function main() {
  const requestPath = process.argv[2];
  const responsePath = process.argv[3];
  if (!requestPath || !responsePath) throw new Error("Faltan request.json y response.json.");
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  try {
    fs.writeFileSync(responsePath, JSON.stringify(await run(request), null, 2));
  } catch (error) {
    fs.writeFileSync(responsePath, JSON.stringify({
      schema: "dorn-bridge/1",
      jobId: request.jobId,
      status: "failed",
      message: error.message || String(error),
      artifacts: []
    }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { run, complete };
