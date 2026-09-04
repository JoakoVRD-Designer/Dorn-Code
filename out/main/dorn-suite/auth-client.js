"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const DEFAULT_SERVER = "http://127.0.0.1:47840";
const REQUEST_TIMEOUT_MS = 12_000;
const HEARTBEAT_MS = 30_000;
const AWAY_AFTER_MS = 60_000;

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeServerUrl(value) {
  const parsed = new URL(String(value || DEFAULT_SERVER));
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("La dirección de DORN Admin debe usar HTTP o HTTPS y no puede incluir credenciales.");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function validateEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Ingresa un correo electrónico válido.");
  }
  return email;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 256) {
    throw new Error("La contraseña debe tener entre 8 y 256 caracteres. No es obligatorio usar mayúsculas.");
  }
  return password;
}

function sanitizeTechnicalText(value) {
  return String(value || "")
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s]+/gi, "$1=[OCULTO]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [OCULTO]")
    .replace(/[A-Za-z]:\\[^\r\n\t]+/g, "[RUTA LOCAL]")
    .slice(0, 8_000);
}

class DornAdminClient {
  constructor(options) {
    this.stateRoot = options.stateRoot;
    this.version = options.version;
    this.safeStorage = options.safeStorage;
    this.openExternal = options.openExternal;
    this.onAuthenticated = options.onAuthenticated || (() => {});
    this.onSignedOut = options.onSignedOut || (() => {});
    this.connectionPath = path.join(this.stateRoot, "dorn-admin-connection.json");
    this.sessionPath = path.join(this.stateRoot, "dorn-auth-session.json");
    const savedConnection = readJson(this.connectionPath, {});
    this.baseUrl = safeServerUrl(process.env.DORN_ADMIN_URL || savedConnection.baseUrl || DEFAULT_SERVER);
    this.token = "";
    this.user = null;
    this.loginAt = null;
    this.lastActivityAt = Date.now();
    this.serverReachable = null;
    this.lastError = "";
    this.heartbeatTimer = null;
    this.restoreStoredSession();
  }

  device() {
    return {
      app: "DORN AI",
      appVersion: this.version,
      operatingSystem: `${os.type()} ${os.release()}`,
      platform: process.platform,
      architecture: process.arch,
      deviceName: os.hostname().slice(0, 120)
    };
  }

  restoreStoredSession() {
    const saved = readJson(this.sessionPath, null);
    if (!saved?.encryptedToken || !this.safeStorage?.isEncryptionAvailable?.()) return;
    try {
      this.token = this.safeStorage.decryptString(Buffer.from(saved.encryptedToken, "base64"));
      this.user = saved.user || null;
      this.loginAt = saved.loginAt || null;
    } catch {
      this.clearLocalSession();
    }
  }

  persistSession(maintainSession) {
    if (!maintainSession || !this.token || !this.safeStorage?.isEncryptionAvailable?.()) {
      try { fs.unlinkSync(this.sessionPath); } catch {}
      return;
    }
    const encryptedToken = this.safeStorage.encryptString(this.token).toString("base64");
    atomicJson(this.sessionPath, { version: 1, encryptedToken, user: this.user, loginAt: this.loginAt });
  }

  clearLocalSession() {
    this.token = "";
    this.user = null;
    this.loginAt = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    try { fs.unlinkSync(this.sessionPath); } catch {}
  }

  status() {
    return {
      authenticated: Boolean(this.token && this.user),
      user: this.user ? { ...this.user } : null,
      server: this.baseUrl,
      serverReachable: this.serverReachable,
      lastError: this.lastError,
      googleAvailable: null,
      loginAt: this.loginAt
    };
  }

