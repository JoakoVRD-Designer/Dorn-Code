"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { projectIdentity } = require("./job-runtime");

const PERMISSION_MODES = new Set(["full-control", "operator", "advisor"]);
const CRITICAL_ACTIONS = new Set([
  "filesystem.delete", "hardware.flash", "network.publish", "payment.execute", "release.deploy",
  "secret.read", "secret.rotate", "system.configure", "tool.install"
]);
const BASE_ACTIONS = Object.freeze({
  "full-control": ["filesystem.read", "filesystem.write", "process.execute", "test.execute", "build.execute", "git.inspect", "git.worktree", "artifact.inspect"],
  operator: ["filesystem.read", "filesystem.write", "test.execute", "build.execute", "git.inspect", "artifact.inspect"],
  advisor: ["filesystem.read", "git.inspect", "artifact.inspect"]
});
const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/i
];

function policyError(code, message, policy) { return Object.assign(new Error(message), { code, policy }); }
function containsSecret(value) { return SECRET_PATTERNS.some((pattern) => pattern.test(String(value || ""))); }

function normalizedMode(value) {
  const mode = String(value || "full-control").toLowerCase();
  return PERMISSION_MODES.has(mode) ? mode : "advisor";
}

function safeHost(rawHost) {
  const host = String(rawHost || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(":" ) || host.includes("/") || host.includes("@") || host === "*" || /[^a-z0-9.*_-]/.test(host)) {
    throw policyError("POLICY_HOST_INVALID", "La política recibió un host inválido.");
  }
  if (host.includes("*") && !/^\*\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/.test(host)) {
    throw policyError("POLICY_HOST_INVALID", "El wildcard de red debe limitarse a un subdominio concreto.");
  }
  return host;
}

function hostAllowed(host, rules) {
  return rules.some((allowed) => allowed === host || (allowed.startsWith("*.") && host.endsWith(allowed.slice(1)) && host !== allowed.slice(2)));
}

function canonicalCandidate(rawPath) {
  const candidate = path.resolve(String(rawPath || ""));
  if (fs.existsSync(candidate)) {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) throw policyError("POLICY_PATH_SYMLINK", "La política no autoriza una ruta enlazada.");
    return fs.realpathSync(candidate);
  }
  let ancestor = path.dirname(candidate);
  while (ancestor !== path.dirname(ancestor) && !fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const stat = fs.lstatSync(ancestor);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw policyError("POLICY_PATH_UNSAFE", "La ruta solicitada no tiene un padre real seguro.");
  const relative = path.relative(ancestor, candidate);
  if (!relative || relative.split(path.sep).some((part) => part === "..")) throw policyError("POLICY_PATH_UNSAFE", "La ruta solicitada es insegura.");
  return path.resolve(fs.realpathSync(ancestor), relative);
}

function within(candidate, root) { return candidate === root || candidate.startsWith(`${root}${path.sep}`); }

