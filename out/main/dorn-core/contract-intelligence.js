"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { projectIdentity } = require("./job-runtime");
const { safeRelative } = require("./project-integrity");

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const MAX_CONTRACT_BYTES = 4 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 32 * 1024 * 1024;
const SENSITIVE_KEY = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|secret|password|credential|private[_-]?key)$/i;
const SAFE_PLACEHOLDER = /^(?:\$\{[^}]+\}|\{\{[^}]+\}\}|<[^>]+>|\[[^\]]+\]|process\.env\.[A-Z0-9_]+|env:[A-Z0-9_]+|example|placeholder|redacted|none|null)$/i;

function contractError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function timestamp() { return new Date().toISOString(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function stableJson(value) {
  if (value === undefined) return '"__DORN_UNDEFINED__"';
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function boundedText(value, maximum, label, options = {}) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text && options.required !== false) throw contractError("CONTRACT_INPUT_INVALID", `${label} es obligatorio.`);
  if (text.length > maximum) throw contractError("CONTRACT_INPUT_TOO_LARGE", `${label} excede el límite seguro.`);
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(text)) {
    throw contractError("CONTRACT_SECRET_INLINE", `${label} contiene una credencial.`);
  }
  return text;
}

function stableId(value, label, options = {}) {
  const text = boundedText(value, options.maximum || 200, label, options);
  if (text && !/^[a-zA-Z0-9_.:@/-]+$/.test(text)) throw contractError("CONTRACT_ID_INVALID", `${label} no tiene una identidad estable.`);
  return text;
}

function hasSecretMaterial(value, depth = 0) {
  if (depth > 30) return true;
  if (typeof value === "string") return /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasSecretMaterial(item, depth + 1));
  return Object.entries(value).some(([key, item]) => {
    if (SENSITIVE_KEY.test(key) && typeof item === "string" && item.length >= 8 && !SAFE_PLACEHOLDER.test(item)) return true;
    return hasSecretMaterial(item, depth + 1);
  });
}

function uniqueSorted(values) { return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right))); }

function readIndexedFile(root, candidate) {
  if (candidate.hashState !== "HASHED" || !HASH_PATTERN.test(String(candidate.sha256 || ""))) throw contractError("CONTRACT_SOURCE_UNHASHED", `${candidate.path} no tiene un hash completo.`);
  if (candidate.sizeBytes <= 0 || candidate.sizeBytes > MAX_CONTRACT_BYTES) throw contractError("CONTRACT_FILE_INVALID", `${candidate.path} está vacío o excede ${MAX_CONTRACT_BYTES} bytes.`);
  const checked = safeRelative(root, candidate.path);
  const stat = fs.lstatSync(checked.absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw contractError("CONTRACT_SOURCE_UNSAFE", `${candidate.path} no es un archivo regular seguro.`);
  const real = fs.realpathSync(checked.absolute);
  if (!real.startsWith(`${root}${path.sep}`)) throw contractError("CONTRACT_SOURCE_ESCAPE", `${candidate.path} sale del proyecto.`);
  if (stat.size !== candidate.sizeBytes || Math.trunc(stat.mtimeMs) !== candidate.modifiedMs) throw contractError("CONTRACT_INDEX_STALE", `${candidate.path} cambió después del índice.`);
  const descriptor = fs.openSync(checked.absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const buffer = Buffer.alloc(stat.size);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw contractError("CONTRACT_SOURCE_RACE", `${candidate.path} cambió durante la lectura.`);
    let position = 0;
    while (position < buffer.length) {
      const read = fs.readSync(descriptor, buffer, position, buffer.length - position, position);
      if (!read) throw contractError("CONTRACT_SOURCE_RACE", `${candidate.path} quedó truncado durante la lectura.`);
      position += read;
    }
    const after = fs.fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw contractError("CONTRACT_SOURCE_RACE", `${candidate.path} cambió durante la lectura.`);
  } finally { fs.closeSync(descriptor); }
  if (buffer.includes(0)) throw contractError("CONTRACT_FILE_INVALID", `${candidate.path} contiene bytes binarios.`);
  const actualHash = sha256(buffer);
  if (actualHash !== candidate.sha256) throw contractError("CONTRACT_INDEX_STALE", `${candidate.path} no coincide con el hash del índice.`);
  return { source: buffer.toString("utf8"), sourceHash: actualHash, bytes: buffer.length };
}

function localPointer(document, reference) {
  if (!reference || !String(reference).startsWith("#/")) return null;
  let current = document;
  for (const raw of String(reference).slice(2).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) return null;
    current = current[segment];
  }
  return current;
}

function dereference(schema, document) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  return typeof schema.$ref === "string" ? localPointer(document, schema.$ref) || schema : schema;
}

function schemaTypes(schema) {
  const raw = schema?.type;
  if (!raw) return [];
  return uniqueSorted(Array.isArray(raw) ? raw.map(String) : [String(raw)]);
}

