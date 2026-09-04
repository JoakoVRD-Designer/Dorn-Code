"use strict";

const requiredRuntimeDependencies = [
  "archiver",
  "electron-updater",
  "extract-zip",
  "zod"
];

const failures = [];
for (const dependency of requiredRuntimeDependencies) {
  try {
    const resolved = require.resolve(dependency);
    require(dependency);
    console.log(`Dependencia cargada · ${dependency} · ${resolved}`);
  } catch (error) {
    failures.push(`${dependency}: ${error.message}`);
  }
}

if (failures.length) {
  console.error("El paquete no puede publicarse: faltan dependencias de ejecución completas.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dependencias de arranque verificadas.");
