"use strict";

const { parentPort } = require("node:worker_threads");
const vm = require("node:vm");

function prepareSource(source) {
  return String(source)
    .replace(/import\s*\{\s*defineDornPlugin\s*\}\s*from\s*["']@dorn\/sdk["'];?/g, "")
    .replace(/export\s+default\s+defineDornPlugin/g, "defineDornPlugin");
}

async function execute(message) {
  const commands = new Map();
  let definition = null;
  const context = vm.createContext({
    defineDornPlugin(value) {
      definition = value;
      return value;
    },
    console: Object.freeze({
      log() {},
      warn() {},
      error() {}
    })
  }, {
    name: `DORN Plugin ${message.pluginId}`,
    codeGeneration: { strings: false, wasm: false }
  });
  const script = new vm.Script(`"use strict";\n${prepareSource(message.source)}`, {
    filename: `${message.pluginId}/index.js`
  });
  script.runInContext(context, { timeout: 1500 });
  if (!definition || typeof definition !== "object") {
    throw new Error("El plugin no llamó a defineDornPlugin.");
  }
  if (typeof definition.activate === "function") {
    await definition.activate(Object.freeze({
      commands: Object.freeze({
        register(id, handler) {
          if (typeof id !== "string" || typeof handler !== "function") {
            throw new Error("Registro de comando inválido.");
          }
          commands.set(id, handler);
        }
      })
    }));
  }
  const handler = commands.get(message.command);
  if (!handler) throw new Error(`El plugin no registró el comando ${message.command}.`);
  const result = await handler(structuredClone(message.input));
  return structuredClone(result);
}

parentPort.on("message", async (message) => {
  try {
    const result = await execute(message);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