function compareJsonSchema(previousInput = {}, nextInput = {}, options = {}) {
  const breaking = [], compatible = [], review = [];
  const previousRoot = options.previousRoot || previousInput;
  const nextRoot = options.nextRoot || nextInput;
  const visited = new Set();
  const walk = (oldInput, newInput, schemaPath, depth) => {
    if (depth > 40) { review.push({ type: "SCHEMA_DEPTH_REVIEW_REQUIRED", path: schemaPath }); return; }
    const previous = dereference(oldInput, previousRoot);
    const next = dereference(newInput, nextRoot);
    const visitKey = `${schemaPath}:${sha256(stableJson(previous)).slice(0, 12)}:${sha256(stableJson(next)).slice(0, 12)}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    if (previous === true && next === false) { breaking.push({ type: "SCHEMA_NOW_REJECTS_ALL", path: schemaPath }); return; }
    if (previous === false && next === true) { compatible.push({ type: "SCHEMA_NOW_ACCEPTS_ALL", path: schemaPath }); return; }
    if (!previous || !next || typeof previous !== "object" || typeof next !== "object") {
      if (stableJson(previous) !== stableJson(next)) review.push({ type: "SCHEMA_SHAPE_REVIEW_REQUIRED", path: schemaPath });
      return;
    }
    const oldTypes = schemaTypes(previous), newTypes = schemaTypes(next);
    if (oldTypes.length && newTypes.length) {
      const removed = oldTypes.filter((type) => !newTypes.includes(type));
      const added = newTypes.filter((type) => !oldTypes.includes(type));
      if (removed.length) breaking.push({ type: "TYPE_NARROWED_OR_CHANGED", path: schemaPath, removed, from: oldTypes, to: newTypes });
      if (added.length) compatible.push({ type: "TYPE_WIDENED", path: schemaPath, added });
    }
    if (Object.hasOwn(previous, "const") && stableJson(previous.const) !== stableJson(next.const)) breaking.push({ type: "CONST_CHANGED", path: schemaPath, from: previous.const, to: next.const });
    if (Array.isArray(previous.enum) && Array.isArray(next.enum)) {
      for (const value of previous.enum) if (!next.enum.some((candidate) => stableJson(candidate) === stableJson(value))) breaking.push({ type: "ENUM_VALUE_REMOVED", path: schemaPath, value });
      for (const value of next.enum) if (!previous.enum.some((candidate) => stableJson(candidate) === stableJson(value))) compatible.push({ type: "ENUM_VALUE_ADDED", path: schemaPath, value });
    }
    const oldRequired = new Set(Array.isArray(previous.required) ? previous.required.map(String) : []);
    const newRequired = new Set(Array.isArray(next.required) ? next.required.map(String) : []);
    for (const name of newRequired) if (!oldRequired.has(name)) breaking.push({ type: "NEW_REQUIRED_FIELD", path: `${schemaPath}.${name}` });
    for (const name of oldRequired) if (!newRequired.has(name)) compatible.push({ type: "REQUIRED_RELAXED", path: `${schemaPath}.${name}` });
    const oldProperties = previous.properties && typeof previous.properties === "object" ? previous.properties : {};
    const newProperties = next.properties && typeof next.properties === "object" ? next.properties : {};
    for (const [name, oldProperty] of Object.entries(oldProperties)) {
      if (!Object.hasOwn(newProperties, name)) breaking.push({ type: "FIELD_REMOVED", path: `${schemaPath}.${name}` });
      else walk(oldProperty, newProperties[name], `${schemaPath}.${name}`, depth + 1);
    }
    for (const name of Object.keys(newProperties)) if (!Object.hasOwn(oldProperties, name)) compatible.push({ type: "FIELD_ADDED", path: `${schemaPath}.${name}`, required: newRequired.has(name) });
    if (previous.additionalProperties !== false && next.additionalProperties === false) breaking.push({ type: "ADDITIONAL_PROPERTIES_FORBIDDEN", path: schemaPath });
    const tightenedMinimum = [["minimum", true], ["exclusiveMinimum", true], ["minLength", true], ["minItems", true], ["minProperties", true]];
    const tightenedMaximum = [["maximum", false], ["exclusiveMaximum", false], ["maxLength", false], ["maxItems", false], ["maxProperties", false]];
    for (const [key] of tightenedMinimum) if (Number.isFinite(Number(previous[key])) && Number.isFinite(Number(next[key])) && Number(next[key]) > Number(previous[key])) breaking.push({ type: "CONSTRAINT_TIGHTENED", path: schemaPath, constraint: key, from: previous[key], to: next[key] });
    for (const [key] of tightenedMaximum) if (Number.isFinite(Number(previous[key])) && Number.isFinite(Number(next[key])) && Number(next[key]) < Number(previous[key])) breaking.push({ type: "CONSTRAINT_TIGHTENED", path: schemaPath, constraint: key, from: previous[key], to: next[key] });
    if (!previous.pattern && next.pattern) breaking.push({ type: "PATTERN_ADDED", path: schemaPath, pattern: next.pattern });
    else if (previous.pattern && next.pattern && previous.pattern !== next.pattern) review.push({ type: "PATTERN_CHANGED_REVIEW_REQUIRED", path: schemaPath });
    if (previous.items && next.items) walk(previous.items, next.items, `${schemaPath}[]`, depth + 1);
    else if (previous.items && !next.items) compatible.push({ type: "ITEM_SCHEMA_REMOVED", path: `${schemaPath}[]` });
    for (const keyword of ["allOf", "anyOf", "oneOf", "not", "if", "then", "else", "dependentSchemas"]) {
      if (stableJson(previous[keyword]) !== stableJson(next[keyword]) && (previous[keyword] !== undefined || next[keyword] !== undefined)) review.push({ type: "SCHEMA_COMPOSITION_CHANGED_REVIEW_REQUIRED", path: schemaPath, keyword });
    }
  };
  walk(previousInput, nextInput, options.path || "$", 0);
  return { breaking, compatible, review };
}

function resolvedObject(value, document) { return dereference(value, document) || {}; }

function operationParameters(pathItem, operation, document) {
  const output = new Map();
  for (const raw of [...(pathItem?.parameters || []), ...(operation?.parameters || [])]) {
    const parameter = resolvedObject(raw, document);
    if (parameter && parameter.name) output.set(`${parameter.in || "query"}:${parameter.name}`, parameter);
  }
  return output;
}

function mediaSchemas(content, document) {
  const output = new Map();
  for (const [mediaType, media] of Object.entries(content || {})) {
    const schema = resolvedObject(media, document)?.schema;
    if (schema) output.set(mediaType, schema);
  }
  return output;
}

function compareMedia(previousContent, nextContent, previousDocument, nextDocument, location, breaking, compatible, review) {
  const oldMedia = mediaSchemas(previousContent, previousDocument);
  const newMedia = mediaSchemas(nextContent, nextDocument);
  for (const [mediaType, oldSchema] of oldMedia) {
    if (!newMedia.has(mediaType)) { breaking.push({ type: "MEDIA_TYPE_REMOVED", path: location, mediaType }); continue; }
    const impact = compareJsonSchema(oldSchema, newMedia.get(mediaType), { previousRoot: previousDocument, nextRoot: nextDocument, path: `${location}.${mediaType}` });
    breaking.push(...impact.breaking); compatible.push(...impact.compatible); review.push(...impact.review);
  }
  for (const mediaType of newMedia.keys()) if (!oldMedia.has(mediaType)) compatible.push({ type: "MEDIA_TYPE_ADDED", path: location, mediaType });
}

function compareOpenApi(previous = {}, next = {}) {
  const breaking = [], compatible = [], review = [];
  if (String(previous.openapi || previous.swagger || "") !== String(next.openapi || next.swagger || "")) review.push({ type: "OPENAPI_VERSION_CHANGED_REVIEW_REQUIRED", from: previous.openapi || previous.swagger, to: next.openapi || next.swagger });
  for (const [route, oldPathInput] of Object.entries(previous.paths || {})) {
    const oldPath = resolvedObject(oldPathInput, previous);
    const nextPath = resolvedObject(next.paths?.[route], next);
    if (!next.paths?.[route]) { breaking.push({ type: "ENDPOINT_REMOVED", path: route }); continue; }
    for (const method of HTTP_METHODS) {
      const oldOperation = resolvedObject(oldPath?.[method], previous);
      if (!oldPath?.[method]) continue;
      const newOperation = resolvedObject(nextPath?.[method], next);
      const operationPath = `${method.toUpperCase()} ${route}`;
      if (!nextPath?.[method]) { breaking.push({ type: "METHOD_REMOVED", path: operationPath }); continue; }
      if (oldOperation.operationId && newOperation.operationId && oldOperation.operationId !== newOperation.operationId) breaking.push({ type: "OPERATION_ID_CHANGED", path: operationPath, from: oldOperation.operationId, to: newOperation.operationId });
      const oldParameters = operationParameters(oldPath, oldOperation, previous);
      const newParameters = operationParameters(nextPath, newOperation, next);
      for (const [key, parameter] of oldParameters) {
        if (!newParameters.has(key)) { breaking.push({ type: "PARAMETER_REMOVED", path: operationPath, parameter: key }); continue; }
        const current = newParameters.get(key);
        if (parameter.required !== true && current.required === true) breaking.push({ type: "PARAMETER_NOW_REQUIRED", path: operationPath, parameter: key });
        const impact = compareJsonSchema(parameter.schema || {}, current.schema || {}, { previousRoot: previous, nextRoot: next, path: `${operationPath}.parameter.${key}` });
        breaking.push(...impact.breaking); compatible.push(...impact.compatible); review.push(...impact.review);
      }
      for (const [key, parameter] of newParameters) if (!oldParameters.has(key)) (parameter.required ? breaking : compatible).push({ type: parameter.required ? "NEW_REQUIRED_PARAMETER" : "OPTIONAL_PARAMETER_ADDED", path: operationPath, parameter: key });
      const oldBody = resolvedObject(oldOperation.requestBody, previous), newBody = resolvedObject(newOperation.requestBody, next);
      if (oldBody.required !== true && newBody.required === true) breaking.push({ type: "REQUEST_BODY_NOW_REQUIRED", path: operationPath });
      compareMedia(oldBody.content, newBody.content, previous, next, `${operationPath}.request`, breaking, compatible, review);
      const oldResponses = oldOperation.responses || {}, newResponses = newOperation.responses || {};
      for (const [status, oldResponseInput] of Object.entries(oldResponses)) {
        if (!newResponses[status]) { breaking.push({ type: "RESPONSE_REMOVED", path: operationPath, status }); continue; }
        const oldResponse = resolvedObject(oldResponseInput, previous), newResponse = resolvedObject(newResponses[status], next);
        compareMedia(oldResponse.content, newResponse.content, previous, next, `${operationPath}.response.${status}`, breaking, compatible, review);
      }
      const oldSecurity = stableJson(oldOperation.security ?? previous.security ?? []);
      const newSecurity = stableJson(newOperation.security ?? next.security ?? []);
      if (oldSecurity !== newSecurity) review.push({ type: "SECURITY_REQUIREMENT_CHANGED_REVIEW_REQUIRED", path: operationPath });
    }
  }
  for (const route of Object.keys(next.paths || {})) if (!previous.paths?.[route]) compatible.push({ type: "ENDPOINT_ADDED", path: route });
  return { breaking, compatible, review };
}

function stripProtoComments(source) { return String(source || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); }

function blocks(source, keyword) {
  const output = [];
  const pattern = new RegExp(`\\b${keyword}\\s+([A-Za-z_]\\w*)\\s*\\{`, "g");
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const open = pattern.lastIndex - 1;
    let depth = 1, cursor = open + 1;
    while (cursor < source.length && depth) { if (source[cursor] === "{") depth += 1; else if (source[cursor] === "}") depth -= 1; cursor += 1; }
    if (depth) break;
    output.push({ name: match[1], body: source.slice(open + 1, cursor - 1), start: match.index, end: cursor });
    pattern.lastIndex = cursor;
  }
  return output;
}

function topLevelText(body) {
  let depth = 0, output = "";
  for (const character of body) {
    if (character === "{") { depth += 1; output += " "; }
    else if (character === "}") { depth = Math.max(0, depth - 1); output += " "; }
    else output += depth ? " " : character;
  }
  return output;
}

function parseProto(source) {
  const clean = stripProtoComments(source);
  const packageName = clean.match(/\bpackage\s+([A-Za-z_][\w.]*)\s*;/)?.[1] || null;
  const messages = {}, services = {}, enums = {};
  for (const message of blocks(clean, "message")) {
    const body = topLevelText(message.body);
    const fields = {}, reservedNumbers = new Set(), reservedNames = new Set();
    for (const reservation of body.matchAll(/\breserved\s+([^;]+);/g)) {
      for (const item of reservation[1].split(",").map((value) => value.trim())) {
        const named = item.match(/^["']([^"']+)["']$/);
        if (named) reservedNames.add(named[1]);
        else if (/^\d+$/.test(item)) reservedNumbers.add(Number(item));
        else {
          const range = item.match(/^(\d+)\s+to\s+(\d+|max)$/i);
          if (range && range[2].toLowerCase() !== "max" && Number(range[2]) - Number(range[1]) <= 10_000) for (let number = Number(range[1]); number <= Number(range[2]); number += 1) reservedNumbers.add(number);
        }
      }
    }
    const fieldPattern = /\b(optional|required|repeated)?\s*(map\s*<\s*[A-Za-z_.][\w.]*\s*,\s*[A-Za-z_.][\w.]*\s*>|[A-Za-z_.][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*(\d+)\s*(?:\[[^\]]*\])?\s*;/g;
    for (const field of body.matchAll(fieldPattern)) fields[field[4]] = { cardinality: field[1] || "implicit", type: field[2].replace(/\s+/g, ""), name: field[3], number: Number(field[4]) };
    for (const oneof of blocks(message.body, "oneof")) {
      for (const field of oneof.body.matchAll(/\b([A-Za-z_.][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*(\d+)\s*(?:\[[^\]]*\])?\s*;/g)) fields[field[3]] = { cardinality: `oneof:${oneof.name}`, type: field[1], name: field[2], number: Number(field[3]) };
    }
    messages[message.name] = { fields, reservedNumbers: [...reservedNumbers].sort((a, b) => a - b), reservedNames: [...reservedNames].sort() };
  }
  for (const service of blocks(clean, "service")) {
    const methods = {};
    for (const rpc of service.body.matchAll(/\brpc\s+([A-Za-z_]\w*)\s*\(\s*(stream\s+)?([A-Za-z_.][\w.]*)\s*\)\s+returns\s*\(\s*(stream\s+)?([A-Za-z_.][\w.]*)\s*\)/g)) methods[rpc[1]] = { request: rpc[3], requestStream: Boolean(rpc[2]), response: rpc[5], responseStream: Boolean(rpc[4]) };
    services[service.name] = { methods };
  }
  for (const enumeration of blocks(clean, "enum")) {
    const values = {};
    for (const item of topLevelText(enumeration.body).matchAll(/\b([A-Za-z_]\w*)\s*=\s*(-?\d+)\s*;/g)) values[item[1]] = Number(item[2]);
    enums[enumeration.name] = { values };
  }
  return { package: packageName, messages, services, enums };
}

function compareProto(previous = {}, next = {}) {
  const breaking = [], compatible = [], review = [];
  if (previous.package !== next.package) breaking.push({ type: "PROTO_PACKAGE_CHANGED", from: previous.package, to: next.package });
  for (const [name, oldMessage] of Object.entries(previous.messages || {})) {
    const newMessage = next.messages?.[name];
    if (!newMessage) { breaking.push({ type: "PROTO_MESSAGE_REMOVED", path: name }); continue; }
    for (const [number, oldField] of Object.entries(oldMessage.fields || {})) {
      const newField = newMessage.fields?.[number];
      if (!newField) {
        const safelyReserved = newMessage.reservedNumbers?.includes(Number(number)) && newMessage.reservedNames?.includes(oldField.name);
        (safelyReserved ? compatible : breaking).push({ type: safelyReserved ? "PROTO_FIELD_REMOVED_AND_RESERVED" : "PROTO_FIELD_REMOVED_UNRESERVED", path: `${name}.${oldField.name}`, number: Number(number) });
        continue;
      }
      if (oldField.name !== newField.name) breaking.push({ type: "PROTO_FIELD_NUMBER_REUSED_OR_RENAMED", path: name, number: Number(number), from: oldField.name, to: newField.name });
      if (oldField.type !== newField.type || oldField.cardinality !== newField.cardinality) breaking.push({ type: "PROTO_FIELD_TYPE_CHANGED", path: `${name}.${oldField.name}`, number: Number(number), from: `${oldField.cardinality} ${oldField.type}`, to: `${newField.cardinality} ${newField.type}` });
    }
    for (const [number, field] of Object.entries(newMessage.fields || {})) if (!oldMessage.fields?.[number]) (field.cardinality === "required" ? breaking : compatible).push({ type: field.cardinality === "required" ? "PROTO_REQUIRED_FIELD_ADDED" : "PROTO_FIELD_ADDED", path: `${name}.${field.name}`, number: Number(number) });
  }
  for (const [name, oldService] of Object.entries(previous.services || {})) {
    const newService = next.services?.[name];
    if (!newService) { breaking.push({ type: "PROTO_SERVICE_REMOVED", path: name }); continue; }
    for (const [method, signature] of Object.entries(oldService.methods || {})) {
      const current = newService.methods?.[method];
      if (!current) breaking.push({ type: "PROTO_RPC_REMOVED", path: `${name}.${method}` });
      else if (stableJson(signature) !== stableJson(current)) breaking.push({ type: "PROTO_RPC_SIGNATURE_CHANGED", path: `${name}.${method}`, from: signature, to: current });
    }
  }
  for (const [name, oldEnum] of Object.entries(previous.enums || {})) {
    const newEnum = next.enums?.[name];
    if (!newEnum) { breaking.push({ type: "PROTO_ENUM_REMOVED", path: name }); continue; }
    for (const [valueName, number] of Object.entries(oldEnum.values || {})) {
      if (!Object.hasOwn(newEnum.values || {}, valueName)) breaking.push({ type: "PROTO_ENUM_VALUE_REMOVED", path: `${name}.${valueName}`, number });
      else if (newEnum.values[valueName] !== number) breaking.push({ type: "PROTO_ENUM_VALUE_RENUMBERED", path: `${name}.${valueName}`, from: number, to: newEnum.values[valueName] });
    }
  }
  return { breaking, compatible, review };
}

function parseMapping(root, parsed) {
  if (!parsed || parsed.schema !== "dorn.contract-map/1" || !Array.isArray(parsed.contracts)) throw contractError("CONTRACT_MAPPING_INVALID", "dorn.contracts.json no tiene el contrato esperado.");
  if (parsed.contracts.length > 2000) throw contractError("CONTRACT_MAPPING_TOO_LARGE", "dorn.contracts.json declara demasiados contratos.");
  const output = new Map();
  for (const [index, raw] of parsed.contracts.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw contractError("CONTRACT_MAPPING_INVALID", `contracts[${index}] no es estructurado.`);
    const relativePath = safeRelative(root, raw.path).relativePath;
    const list = (value, label, maximum = 500) => {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.length > maximum) throw contractError("CONTRACT_MAPPING_INVALID", `${label} debe ser una lista acotada.`);
      return uniqueSorted(value.map((item, itemIndex) => boundedText(item, 1000, `${label}[${itemIndex}]`)));
    };
    const contractTests = list(raw.contractTests, `contracts[${index}].contractTests`).map((testPath) => {
      const checked = safeRelative(root, testPath);
      let stat;
      try { stat = fs.lstatSync(checked.absolute); } catch { throw contractError("CONTRACT_TEST_NOT_FOUND", `${checked.relativePath} no existe.`); }
      if (!stat.isFile() || stat.isSymbolicLink() || !fs.realpathSync(checked.absolute).startsWith(`${root}${path.sep}`)) throw contractError("CONTRACT_TEST_UNSAFE", `${checked.relativePath} no es un test regular seguro.`);
      return checked.relativePath;
    });
    output.set(relativePath, {
      producers: list(raw.producers, `contracts[${index}].producers`),
      consumers: list(raw.consumers, `contracts[${index}].consumers`), contractTests,
      owner: raw.owner ? boundedText(raw.owner, 500, `contracts[${index}].owner`) : null
    });
  }
  if (hasSecretMaterial(parsed)) throw contractError("CONTRACT_SECRET_INLINE", "dorn.contracts.json contiene una credencial.");
  return output;
}

function parseCandidate(candidate, source) {
  const lower = candidate.path.toLowerCase();
  if (lower.endsWith(".proto")) return { format: "PROTOBUF", document: parseProto(source) };
  if (/\.(?:yaml|yml)$/.test(lower)) return { format: "OPENAPI_YAML", adapterState: "NEEDS_YAML_ADAPTER", document: null };
  let document;
  try { document = JSON.parse(source); } catch { throw contractError("CONTRACT_PARSE_FAILED", `${candidate.path} no contiene JSON válido.`); }
  if (hasSecretMaterial(document)) throw contractError("CONTRACT_SECRET_INLINE", `${candidate.path} contiene una credencial literal.`);
  if (document?.openapi || document?.swagger) return { format: "OPENAPI", document };
  if (document?.asyncapi) return { format: "ASYNCAPI", adapterState: "NEEDS_ASYNCAPI_ADAPTER", document };
  if (document?.$schema || document?.type || document?.properties || document?.$defs || document?.definitions || document?.oneOf || document?.anyOf) return { format: "JSON_SCHEMA", document };
  throw contractError("CONTRACT_FORMAT_UNKNOWN", `${candidate.path} no declara JSON Schema, OpenAPI ni Protobuf.`);
}

function isContractPath(relativePath) {
  const lower = String(relativePath || "").replaceAll("\\", "/").toLowerCase();
  return lower === "dorn.contracts.json" || lower.endsWith(".proto") || lower.endsWith(".schema.json") ||
    /(^|\/)(?:openapi|swagger|asyncapi)\.(?:json|ya?ml)$/.test(lower) ||
    /\.(?:openapi|swagger|asyncapi)\.json$/.test(lower);
}

function readIsolatedFile(root, relativePath) {
  const checked = safeRelative(root, relativePath);
  if (!fs.existsSync(checked.absolute)) return null;
  const stat = fs.lstatSync(checked.absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_CONTRACT_BYTES) throw contractError("CONTRACT_SOURCE_UNSAFE", `${checked.relativePath} no es un contrato regular acotado.`);
  const real = fs.realpathSync(checked.absolute);
  if (!real.startsWith(`${root}${path.sep}`)) throw contractError("CONTRACT_SOURCE_ESCAPE", `${checked.relativePath} sale del aislamiento.`);
  const descriptor = fs.openSync(checked.absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const buffer = Buffer.alloc(stat.size);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw contractError("CONTRACT_SOURCE_RACE", `${checked.relativePath} cambió durante el gate.`);
    let position = 0;
    while (position < buffer.length) {
      const read = fs.readSync(descriptor, buffer, position, buffer.length - position, position);
      if (!read) throw contractError("CONTRACT_SOURCE_RACE", `${checked.relativePath} quedó truncado durante el gate.`);
      position += read;
    }
  } finally { fs.closeSync(descriptor); }
  if (buffer.includes(0)) throw contractError("CONTRACT_FILE_INVALID", `${checked.relativePath} contiene bytes binarios.`);
  return { source: buffer.toString("utf8"), sourceHash: sha256(buffer), bytes: buffer.length };
}

function compareContracts(previous, next) {
  if (previous.format !== next.format) return { breaking: [{ type: "CONTRACT_FORMAT_CHANGED", from: previous.format, to: next.format }], compatible: [], review: [] };
  if (previous.format === "JSON_SCHEMA") return compareJsonSchema(previous.document, next.document);
  if (previous.format === "OPENAPI") return compareOpenApi(previous.document, next.document);
  if (previous.format === "PROTOBUF") return compareProto(previous.document, next.document);
  return { breaking: [], compatible: [], review: [{ type: "CONTRACT_ADAPTER_REQUIRED", format: previous.format }] };
}

class ContractIntelligence {
  constructor(options = {}) {
    this.projectCore = options.projectCore || null;
    this.projectIntegrity = options.projectIntegrity || null;
    this.eventBus = options.eventBus || null;
  }

  projectCore;
  projectIntegrity;
  eventBus;
  databases = new Map();
  databaseOwners = new Map();

  databasePath(root) { return path.join(root, ".dorn", "manifests", "contract-intelligence.db"); }

  ensure(project) {
    const identity = projectIdentity(project, this.projectCore);
    if (this.databases.has(identity.root)) {
      if (this.databaseOwners.get(identity.root) !== identity.projectId) throw contractError("CONTRACT_PROJECT_IDENTITY_MISMATCH", "La base de contratos abierta pertenece a otra identidad.");
      return { ...identity, db: this.databases.get(identity.root) };
    }
    const manifestsRoot = path.join(identity.root, ".dorn", "manifests");
    const metadataStat = fs.lstatSync(manifestsRoot);
    if (!metadataStat.isDirectory() || metadataStat.isSymbolicLink() || path.dirname(fs.realpathSync(manifestsRoot)) !== fs.realpathSync(path.join(identity.root, ".dorn"))) throw contractError("CONTRACT_METADATA_UNSAFE", ".dorn/manifests no es una carpeta segura.");
    const databasePath = this.databasePath(identity.root);
    if (fs.existsSync(databasePath)) {
      const stat = fs.lstatSync(databasePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw contractError("CONTRACT_METADATA_UNSAFE", "La base Contract Intelligence no es un archivo regular seguro.");
    }
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=3000;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS contract_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS contract_snapshots(
          snapshot_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,label TEXT NOT NULL,source_scan_id TEXT NOT NULL,
          inventory_hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_contract_snapshots_project ON contract_snapshots(project_id,created_at DESC);
        CREATE TABLE IF NOT EXISTS contract_analyses(
          analysis_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,state TEXT NOT NULL,
          analysis_hash TEXT NOT NULL,analysis_json TEXT NOT NULL,created_at TEXT NOT NULL
        );
      `);
      const owner = db.prepare("SELECT value FROM contract_metadata WHERE key='project_id'").get()?.value || null;
      const foreign = Number(db.prepare("SELECT COUNT(*) AS count FROM contract_snapshots WHERE project_id!=?").get(identity.projectId).count);
      if ((owner && owner !== identity.projectId) || foreign) throw contractError("CONTRACT_PROJECT_IDENTITY_MISMATCH", "La base Contract Intelligence contiene otra identidad.");
      if (!owner) db.prepare("INSERT INTO contract_metadata(key,value) VALUES('project_id',?)").run(identity.projectId);
    } catch (error) { try { db.close(); } catch {} throw error; }
    this.databases.set(identity.root, db);
    this.databaseOwners.set(identity.root, identity.projectId);
    return { ...identity, db };
  }

  inventory(project, input = {}) {
    if (!this.projectIntegrity) throw contractError("CONTRACT_INTEGRITY_UNAVAILABLE", "Contract Intelligence necesita Project Integrity.");
    const identity = this.ensure(project);
    const candidates = this.projectIntegrity.contractCandidates(project, { limit: input.limit });
    if (candidates.state !== "READY") throw contractError(candidates.state === "SCAN_REQUIRED" ? "CONTRACT_SCAN_REQUIRED" : "CONTRACT_INDEX_STALE", candidates.state === "SCAN_REQUIRED" ? "Contract Intelligence requiere un escaneo completo." : "Contract Intelligence requiere reindexar los cambios pendientes.", { candidates });
    const mappingCandidate = candidates.candidates.find((candidate) => candidate.role === "MAPPING") || null;
    let mapping = new Map(), mappingHash = null, consumedBytes = 0;
    if (mappingCandidate) {
      const inspected = readIndexedFile(identity.root, mappingCandidate);
      consumedBytes += inspected.bytes;
      let parsed;
      try { parsed = JSON.parse(inspected.source); } catch { throw contractError("CONTRACT_MAPPING_INVALID", "dorn.contracts.json no contiene JSON válido."); }
      mapping = parseMapping(identity.root, parsed);
      mappingHash = inspected.sourceHash;
    }
    const contracts = [], failures = [];
    for (const candidate of candidates.candidates.filter((entry) => entry.role === "CONTRACT")) {
      if (consumedBytes >= MAX_INVENTORY_BYTES) break;
      try {
        const inspected = readIndexedFile(identity.root, candidate);
        consumedBytes += inspected.bytes;
        if (consumedBytes > MAX_INVENTORY_BYTES) break;
        const parsed = parseCandidate(candidate, inspected.source);
        const relationship = mapping.get(candidate.path) || { producers: [], consumers: [], contractTests: [], owner: null };
        contracts.push({
          schema: "dorn.contract/3", contractId: candidate.path, path: candidate.path,
          format: parsed.format, adapterState: parsed.adapterState || "SUPPORTED", document: parsed.document,
          sourceHash: inspected.sourceHash, contractHash: parsed.document === null ? inspected.sourceHash : sha256(stableJson(parsed.document)),
          bytes: inspected.bytes, producers: relationship.producers, consumers: relationship.consumers,
          contractTests: relationship.contractTests, owner: relationship.owner
        });
      } catch (error) {
        failures.push({ path: candidate.path, code: error.code || "CONTRACT_PARSE_FAILED", message: String(error.message || error).slice(0, 1000) });
      }
    }
    const knownPaths = new Set(contracts.map((contract) => contract.path));
    const contractsWithoutMapping = contracts.map((contract) => contract.path).filter((relativePath) => !mapping.has(relativePath));
    const danglingMappings = [...mapping.keys()].filter((relativePath) => !knownPaths.has(relativePath));
    const adapterRequired = contracts.filter((contract) => contract.adapterState !== "SUPPORTED").map((contract) => ({ path: contract.path, format: contract.format, adapterState: contract.adapterState }));
    const budgetExceeded = consumedBytes > MAX_INVENTORY_BYTES || candidates.candidates.filter((entry) => entry.role === "CONTRACT").length > contracts.length + failures.length;
    const state = candidates.truncated ? "TRUNCATED" : budgetExceeded ? "BUDGET_EXCEEDED" : failures.length || contractsWithoutMapping.length || danglingMappings.length || adapterRequired.length ? "REVIEW_REQUIRED" : "READY";
    const core = {
      schema: "dorn.contract-inventory/2", projectId: identity.projectId, state,
      sourceScanId: candidates.sourceScanId, mappingHash, indexedFiles: candidates.indexedFiles,
      candidateCount: candidates.candidates.filter((entry) => entry.role === "CONTRACT").length,
      contracts: contracts.sort((left, right) => left.path.localeCompare(right.path)), failures,
      contractsWithoutMapping, danglingMappings, adapterRequired,
      truncated: candidates.truncated, consumedBytes, budgetBytes: MAX_INVENTORY_BYTES,
      generatedAt: timestamp()
    };
    return { ...core, inventoryHash: sha256(stableJson(core)) };
  }

  snapshot(project, input = {}) {
    const identity = this.ensure(project);
    const inventory = this.inventory(project, input);
    if (inventory.state !== "READY") throw contractError("CONTRACT_INVENTORY_INCOMPLETE", "No se creará un baseline con inventario parcial o ambiguo.", { inventoryState: inventory.state });
    if (!inventory.contracts.length) throw contractError("CONTRACT_INVENTORY_EMPTY", "No existen contratos soportados para crear el baseline.");
    const createdAt = timestamp();
    const snapshotBody = {
      schema: "dorn.contract-snapshot/2", snapshotId: crypto.randomUUID(), projectId: identity.projectId,
      label: boundedText(input.label || "Contract baseline", 500, "label"), sourceScanId: inventory.sourceScanId,
      inventoryHash: inventory.inventoryHash, contracts: inventory.contracts, mappingHash: inventory.mappingHash, createdAt
    };
    const snapshot = { ...snapshotBody, snapshotHash: sha256(stableJson(snapshotBody)) };
    const snapshotJson = JSON.stringify(snapshot);
    if (Buffer.byteLength(snapshotJson, "utf8") > 64 * 1024 * 1024) throw contractError("CONTRACT_SNAPSHOT_TOO_LARGE", "El baseline de contratos excede el límite durable.");
    identity.db.prepare(`INSERT INTO contract_snapshots(snapshot_id,project_id,label,source_scan_id,inventory_hash,snapshot_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(snapshot.snapshotId, identity.projectId, snapshot.label, snapshot.sourceScanId, snapshot.inventoryHash, snapshotJson, createdAt);
    void this.eventBus?.publish("CONTRACT_SNAPSHOT_CREATED", { snapshotId: snapshot.snapshotId, contracts: snapshot.contracts.length }, { projectId: identity.projectId, idempotencyKey: `contract-snapshot:${snapshot.snapshotId}` });
    return snapshot;
  }

  getSnapshot(project, snapshotId) {
    const identity = this.ensure(project);
    const id = stableId(snapshotId, "snapshotId");
    const row = identity.db.prepare("SELECT snapshot_json,inventory_hash FROM contract_snapshots WHERE snapshot_id=? AND project_id=?").get(id, identity.projectId);
    if (!row) throw contractError("CONTRACT_SNAPSHOT_NOT_FOUND", "El baseline de contratos no existe en este proyecto.");
    let snapshot;
    try { snapshot = JSON.parse(row.snapshot_json); } catch { throw contractError("CONTRACT_SNAPSHOT_CORRUPT", "El baseline de contratos está dañado."); }
    const declaredHash = snapshot.snapshotHash;
    const body = { ...snapshot };
    delete body.snapshotHash;
    if (snapshot.schema !== "dorn.contract-snapshot/2" || snapshot.snapshotId !== id || snapshot.projectId !== identity.projectId || snapshot.inventoryHash !== row.inventory_hash || !HASH_PATTERN.test(String(declaredHash || "")) || sha256(stableJson(body)) !== declaredHash) throw contractError("CONTRACT_SNAPSHOT_CORRUPT", "El baseline de contratos perdió su identidad o su hash canónico.");
    return snapshot;
  }

  analyze(project, input = {}) {
    const identity = this.ensure(project);
    const baseline = this.getSnapshot(project, input.snapshotId);
    const current = this.inventory(project, input);
    if (!["READY", "REVIEW_REQUIRED"].includes(current.state)) throw contractError("CONTRACT_INVENTORY_INCOMPLETE", "El análisis no puede usar un inventario truncado u obsoleto.", { inventoryState: current.state });
    const before = new Map(baseline.contracts.map((contract) => [contract.path, contract]));
    const after = new Map(current.contracts.map((contract) => [contract.path, contract]));
    const impacts = [];
    for (const relativePath of uniqueSorted([...before.keys(), ...after.keys()])) {
      const previous = before.get(relativePath), next = after.get(relativePath);
      if (previous && !next) {
        impacts.push({ path: relativePath, changed: true, format: previous.format, state: "BREAKING", breaking: [{ type: "CONTRACT_REMOVED", path: relativePath }], compatible: [], review: [], affectedProducers: previous.producers, affectedConsumers: previous.consumers, contractTests: previous.contractTests });
        continue;
      }
      if (!previous && next) {
        impacts.push({ path: relativePath, changed: true, format: next.format, state: next.adapterState === "SUPPORTED" ? "COMPATIBLE" : "REVIEW_REQUIRED", breaking: [], compatible: [{ type: "CONTRACT_ADDED", path: relativePath }], review: next.adapterState === "SUPPORTED" ? [] : [{ type: "CONTRACT_ADAPTER_REQUIRED", format: next.format }], affectedProducers: next.producers, affectedConsumers: next.consumers, contractTests: next.contractTests });
        continue;
      }
      if (previous.sourceHash === next.sourceHash && stableJson(previous.producers) === stableJson(next.producers) && stableJson(previous.consumers) === stableJson(next.consumers) && stableJson(previous.contractTests) === stableJson(next.contractTests)) continue;
      const compared = compareContracts(previous, next);
      const semanticChanged = previous.contractHash !== next.contractHash;
      const review = [...compared.review];
      if (!semanticChanged && previous.sourceHash !== next.sourceHash) compared.compatible.push({ type: "FORMAT_ONLY_CHANGE", path: relativePath });
      if (stableJson(previous.producers) !== stableJson(next.producers) || stableJson(previous.consumers) !== stableJson(next.consumers)) review.push({ type: "PRODUCER_CONSUMER_MAPPING_CHANGED_REVIEW_REQUIRED", path: relativePath });
      impacts.push({
        path: relativePath, changed: true, semanticChanged, format: next.format,
        state: compared.breaking.length ? "BREAKING" : review.length ? "REVIEW_REQUIRED" : "COMPATIBLE",
        breaking: compared.breaking, compatible: compared.compatible, review,
        affectedProducers: uniqueSorted([...(previous.producers || []), ...(next.producers || [])]),
        affectedConsumers: uniqueSorted([...(previous.consumers || []), ...(next.consumers || [])]),
        contractTests: uniqueSorted([...(previous.contractTests || []), ...(next.contractTests || [])]),
        previousHash: previous.sourceHash, currentHash: next.sourceHash
      });
    }
    const breaking = impacts.flatMap((impact) => impact.breaking.map((entry) => ({ contract: impact.path, ...entry })));
    const review = [
      ...current.failures.map((failure) => ({ type: "CONTRACT_PARSE_FAILURE", ...failure })),
      ...current.contractsWithoutMapping.map((contract) => ({ type: "CONTRACT_MAPPING_MISSING", contract })),
      ...current.danglingMappings.map((contract) => ({ type: "MAPPING_TARGET_MISSING", contract })),
      ...current.adapterRequired.map((entry) => ({ type: "CONTRACT_ADAPTER_REQUIRED", contract: entry.path, format: entry.format })),
      ...impacts.flatMap((impact) => impact.review.map((entry) => ({ contract: impact.path, ...entry })))
    ];
    const affectedProducers = uniqueSorted(impacts.flatMap((impact) => impact.affectedProducers));
    const affectedConsumers = uniqueSorted(impacts.flatMap((impact) => impact.affectedConsumers));
    const contractTests = uniqueSorted(impacts.flatMap((impact) => impact.contractTests));
    const state = breaking.length ? "BLOCKED_BREAKING_CHANGE" : review.length ? "REVIEW_REQUIRED" : impacts.length && !contractTests.length ? "BLOCKED_CONTRACT_TESTS_MISSING" : impacts.length ? "COMPATIBLE_TESTS_REQUIRED" : "UNCHANGED";
    const createdAt = timestamp();
    const core = {
      schema: "dorn.contract-analysis/2", analysisId: crypto.randomUUID(), projectId: identity.projectId,
      snapshotId: baseline.snapshotId, baselineInventoryHash: baseline.inventoryHash,
      currentInventoryHash: current.inventoryHash, sourceScanId: current.sourceScanId,
      state, impacts, breaking, review, affectedProducers, affectedConsumers, contractTests,
      verificationPlan: [
        { gate: "CONTRACT_PARSE", state: current.failures.length ? "BLOCKED" : "SATISFIED", targets: current.failures.map((failure) => failure.path) },
        { gate: "BREAKING_CHANGE_REVIEW", state: breaking.length ? "BLOCKED" : review.length ? "REVIEW_REQUIRED" : "SATISFIED", targets: uniqueSorted([...breaking.map((entry) => entry.contract), ...review.map((entry) => entry.contract).filter(Boolean)]) },
        { gate: "CONTRACT_TESTS", state: contractTests.length ? "REQUIRED" : impacts.length ? "MISSING" : "NOT_REQUIRED", targets: contractTests },
        { gate: "PRODUCER_TESTS", state: affectedProducers.length ? "REQUIRED" : "NOT_REQUIRED", targets: affectedProducers },
        { gate: "CONSUMER_TESTS", state: affectedConsumers.length ? "REQUIRED" : "NOT_REQUIRED", targets: affectedConsumers }
      ],
      createdAt
    };
    const analysisHash = sha256(stableJson(core));
    const analysis = { ...core, analysisHash };
    const json = JSON.stringify(analysis);
    if (Buffer.byteLength(json, "utf8") > 64 * 1024 * 1024) throw contractError("CONTRACT_ANALYSIS_TOO_LARGE", "El análisis de contratos excede el límite durable.");
    identity.db.prepare(`INSERT INTO contract_analyses(analysis_id,project_id,snapshot_id,state,analysis_hash,analysis_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(analysis.analysisId, identity.projectId, baseline.snapshotId, state, analysisHash, json, createdAt);
    void this.eventBus?.publish("CONTRACT_ANALYSIS_COMPLETED", { analysisId: analysis.analysisId, state, breaking: breaking.length }, { projectId: identity.projectId, idempotencyKey: `contract-analysis:${analysis.analysisId}` });
    return analysis;
  }

  gateIsolated(project, input = {}) {
    const identity = this.ensure(project);
    const baseline = this.getSnapshot(project, input.snapshotId);
    let executionRoot;
    try { executionRoot = fs.realpathSync(String(input.executionRoot || "")); } catch { throw contractError("CONTRACT_ISOLATION_INVALID", "El gate necesita una raíz aislada real."); }
    const rootStat = fs.lstatSync(executionRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || executionRoot === identity.root || executionRoot.startsWith(`${identity.root}${path.sep}`)) throw contractError("CONTRACT_ISOLATION_INVALID", "El gate de contratos exige un aislamiento externo al proyecto.");
    if (!Array.isArray(input.changedFiles) || input.changedFiles.length > 5000) throw contractError("CONTRACT_CHANGED_FILES_INVALID", "changedFiles debe ser una lista acotada.");
    const changedFiles = uniqueSorted(input.changedFiles.map((relativePath) => safeRelative(executionRoot, relativePath).relativePath));
    const relevant = changedFiles.filter(isContractPath);
    if (!relevant.length) return { schema: "dorn.contract-isolation-gate/1", projectId: identity.projectId, snapshotId: baseline.snapshotId, state: "NOT_REQUIRED", impacts: [], breaking: [], review: [], contractTests: [] };
    const before = new Map(baseline.contracts.map((contract) => [contract.path, structuredClone(contract)]));
    const after = new Map(baseline.contracts.map((contract) => [contract.path, structuredClone(contract)]));
    let currentMapping = new Map(baseline.contracts.map((contract) => [contract.path, {
      producers: contract.producers || [], consumers: contract.consumers || [], contractTests: contract.contractTests || [], owner: contract.owner || null
    }]));
    const review = [];
    if (relevant.includes("dorn.contracts.json")) {
      const mappingSource = readIsolatedFile(executionRoot, "dorn.contracts.json");
      if (!mappingSource) review.push({ type: "CONTRACT_MAPPING_REMOVED", contract: "dorn.contracts.json" });
      else {
        let parsed;
        try { parsed = JSON.parse(mappingSource.source); } catch { throw contractError("CONTRACT_MAPPING_INVALID", "El mapping aislado no contiene JSON válido."); }
        currentMapping = parseMapping(executionRoot, parsed);
      }
    }
    for (const relativePath of relevant.filter((candidate) => candidate !== "dorn.contracts.json")) {
      const inspected = readIsolatedFile(executionRoot, relativePath);
      if (!inspected) { after.delete(relativePath); continue; }
      const parsed = parseCandidate({ path: relativePath }, inspected.source);
      const relationship = currentMapping.get(relativePath);
      if (!relationship) review.push({ type: "CONTRACT_MAPPING_MISSING", contract: relativePath });
      after.set(relativePath, {
        schema: "dorn.contract/3", contractId: relativePath, path: relativePath,
        format: parsed.format, adapterState: parsed.adapterState || "SUPPORTED", document: parsed.document,
        sourceHash: inspected.sourceHash, contractHash: parsed.document === null ? inspected.sourceHash : sha256(stableJson(parsed.document)),
        bytes: inspected.bytes, producers: relationship?.producers || [], consumers: relationship?.consumers || [],
        contractTests: relationship?.contractTests || [], owner: relationship?.owner || null
      });
    }
    if (relevant.includes("dorn.contracts.json")) {
      for (const [relativePath, contract] of after) {
        const relationship = currentMapping.get(relativePath);
        if (!relationship) { review.push({ type: "CONTRACT_MAPPING_MISSING", contract: relativePath }); continue; }
        after.set(relativePath, { ...contract, ...relationship });
      }
      for (const relativePath of currentMapping.keys()) if (!after.has(relativePath)) review.push({ type: "MAPPING_TARGET_MISSING", contract: relativePath });
    }
    const pathsToAnalyze = relevant.includes("dorn.contracts.json") ? uniqueSorted([...before.keys(), ...after.keys()]) : relevant.filter((candidate) => candidate !== "dorn.contracts.json");
    const impacts = [];
    for (const relativePath of pathsToAnalyze) {
      const previous = before.get(relativePath), next = after.get(relativePath);
      if (previous && !next) {
        impacts.push({ path: relativePath, state: "BREAKING", breaking: [{ type: "CONTRACT_REMOVED", path: relativePath }], compatible: [], review: [], affectedProducers: previous.producers, affectedConsumers: previous.consumers, contractTests: previous.contractTests });
        continue;
      }
      if (!previous && next) {
        const adapterReview = next.adapterState === "SUPPORTED" ? [] : [{ type: "CONTRACT_ADAPTER_REQUIRED", format: next.format }];
        impacts.push({ path: relativePath, state: adapterReview.length ? "REVIEW_REQUIRED" : "COMPATIBLE", breaking: [], compatible: [{ type: "CONTRACT_ADDED", path: relativePath }], review: adapterReview, affectedProducers: next.producers, affectedConsumers: next.consumers, contractTests: next.contractTests });
        continue;
      }
      if (!previous || !next || (previous.sourceHash === next.sourceHash && stableJson(previous.producers) === stableJson(next.producers) && stableJson(previous.consumers) === stableJson(next.consumers) && stableJson(previous.contractTests) === stableJson(next.contractTests))) continue;
      const compared = compareContracts(previous, next);
      if (previous.contractHash === next.contractHash && previous.sourceHash !== next.sourceHash) compared.compatible.push({ type: "FORMAT_ONLY_CHANGE", path: relativePath });
      if (stableJson(previous.producers) !== stableJson(next.producers) || stableJson(previous.consumers) !== stableJson(next.consumers)) compared.review.push({ type: "PRODUCER_CONSUMER_MAPPING_CHANGED_REVIEW_REQUIRED", path: relativePath });
      impacts.push({
        path: relativePath, state: compared.breaking.length ? "BREAKING" : compared.review.length ? "REVIEW_REQUIRED" : "COMPATIBLE",
        breaking: compared.breaking, compatible: compared.compatible, review: compared.review,
        affectedProducers: uniqueSorted([...(previous.producers || []), ...(next.producers || [])]),
        affectedConsumers: uniqueSorted([...(previous.consumers || []), ...(next.consumers || [])]),
        contractTests: uniqueSorted([...(previous.contractTests || []), ...(next.contractTests || [])]),
        previousHash: previous.sourceHash, currentHash: next.sourceHash
      });
    }
    const breaking = impacts.flatMap((impact) => impact.breaking.map((entry) => ({ contract: impact.path, ...entry })));
    review.push(...impacts.flatMap((impact) => impact.review.map((entry) => ({ contract: impact.path, ...entry }))));
    const contractTests = uniqueSorted(impacts.flatMap((impact) => impact.contractTests));
    const affectedProducers = uniqueSorted(impacts.flatMap((impact) => impact.affectedProducers));
    const affectedConsumers = uniqueSorted(impacts.flatMap((impact) => impact.affectedConsumers));
    const state = breaking.length ? "BLOCKED_BREAKING_CHANGE" : review.length ? "REVIEW_REQUIRED" : impacts.length && !contractTests.length ? "BLOCKED_CONTRACT_TESTS_MISSING" : impacts.length ? "COMPATIBLE_TESTS_REQUIRED" : "UNCHANGED";
    const core = {
      schema: "dorn.contract-isolation-gate/1", analysisId: crypto.randomUUID(), projectId: identity.projectId,
      snapshotId: baseline.snapshotId, source: "ISOLATED_WORKTREE", state, changedFiles, relevantFiles: relevant,
      impacts, breaking, review, affectedProducers, affectedConsumers, contractTests, createdAt: timestamp()
    };
    const analysis = { ...core, analysisHash: sha256(stableJson(core)) };
    identity.db.prepare(`INSERT INTO contract_analyses(analysis_id,project_id,snapshot_id,state,analysis_hash,analysis_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(analysis.analysisId, identity.projectId, baseline.snapshotId, state, analysis.analysisHash, JSON.stringify(analysis), analysis.createdAt);
    return analysis;
  }

  closeAll() {
    for (const db of this.databases.values()) { try { db.close(); } catch {} }
    this.databases.clear();
    this.databaseOwners.clear();
  }
}

module.exports = {
  ContractIntelligence, compareJsonSchema, compareOpenApi, parseProto, compareProto,
  compareContracts, parseCandidate, parseMapping, hasSecretMaterial, stableJson,
  isContractPath, readIsolatedFile, MAX_CONTRACT_BYTES, MAX_INVENTORY_BYTES
};
