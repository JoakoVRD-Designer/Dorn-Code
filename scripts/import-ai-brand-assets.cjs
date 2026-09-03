#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(process.argv[2] || "");
const iconsRoot = path.join(packageRoot, "icons");
if (!fs.existsSync(iconsRoot)) {
  console.error("Uso: node scripts/import-ai-brand-assets.cjs <carpeta-extraida-de-simple-icons>");
  process.exit(2);
}

const projectRoot = path.resolve(__dirname, "..");
const rendererRoot = path.join(projectRoot, "out", "renderer", "vendor", "ai-logos");
const sourceRoot = path.join(projectRoot, "resources", "catalog", "ai-logos");
fs.mkdirSync(rendererRoot, { recursive: true });
fs.mkdirSync(sourceRoot, { recursive: true });

const assets = {
  anthropic: "anthropic.svg",
  apple: "apple.svg",
  baidu: "baidu.svg",
  bytedance: "bytedance.svg",
  deepmind: "deepmind.svg",
  deepseek: "deepseek.svg",
  google: "google.svg",
  huggingface: "huggingface.svg",
  huawei: "huawei.svg",
  meta: "meta.svg",
  minimax: "minimax.svg",
  mistral: "mistralai.svg",
  moonshot: "moonshotai.svg",
  nvidia: "nvidia.svg",
  openrouter: "openrouter.svg",
  qwen: "qwen.svg",
  snowflake: "snowflake.svg"
};

for (const [key, fileName] of Object.entries(assets)) {
  const source = path.join(iconsRoot, fileName);
  if (!fs.existsSync(source)) throw new Error(`No se encontró ${fileName} en Simple Icons.`);
  fs.copyFileSync(source, path.join(rendererRoot, `${key}.svg`));
  fs.copyFileSync(source, path.join(sourceRoot, `${key}.svg`));
}

const aliases = {
  "anthropic": "anthropic", "anthropic claude": "anthropic", "claude": "anthropic",
  "apple": "apple", "baidu": "baidu", "bytedance": "bytedance",
  "google": "google", "google gemini": "google", "google y deepmind": "deepmind", "deepmind": "deepmind",
  "deepseek": "deepseek", "hugging face": "huggingface", "hugging face y comunidad": "huggingface",
  "huawei": "huawei", "meta": "meta", "minimax": "minimax", "mistral ai": "mistral",
  "moonshot ai": "moonshot", "moonshot ai kimi": "moonshot", "nvidia": "nvidia",
  "openrouter": "openrouter", "alibaba qwen": "qwen", "qwen": "qwen", "alibaba cloud model studio qwen": "qwen",
  "snowflake": "snowflake"
};
const manifest = {
  schema: "dorn-ai-brand-assets/1",
  source: "Simple Icons 16.28.0",
  license: "CC0-1.0",
  note: "Las marcas pertenecen a sus titulares. DORN muestra únicamente los recursos autorizados presentes en este paquete.",
  aliases: Object.fromEntries(Object.entries(aliases).map(([alias, key]) => [alias, `./vendor/ai-logos/${key}.svg`]))
};
fs.writeFileSync(path.join(projectRoot, "out", "renderer", "vendor", "dorn-ai-brand-assets.js"), `window.DORN_AI_BRAND_ASSETS = Object.freeze(${JSON.stringify(manifest)});\n`, "utf8");
fs.writeFileSync(path.join(sourceRoot, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
for (const legalFile of ["LICENSE.md", "DISCLAIMER.md"]) {
  const legalSource = path.join(packageRoot, legalFile);
  if (fs.existsSync(legalSource)) fs.copyFileSync(legalSource, path.join(sourceRoot, `SIMPLE-ICONS-${legalFile}`));
}
console.log(`${Object.keys(assets).length} identidades de empresa importadas con lista blanca.`);
