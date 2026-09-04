#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const source = process.argv[2];
if (!source || !fs.existsSync(source)) {
  console.error("Uso: node scripts/import-ai-encyclopedia.cjs <enciclopedia.pdf|texto-extraido.txt>");
  process.exit(2);
}

const projectRoot = path.resolve(__dirname, "..");
const sourceBuffer = fs.readFileSync(source);
const sourceSha256 = crypto.createHash("sha256").update(sourceBuffer).digest("hex");
const text = path.extname(source).toLowerCase() === ".pdf"
  ? execFileSync("pdftotext", ["-layout", source, "-"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  : sourceBuffer.toString("utf8");

const COMPANY_SECTIONS = new Set([
  "OpenAI", "Anthropic", "Google y DeepMind", "Meta", "Microsoft", "xAI", "Mistral AI",
  "DeepSeek", "Alibaba Qwen", "Cohere", "AI21 Labs", "Amazon", "NVIDIA", "IBM", "Apple",
  "Baidu", "Tencent", "Huawei", "ByteDance", "Zhipu AI", "Moonshot AI", "MiniMax", "01.AI",
  "Stability AI", "Black Forest Labs", "EleutherAI", "BigScience", "Allen Institute for AI",
  "Databricks y MosaicML", "Salesforce", "Snowflake", "Cerebras", "TII Falcon",
  "Hugging Face y comunidad"
]);

const SECTION_TAGS = new Map([
  ["Programación y agentes", ["Programación", "Agentes"]],
  ["Imagen y diseño", ["Imagen", "Diseño"]],
  ["Video, animación y avatares", ["Video", "Animación", "Avatares"]],
  ["Audio, voz y música", ["Audio", "Voz", "Música"]],
  ["3D, CAD y mundo físico", ["3D", "CAD e ingeniería", "Robótica"]],
  ["Ciencia, medicina y educación", ["Ciencia", "Medicina", "Educación"]],
  ["Búsqueda, productividad y asistentes", ["Búsqueda", "Productividad", "Asistentes"]],
  ["Ciberseguridad y moderación", ["Ciberseguridad", "Moderación"]],
  ["Modelos abiertos populares", ["Modelos abiertos", "Texto y conversación"]]
]);

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(value) {
  const base = normalize(value).replace(/\s+/g, "-").slice(0, 72) || "entry";
  const suffix = crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 8);
  return `${base}-${suffix}`;
}

let section = "Sin categoría";
const unique = new Map();
for (const rawLine of text.split(/\r?\n/)) {
  const line = rawLine.replace(/^\f/, "").trimEnd();
  const sectionMatch = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
  if (sectionMatch) {
    section = sectionMatch[2].trim();
    continue;
  }

  const rowMatch = line.match(/^\s*(\d+)\s{2,}(.+?)\s*$/);
  if (!rowMatch) continue;
  const name = rowMatch[2].replace(/\s+/g, " ").trim();
  if (!name || /nombres incluidos|cantidad|nombre de la ia/i.test(name)) continue;

  const key = normalize(name);
  if (!key || unique.has(key)) continue;
  const tags = SECTION_TAGS.get(section) || (COMPANY_SECTIONS.has(section)
    ? ["Modelos y productos"]
    : [section]);
  unique.set(key, {
    id: slug(`${section}:${name}`),
    name,
    company: COMPANY_SECTIONS.has(section) ? section : "Varios autores",
    family: section,
    category: tags[0],
    modalities: tags,
    availability: "Por verificar",
    integration: "Referencia de enciclopedia",
    needsVerification: true,
    search: normalize([name, section, ...tags].join(" "))
  });
}

const entries = [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
const sections = [...new Set(entries.map((entry) => entry.family))].sort((left, right) => left.localeCompare(right, "es"));
const output = {
  schema: "dorn-ai-encyclopedia/2",
  generatedAt: new Date().toISOString(),
  source: {
    fileName: path.basename(source),
    sha256: sourceSha256,
    note: "Documento aportado por el propietario del proyecto. Las entradas son referencias; DORN debe comprobar disponibilidad, licencia e integración antes de ofrecer acciones."
  },
  stats: { entries: entries.length, sections: sections.length },
  sections,
  entries
};

const jsonPath = path.join(projectRoot, "resources", "catalog", "dorn-ai-encyclopedia.json");
const jsPath = path.join(projectRoot, "out", "renderer", "vendor", "dorn-ai-encyclopedia.js");
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.mkdirSync(path.dirname(jsPath), { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
fs.writeFileSync(jsPath, `window.DORN_AI_ENCYCLOPEDIA = Object.freeze(${JSON.stringify(output)});\n`, "utf8");
console.log(`Enciclopedia importada: ${entries.length} entradas únicas · ${sections.length} secciones`);
console.log(jsonPath);
console.log(jsPath);
