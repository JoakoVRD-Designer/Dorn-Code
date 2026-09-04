"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const excludedSuites = new Set([
  "alpha10.test.cjs",
  "installer-hardening.test.cjs"
]);

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: process.env,
    shell: false,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else if (entry.isFile() && /\.(?:c?js)$/.test(entry.name)) output.push(absolute);
  }
  return output;
}

for (const dependency of ["archiver", "electron-updater", "extract-zip", "zod"]) {
  require.resolve(dependency, { paths: [root] });
}

run([path.join(root, "scripts", "verify-recovery.cjs")]);

const syntaxFiles = ["out/main", "out/preload", "scripts", "tests"]
  .flatMap((relative) => walk(path.join(root, relative)))
  .sort((left, right) => left.localeCompare(right));
for (const file of syntaxFiles) run(["--check", file]);

const tests = fs.readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.cjs") && !excludedSuites.has(name))
  .sort((left, right) => left.localeCompare(right))
  .map((name) => path.join(root, "tests", name));

run(["--test", ...tests]);
console.log("Source checkout verificado. Los gates PE/runtime requieren restaurar los binarios fijados.");
