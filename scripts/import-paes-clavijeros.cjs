"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SUBJECTS = {
  "competencia-lectora": { id: "lectora", title: "Competencia Lectora" },
  "ciencias-biologia": { id: "ciencias-biologia", title: "Ciencias - Biología" },
  "ciencias-fisica": { id: "ciencias-fisica", title: "Ciencias - Física" },
  "ciencias-quimica": { id: "ciencias-quimica", title: "Ciencias - Química" },
  "ciencias-tp": { id: "ciencias-tp", title: "Ciencias - Técnico Profesional" },
  historia: { id: "historia", title: "Historia y Ciencias Sociales" },
  m1: { id: "m1", title: "Competencia Matemática 1 (M1)" },
  m2: { id: "m2", title: "Competencia Matemática 2 (M2)" }
};

function fail(message) { throw new Error(message); }
function sha256(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function extractText(filePath) {
  const result = spawnSync("pdftotext", ["-layout", filePath, "-"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) fail(`No se pudo leer ${path.basename(filePath)}: ${result.stderr}`);
  return result.stdout;
}
function subjectFor(fileName) { return Object.entries(SUBJECTS).find(([fragment]) => fileName.includes(fragment))?.[1] || null; }
function parseKeys(text) {
  const section = text.split(/\bCLAVES\b/i).at(-1)?.split(/Ejemplo de cálculo de puntaje/i)[0] || "";
  const keys = {};
  const excluded = [];
  const eliminated = [];
  for (const line of section.split(/\r?\n/)) {
    for (const match of line.matchAll(/(\d+)(\*{1,2})?\s+([A-E])\b/g)) {
      const number = Number(match[1]);
      keys[number] = match[3];
      if (match[2] === "*") excluded.push(number);
      if (match[2] === "**") eliminated.push(number);
    }
    for (const match of line.matchAll(/(\d+)\*\*(?!\s+[A-E]\b)/g)) eliminated.push(Number(match[1]));
  }
  return { keys: Object.fromEntries(Object.entries(keys).sort((a, b) => Number(a[0]) - Number(b[0]))), excluded: [...new Set(excluded)].sort((a, b) => a - b), eliminated: [...new Set(eliminated)].sort((a, b) => a - b) };
}
function parseScoreTable(text, scoredQuestions) {
  const section = text.slice(text.lastIndexOf("TABLA DE TRANSFORMACIÓN"));
  const scores = {};
  for (const line of section.split(/\r?\n/)) for (const match of line.matchAll(/(\d+)\s+(\d{3,4})\b/g)) {
    const raw = Number(match[1]);
    const score = Number(match[2]);
    if (raw <= scoredQuestions && score >= 100 && score <= 1000) scores[raw] = score;
  }
  return Object.fromEntries(Object.entries(scores).sort((a, b) => Number(a[0]) - Number(b[0])));
}
function parseFile(filePath) {
  const fileName = path.basename(filePath);
  const subject = subjectFor(fileName);
  if (!subject) fail(`No se reconoce la asignatura de ${fileName}.`);
  const text = extractText(filePath);
  const form = Number(text.match(/FORMA\s+(\d+)/i)?.[1] || 0);
  const countMatch = text.match(/tiene\s+(\d+)\s+preguntas,\s+y\s+solo\s+(\d+)/i);
  const questionCount = Number(countMatch?.[1] || 0);
  const publishedScoredQuestions = Number(countMatch?.[2] || 0);
  const parsed = parseKeys(text);
  const scoreTable = parseScoreTable(text, questionCount);
  const scoredQuestions = Math.max(...Object.keys(scoreTable).map(Number));
  if (!form || !questionCount || Object.keys(parsed.keys).length !== questionCount - parsed.eliminated.length) fail(`${fileName} no produjo un clavijero completo.`);
  if (Object.keys(scoreTable).length !== scoredQuestions + 1) fail(`${fileName} no produjo una tabla completa de 0 a ${scoredQuestions}.`);
  return { ...subject, process: "Admisión 2026", type: "PAES Regular", form, questionCount, publishedScoredQuestions, scoredQuestions, excludedQuestions: parsed.excluded, eliminatedQuestions: parsed.eliminated, answerKeys: parsed.keys, scoreTable, source: { fileName, sha256: sha256(filePath), organization: "DEMRE - Universidad de Chile" } };
}
function main() {
  const inputDirectory = path.resolve(process.argv[2] || ".");
  const outputPath = path.resolve(process.argv[3] || path.join(__dirname, "..", "resources", "education", "paes-2026-clavijeros.json"));
  const browserOutputPath = path.resolve(process.argv[4] || path.join(__dirname, "..", "out", "education", "data", "paes-2026-clavijeros.js"));
  const files = fs.readdirSync(inputDirectory).filter((fileName) => /^2026-.*clavijero-paes-regular-.*\.pdf$/i.test(fileName)).sort();
  if (!files.length) fail(`No se encontraron clavijeros en ${inputDirectory}.`);
  const exams = files.map((fileName) => parseFile(path.join(inputDirectory, fileName)));
  const payload = { schemaVersion: 1, generatedAt: new Date().toISOString(), notice: "Datos derivados de clavijeros oficiales. No contiene enunciados ni reproduce cuadernillos de preguntas.", exams };
  const serialized = JSON.stringify(payload, null, 2);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(browserOutputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${serialized}\n`, "utf8");
  fs.writeFileSync(browserOutputPath, `"use strict";\nwindow.DORN_PAES_2026 = ${serialized};\n`, "utf8");
  console.log(`Clavijeros importados: ${exams.length} · ${outputPath} · ${browserOutputPath}`);
}
main();