  async request(route, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    try {
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      if (options.auth !== false && this.token) headers.Authorization = `Bearer ${this.token}`;
      const response = await fetch(`${this.baseUrl}${route}`, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      this.serverReachable = true;
      this.lastError = "";
      if (!response.ok) throw new Error(data.message || `DORN Admin respondió ${response.status}.`);
      return data;
    } catch (error) {
      if (error?.name === "AbortError") this.lastError = "DORN Admin no respondió dentro del tiempo esperado.";
      else this.lastError = error instanceof Error ? error.message : String(error);
      if (/fetch failed|ECONNREFUSED|ENOTFOUND|no respondió/i.test(this.lastError)) this.serverReachable = false;
      throw new Error(this.lastError);
    } finally {
      clearTimeout(timer);
    }
  }

  async restore() {
    if (!this.token) {
      try {
        const health = await this.request("/health", { auth: false, timeoutMs: 2_500 });
        this.serverReachable = health.ok === true;
      } catch {}
      return this.status();
    }
    try {
      const result = await this.request("/v1/auth/session");
      this.user = result.user;
      this.loginAt = result.session?.loginAt || this.loginAt;
      this.startHeartbeat();
      return this.status();
    } catch {
      this.clearLocalSession();
      return this.status();
    }
  }

  async finishAuthentication(result, maintainSession) {
    if (!result?.token || !result?.user?.id) throw new Error("DORN Admin no devolvió una sesión válida.");
    this.token = result.token;
    this.user = result.user;
    this.loginAt = result.session?.loginAt || new Date().toISOString();
    this.lastActivityAt = Date.now();
    this.persistSession(maintainSession !== false);
    this.startHeartbeat();
    await this.sendPresence("active").catch(() => {});
    await this.onAuthenticated(this.status());
    return this.status();
  }

  async register(payload) {
    const email = validateEmail(payload.email);
    const password = validatePassword(payload.password);
    const displayName = String(payload.displayName || "").trim().slice(0, 120);
    if (!displayName) throw new Error("Indica el nombre que DORN utilizará para dirigirse a ti.");
    const result = await this.request("/v1/auth/register", {
      method: "POST",
      auth: false,
      body: {
        email,
        password,
        displayName,
        invitationCode: String(payload.invitationCode || "").trim(),
        accountScope: "dorn_ai",
        device: this.device()
      }
    });
    if (result?.verificationRequired) {
      return {
        authenticated: false,
        verificationRequired: true,
        email,
        expiresAt: result.expiresAt || null,
        message: result.message || "Revisa tu correo e ingresa el código de verificación."
      };
    }
    return this.finishAuthentication(result, payload.maintainSession !== false);
  }

  async verifyEmail(payload) {
    const email = validateEmail(payload.email);
    const code = String(payload.code || "").replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) throw new Error("Ingresa el código de seis dígitos.");
    const result = await this.request("/v1/auth/verify-email", {
      method: "POST",
      auth: false,
      body: { email, code, accountScope: "dorn_ai", device: this.device() }
    });
    return this.finishAuthentication(result, payload.maintainSession !== false);
  }

  async resendVerification(payload) {
    const email = validateEmail(payload.email);
    return this.request("/v1/auth/resend-verification", {
      method: "POST",
      auth: false,
      body: { email, accountScope: "dorn_ai" }
    });
  }

  async login(payload) {
    const email = validateEmail(payload.email);
    const password = String(payload.password || "");
    if (!password) throw new Error("Ingresa tu contraseña.");
    const result = await this.request("/v1/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password, accountScope: "dorn_ai", device: this.device() }
    });
    return this.finishAuthentication(result, payload.maintainSession !== false);
  }

  async googleStart() {
    const result = await this.request("/v1/auth/google/start", {
      method: "POST",
      auth: false,
      body: { device: this.device() }
    });
    if (!result.available) throw new Error(result.message || "Google todavía no está configurado en DORN Admin.");
    await this.openExternal(result.authorizationUrl);
    return { available: true, flowId: result.flowId, expiresAt: result.expiresAt };
  }

  async googlePoll(flowId, maintainSession = true) {
    const safeId = String(flowId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
    if (!safeId) throw new Error("La solicitud de Google no es válida.");
    const result = await this.request(`/v1/auth/google/poll/${safeId}`, { auth: false });
    if (!result.complete) return { complete: false };
    return { complete: true, status: await this.finishAuthentication(result, maintainSession) };
  }

  async logout() {
    if (this.token) {
      await this.sendPresence("disconnected").catch(() => {});
      await this.request("/v1/auth/logout", { method: "POST", body: {} }).catch(() => {});
    }
    this.clearLocalSession();
    await this.onSignedOut(this.status());
    return this.status();
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      void this.sendPresence(Date.now() - this.lastActivityAt >= AWAY_AFTER_MS ? "away" : "active").catch(() => {});
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  markActivity() {
    this.lastActivityAt = Date.now();
    return true;
  }

  async sendPresence(status) {
    if (!this.token) return false;
    await this.request("/v1/presence", {
      method: "POST",
      body: {
        status,
        loginAt: this.loginAt,
        lastActivity: new Date(this.lastActivityAt).toISOString(),
        device: this.device()
      }
    });
    return true;
  }

  async reportError(raw) {
    if (!this.token) return false;
    const report = {
      kind: String(raw?.kind || "internal").replace(/[^a-z0-9._-]/gi, "").slice(0, 80),
      message: sanitizeTechnicalText(raw?.message),
      stack: sanitizeTechnicalText(raw?.stack),
      component: String(raw?.component || "DORN AI").slice(0, 120),
      occurredAt: new Date().toISOString(),
      device: this.device(),
      privacy: { conversationsIncluded: false, userFilesIncluded: false }
    };
    await this.request("/v1/errors", { method: "POST", body: report });
    return true;
  }

  async configureServer(baseUrl) {
    this.baseUrl = safeServerUrl(baseUrl);
    atomicJson(this.connectionPath, { version: 1, baseUrl: this.baseUrl, updatedAt: new Date().toISOString() });
    this.serverReachable = null;
    this.lastError = "";
    return this.restore();
  }

  async stop() {
    await this.sendPresence("disconnected").catch(() => {});
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

module.exports = {
  DornAdminClient,
  validateEmail,
  validatePassword,
  sanitizeTechnicalText,
  DEFAULT_SERVER
};