function requestHash(projectId, request) {
  const canonical = {
    projectId,
    action: String(request.action || ""),
    path: request.path ? path.resolve(String(request.path)) : null,
    host: request.host ? String(request.host).toLowerCase() : null,
    irreversible: request.irreversible === true,
    secret: request.secret === true,
    toolId: request.toolId ? String(request.toolId) : null,
    argsHash: crypto.createHash("sha256").update(JSON.stringify(request.args || [])).digest("hex")
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

class PolicyEngine {
  constructor(options = {}) {
    if (!options.projectCore) throw new Error("Policy Engine necesita Project Core.");
    this.projectCore = options.projectCore;
    this.resolvePermissionMode = typeof options.resolvePermissionMode === "function" ? options.resolvePermissionMode : () => "full-control";
  }

  projectCore;
  resolvePermissionMode;
  rules = new Map();
  approvals = new Map();

  configure(project, input = {}) {
    const identity = projectIdentity(project, this.projectCore);
    const mode = normalizedMode(input.mode || this.resolvePermissionMode(project));
    const actions = [...new Set((input.actions || BASE_ACTIONS[mode]).map(String))].sort();
    if (actions.some((action) => !/^[a-z][a-z0-9.-]{2,79}$/.test(action))) throw policyError("POLICY_ACTION_INVALID", "La política contiene una acción inválida.");
    const networkHosts = [...new Set((input.networkHosts || []).map(safeHost))].sort();
    const externalRoots = [...new Set((input.externalRoots || []).map((entry) => canonicalCandidate(entry)))].sort();
    if ([actions, networkHosts, externalRoots].some((value) => containsSecret(JSON.stringify(value)))) throw policyError("POLICY_SECRET_INLINE", "La política no puede contener credenciales.");
    const rule = {
      schema: "dorn.policy/1", projectId: identity.projectId, rootPath: identity.root, mode,
      actions, networkHosts, externalRoots,
      allowSecrets: input.allowSecrets === true,
      configuredAt: new Date().toISOString()
    };
    this.rules.set(identity.projectId, rule);
    return structuredClone(rule);
  }

  rule(project) {
    const identity = projectIdentity(project, this.projectCore);
    const current = this.rules.get(identity.projectId);
    if (current && current.rootPath !== identity.root) throw policyError("POLICY_PROJECT_IDENTITY_MISMATCH", "La política pertenece a otra carpeta de proyecto.");
    return { identity, rule: current || this.configure(identity.project, { mode: this.resolvePermissionMode(project) }) };
  }

  evaluate(project, request = {}) {
    const { identity, rule } = this.rule(project);
    const action = String(request.action || "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9.-]{2,79}$/.test(action)) return { decision: "DENY", reason: "POLICY_ACTION_INVALID", projectId: identity.projectId };
    const probe = this.projectCore.probe(identity.root);
    if (request.secret === true && !rule.allowSecrets) return { decision: "DENY", reason: "SECRET_SCOPE_DENIED", projectId: identity.projectId, action };
    if (request.secret === true || CRITICAL_ACTIONS.has(action) || request.irreversible === true) {
      return { decision: "CONFIRM", reason: "CRITICAL_CONFIRMATION_REQUIRED", projectId: identity.projectId, action, requestHash: requestHash(identity.projectId, request) };
    }
    if (!rule.actions.includes(action)) {
      if (rule.mode === "operator" && action === "process.execute") {
        return { decision: "CONFIRM", reason: "PROCESS_CONFIRMATION_REQUIRED", projectId: identity.projectId, action, requestHash: requestHash(identity.projectId, request) };
      }
      return { decision: "DENY", reason: "ACTION_SCOPE_DENIED", projectId: identity.projectId, action };
    }
    if (action === "process.execute" || action === "test.execute" || action === "build.execute") {
      if (probe.manifest?.trustState !== "TRUSTED") return { decision: "DENY", reason: "UNTRUSTED_WORKSPACE", projectId: identity.projectId, action };
    }
    if (request.path) {
      let candidate;
      try { candidate = canonicalCandidate(request.path); }
      catch (error) { return { decision: "DENY", reason: error.code || "FILESYSTEM_SCOPE_DENIED", projectId: identity.projectId, action }; }
      const roots = [identity.root, ...rule.externalRoots];
      if (!roots.some((root) => within(candidate, root))) return { decision: "DENY", reason: "FILESYSTEM_SCOPE_DENIED", projectId: identity.projectId, action };
      if (!within(candidate, identity.root)) return { decision: "CONFIRM", reason: "EXTERNAL_FILESYSTEM_CONFIRMATION_REQUIRED", projectId: identity.projectId, action, requestHash: requestHash(identity.projectId, request) };
    }
    if (request.host) {
      let host;
      try { host = safeHost(request.host); } catch (error) { return { decision: "DENY", reason: error.code, projectId: identity.projectId, action }; }
      if (!hostAllowed(host, rule.networkHosts)) return { decision: "DENY", reason: "NETWORK_SCOPE_DENIED", projectId: identity.projectId, action };
      if (request.networkEnforced !== true) return { decision: "DENY", reason: "NETWORK_ISOLATION_UNAVAILABLE", projectId: identity.projectId, action };
    }
    return { decision: "ALLOW", reason: "SCOPED_AUTONOMY", projectId: identity.projectId, action, mode: rule.mode };
  }

  issueApproval(project, request = {}, options = {}) {
    const decision = this.evaluate(project, request);
    if (decision.decision !== "CONFIRM") throw policyError("POLICY_CONFIRMATION_NOT_REQUIRED", "La acción no requiere una aprobación nueva.", decision);
    const ttlMs = Math.max(5_000, Math.min(5 * 60_000, Number(options.ttlMs) || 60_000));
    const approval = {
      schema: "dorn.approval/1", approvalId: crypto.randomUUID(), projectId: decision.projectId,
      requestHash: decision.requestHash, reason: decision.reason, expiresAt: Date.now() + ttlMs, used: false
    };
    this.approvals.set(approval.approvalId, approval);
    return structuredClone(approval);
  }

  authorize(project, request = {}, approvalInput = null) {
    const decision = this.evaluate(project, request);
    if (decision.decision === "ALLOW") return decision;
    if (decision.decision === "DENY") throw policyError(decision.reason, decision.reason, decision);
    const approvalId = String(approvalInput?.approvalId || "");
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.used || approval.projectId !== decision.projectId || approval.requestHash !== decision.requestHash || approval.expiresAt < Date.now()) {
      throw policyError("POLICY_APPROVAL_INVALID", "La aprobación no existe, expiró, ya fue usada o pertenece a otra acción.", decision);
    }
    approval.used = true;
    this.approvals.delete(approvalId);
    return { ...decision, decision: "ALLOW", reason: "EXPLICIT_CONFIRMATION", approvalId };
  }

  revokeProject(projectId) {
    this.rules.delete(String(projectId));
    for (const [approvalId, approval] of this.approvals) if (approval.projectId === String(projectId)) this.approvals.delete(approvalId);
  }
}

module.exports = { PolicyEngine, PERMISSION_MODES, CRITICAL_ACTIONS, BASE_ACTIONS, containsSecret, safeHost, requestHash };
