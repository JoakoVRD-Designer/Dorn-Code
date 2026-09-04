"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const ledger = JSON.parse(fs.readFileSync(path.join(root, "verification", "pdf-current-source-ledger.json"), "utf8"));

test("el alcance CURRENT usa los cuatro PDF realmente recibidos y detecta la copia byte-idéntica", () => {
  assert.equal(ledger.sourceSet.attachedFiles, 4);
  assert.equal(ledger.sourceSet.uniqueDocuments, 3);
  assert.equal(ledger.sourceSet.attachedPages, 1075);
  assert.equal(ledger.sourceSet.uniquePages, 1064);
  assert.equal(ledger.documents.length, 4);
  const parity = ledger.documents.filter((document) => document.sha256 === "9e8e70131d8dd0b69580ae00e60f54f5352b42523aee40ba38b090e358196728");
  assert.equal(parity.length, 2);
  assert.equal(parity.filter((document) => document.duplicateOf === "PDF-CODEX-PARITY-P0").length, 1);
  assert.ok(ledger.documents.some((document) => document.pages === 1033 && document.sha256 === "20026ccfc027ee10a9fc95fd5e671a9fd99fc8ea2235d3a68f07ee027ecdd63a"));
  assert.ok(ledger.documents.some((document) => document.pages === 20 && document.sha256 === "242769428452fab501a796ae471a4540d344ab32c8d5f944d665f5e8d29001ca"));
});

test("cada grupo CURRENT tiene identidad única y conserva estados parciales honestos", () => {
  const ids = ledger.currentRequirementGroups.map((item) => item.requirementId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ledger.currentRequirementGroups.every((item) => item.name && item.state));
  for (let index = 1; index <= 12; index += 1) assert.ok(ids.includes(`PARITY-P0-${String(index).padStart(2, "0")}`));
  assert.ok(ids.includes("PLAN-P0-DURABLE-JOBS"));
  assert.ok(ids.includes("PLAN-P0-GODOT"));
  assert.ok(ids.includes("MASTER-HISTORICAL-BODY"));
  assert.equal(ledger.globalState, "PARTIAL");
  assert.equal(ledger.state, "PARTIAL");
  assert.match(ledger.claim, /does not claim/i);
});

test("la decisión explícita del usuario protege splash, interfaz 4.0 y conexión Kimi de un paso", () => {
  const decisions = new Map(ledger.userOverrides.map((item) => [item.requirementId, item]));
  assert.equal(decisions.get("USER-STARTUP-7000MS").state, "VERIFIED_BY_REGRESSION");
  assert.equal(decisions.get("USER-PRESERVE-DORN-4-UI").state, "VERIFIED_BY_HASH_LEDGER");
  assert.equal(decisions.get("USER-AI-ONE-KEY").state, "TESTED_STATIC_NEEDS_LIVE_KEYS");
});
