"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const {
  DornSuiteError,
  ensureDirectory,
  atomicJson,
  readJson,
  sha256Buffer,
  now
} = require("./common");

const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const MAX_COLLAB_MESSAGE_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function normalizeRelative(relativePath) {
  const normalized = String(relativePath || "").split(path.sep).join("/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../")) {
    throw new DornSuiteError("DORN-RECOVERY-001", "recovery", "El respaldo contiene una ruta no válida.");
  }
  return normalized;
}

function safeJsonFiles(rootPath) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(rootPath, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!/(?:cache|temp|logs?|backups?)/i.test(entry.name)) walk(absolute);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
      if (/(?:secret|token|credential|api[-_]?key|provider[-_]?key)/i.test(relative)) continue;
      const stat = fs.statSync(absolute);
      if (stat.size > 2 * 1024 * 1024) continue;
      files.push({ absolute, relative, sizeBytes: stat.size });
    }
  };
  if (fs.existsSync(rootPath)) walk(rootPath);
  return files.slice(0, 256);
}

function encryptPayload(buffer, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return {
    encrypted: true,
    algorithm: "aes-256-gcm+scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: encrypted.toString("base64")
  };
}

function decryptPayload(container, passphrase) {
  if (!container.encrypted) return Buffer.from(container.payload, "base64");
  if (!passphrase) {
    throw new DornSuiteError("DORN-RECOVERY-002", "recovery", "El respaldo está cifrado y necesita su frase de recuperación.");
  }
  try {
    const key = crypto.scryptSync(passphrase, Buffer.from(container.salt, "base64"), 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(container.iv, "base64"));
    decipher.setAuthTag(Buffer.from(container.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(container.payload, "base64")),
      decipher.final()
    ]);
  } catch {
    throw new DornSuiteError("DORN-RECOVERY-003", "recovery", "La frase de recuperación no es correcta o el respaldo fue alterado.");
  }
}

class RecoveryEngine {
  constructor(stateRoot) {
    this.stateRoot = stateRoot;
    this.backupsRoot = ensureDirectory(path.join(stateRoot, "backups"));
    this.profilePath = path.join(stateRoot, "profile.json");
    this.profile = readJson(this.profilePath, {
      mode: "local",
      displayName: "",
      email: "",
      googleOAuthConfigured: false,
      createdAt: now(),
      updatedAt: now()
    });
  }

  profileStatus() {
    return {
      mode: this.profile.mode,
      displayName: this.profile.displayName,
      email: this.profile.email,
      googleOAuthConfigured: Boolean(this.profile.googleOAuthConfigured),
      localProfileReady: Boolean(this.profile.displayName),
      updatedAt: this.profile.updatedAt
    };
  }

  configureLocalProfile(patch) {
    const displayName = String(patch.displayName || "").trim().slice(0, 120);
    const email = String(patch.email || "").trim().toLowerCase().slice(0, 254);
    if (!displayName) {
      throw new DornSuiteError("DORN-ACCOUNT-001", "account", "El perfil local necesita un nombre.");
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new DornSuiteError("DORN-ACCOUNT-002", "account", "El correo del perfil no tiene un formato válido.");
    }
    this.profile = {
      ...this.profile,
      mode: "local",
      displayName,
      email,
      updatedAt: now()
    };
    atomicJson(this.profilePath, this.profile);
    return this.profileStatus();
  }

  createBackup(options = {}) {
    const passphrase = String(options.passphrase || "");
    const candidates = safeJsonFiles(this.stateRoot);
    let totalBytes = 0;
    const files = candidates.map((entry) => {
      const buffer = fs.readFileSync(entry.absolute);
      totalBytes += buffer.length;
      if (totalBytes > MAX_BACKUP_BYTES) {
        throw new DornSuiteError("DORN-RECOVERY-004", "recovery", "Los datos seguros superan el límite del respaldo integrado.");
      }
      return {
        relativePath: normalizeRelative(entry.relative),
        sizeBytes: buffer.length,
        sha256: sha256Buffer(buffer),
        content: buffer.toString("base64")
      };
    });
    const payload = Buffer.from(JSON.stringify({
      format: "dorn-recovery",
      formatVersion: 1,
      suiteVersion: String(options.suiteVersion || "unknown"),
      createdAt: now(),
      excludesSecrets: true,
      files
    }), "utf8");
    const envelope = passphrase
      ? {
          format: "dorn-backup-envelope",
          formatVersion: 1,
          createdAt: now(),
          ...encryptPayload(payload, passphrase)
        }
      : {
          format: "dorn-backup-envelope",
          formatVersion: 1,
          createdAt: now(),
          encrypted: false,
          algorithm: "none",
          payload: payload.toString("base64")
        };
    const name = `DORN-${new Date().toISOString().replace(/[:.]/g, "-")}.dornbackup`;
    const filePath = path.join(this.backupsRoot, name);
    fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), { encoding: "utf8", mode: 0o600 });
    return {
      filePath,
      fileName: name,
      encrypted: Boolean(envelope.encrypted),
      files: files.length,
      sourceBytes: totalBytes,
      sha256: sha256Buffer(fs.readFileSync(filePath))
    };
  }

  readBackup(filePath, passphrase = "") {
    const absolute = path.resolve(String(filePath));
    const backupsRoot = fs.realpathSync(this.backupsRoot);
    if (absolute !== backupsRoot && !absolute.startsWith(`${backupsRoot}${path.sep}`)) {
      throw new DornSuiteError("DORN-RECOVERY-005", "recovery", "El respaldo debe seleccionarse desde la carpeta administrada por DORN.");
    }
    const envelope = JSON.parse(fs.readFileSync(absolute, "utf8"));
    if (envelope.format !== "dorn-backup-envelope" || envelope.formatVersion !== 1) {
      throw new DornSuiteError("DORN-RECOVERY-006", "recovery", "El archivo no es un respaldo DORN compatible.");
    }
    const payload = JSON.parse(decryptPayload(envelope, passphrase).toString("utf8"));
    if (payload.format !== "dorn-recovery" || payload.formatVersion !== 1 || !Array.isArray(payload.files)) {
      throw new DornSuiteError("DORN-RECOVERY-007", "recovery", "El contenido del respaldo no es compatible.");
    }
    for (const entry of payload.files) {
      normalizeRelative(entry.relativePath);
      const buffer = Buffer.from(entry.content, "base64");
      if (buffer.length !== entry.sizeBytes || sha256Buffer(buffer) !== entry.sha256) {
        throw new DornSuiteError("DORN-RECOVERY-008", "recovery", `Falló la integridad de ${entry.relativePath}.`);
      }
    }
    return { envelope, payload };
  }

  listBackups() {
    return fs.readdirSync(this.backupsRoot)
      .filter((name) => name.endsWith(".dornbackup"))
      .map((name) => {
        const filePath = path.join(this.backupsRoot, name);
        const stat = fs.statSync(filePath);
        return {
          fileName: name,
          filePath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString()
        };
      })
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }

  verifyBackup(filePath, passphrase = "") {
    const { envelope, payload } = this.readBackup(filePath, passphrase);
    return {
      valid: true,
      encrypted: Boolean(envelope.encrypted),
      createdAt: payload.createdAt,
      suiteVersion: payload.suiteVersion,
      files: payload.files.length,
      excludesSecrets: payload.excludesSecrets === true
    };
  }

  restoreBackup(filePath, passphrase = "", confirmation = false) {
    if (confirmation !== true) {
      throw new DornSuiteError("DORN-RECOVERY-009", "recovery", "La restauración necesita confirmación explícita.");
    }
    const { payload } = this.readBackup(filePath, passphrase);
    const restored = [];
    for (const entry of payload.files) {
      const relative = normalizeRelative(entry.relativePath);
      const target = path.resolve(this.stateRoot, relative);
      if (target !== this.stateRoot && !target.startsWith(`${this.stateRoot}${path.sep}`)) {
        throw new DornSuiteError("DORN-RECOVERY-001", "recovery", "El respaldo contiene una ruta no válida.");
      }
      ensureDirectory(path.dirname(target));
      const temporary = `${target}.${crypto.randomUUID()}.restore`;
      fs.writeFileSync(temporary, Buffer.from(entry.content, "base64"), { mode: 0o600 });
      fs.renameSync(temporary, target);
      restored.push(relative);
    }
    return { restored: restored.length, files: restored };
  }
}

class TelemetryEngine {
  constructor(stateRoot) {
    this.filePath = path.join(stateRoot, "telemetry.json");
    this.state = readJson(this.filePath, {
      enabled: false,
      shareDiagnostics: false,
      anonymousInstallId: crypto.randomUUID(),
      counters: {},
      lastEventAt: null,
      updatedAt: now()
    });
  }

  status() {
    return {
      enabled: Boolean(this.state.enabled),
      shareDiagnostics: Boolean(this.state.shareDiagnostics),
      counters: { ...this.state.counters },
      lastEventAt: this.state.lastEventAt,
      externalTransmissionImplemented: false,
      policy: "local-opt-in"
    };
  }

  configure(patch) {
    if (typeof patch.enabled === "boolean") this.state.enabled = patch.enabled;
    if (typeof patch.shareDiagnostics === "boolean") this.state.shareDiagnostics = patch.shareDiagnostics;
    this.state.updatedAt = now();
    atomicJson(this.filePath, this.state);
    return this.status();
  }

  record(eventName) {
    if (!this.state.enabled) return false;
    const safeName = String(eventName || "").replace(/[^a-z0-9._-]/gi, "").slice(0, 80);
    if (!safeName) return false;
    this.state.counters[safeName] = Number(this.state.counters[safeName] || 0) + 1;
    this.state.lastEventAt = now();
    atomicJson(this.filePath, this.state);
    return true;
  }
}

class VoiceEngine {
  constructor() {
    this.process = null;
    this.recognitionProcess = null;
    this.recognitionStopping = false;
  }

  status() {
    return {
      platformSupported: process.platform === "win32",
      speechSynthesis: process.platform === "win32" ? "windows-system-speech" : "unavailable",
      speechRecognition: process.platform === "win32" ? "windows-local-dictation" : "unavailable",
      wakeWord: "requires-authorized-adapter",
      speaking: Boolean(this.process && this.process.exitCode === null),
      listening: Boolean(this.recognitionProcess && this.recognitionProcess.exitCode === null)
    };
  }

  diagnose() {
    if (process.platform !== "win32") return Promise.resolve({ platformSupported: false, recognizers: [], voices: [], ready: false, message: "La voz integrada necesita Windows." });
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$r=@([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()|ForEach-Object{[ordered]@{id=$_.Id;name=$_.Name;culture=$_.Culture.Name}})",
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer",
      "$v=@($s.GetInstalledVoices()|ForEach-Object{[ordered]@{name=$_.VoiceInfo.Name;culture=$_.VoiceInfo.Culture.Name;enabled=$_.Enabled}})",
      "$o=[ordered]@{platformSupported=$true;recognizers=$r;voices=$v;ready=($r.Count -gt 0 -and $v.Count -gt 0)}",
      "$j=$o|ConvertTo-Json -Depth 5 -Compress",
      "$b=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($j))",
      "[Console]::Out.WriteLine(('DORNDIAG|'+$b))"
    ].join(";");
    return new Promise((resolve, reject) => {
      const child = childProcess.spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      let errors = "";
      const timer = setTimeout(() => child.kill(), 12000);
      child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { errors += chunk.toString("utf8"); });
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timer);
        const match = /DORNDIAG\|([A-Za-z0-9+/=]+)/.exec(output);
        if (code !== 0 || !match) return reject(new DornSuiteError("DORN-VOICE-006", "voice", "Windows no pudo revisar los motores de voz.", { detail: errors.slice(0, 500) }));
        try {
          const result = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
          result.message = result.ready ? "Voz y dictado disponibles." : "Instala una voz y un paquete de reconocimiento de idioma en Windows.";
          resolve(result);
        } catch {
          reject(new DornSuiteError("DORN-VOICE-006", "voice", "Windows devolvió un diagnóstico de voz no válido."));
        }
      });
    });
  }

  stop() {
    if (this.process && this.process.exitCode === null) this.process.kill();
    this.process = null;
    this.stopRecognition();
    return this.status();
  }

  stopRecognition() {
    this.recognitionStopping = true;
    if (this.recognitionProcess && this.recognitionProcess.exitCode === null) this.recognitionProcess.kill();
    this.recognitionProcess = null;
    return this.status();
  }

  startRecognition(options = {}, onEvent = () => void 0) {
    if (process.platform !== "win32") {
      throw new DornSuiteError("DORN-VOICE-004", "voice", "El dictado local de esta compilación necesita Windows.");
    }
    this.stopRecognition();
    this.recognitionStopping = false;
    const requestedLocale = /^[a-z]{2}-[A-Z]{2}$/.test(String(options.locale || "")) ? String(options.locale) : "es-CL";
    const encodedLocale = Buffer.from(requestedLocale, "utf16le").toString("base64");
    const script = [
      "Add-Type -AssemblyName System.Speech",
      `$locale=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedLocale}'))`,
      "$culture=[Globalization.CultureInfo]::GetCultureInfo($locale)",
      "$installed=@([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())",
      "$info=$installed|Where-Object{$_.Culture.Name -eq $locale}|Select-Object -First 1",
      "if(-not $info){$info=$installed|Where-Object{$_.Culture.TwoLetterISOLanguageName -eq 'es'}|Select-Object -First 1}",
      "if(-not $info){$info=$installed|Select-Object -First 1}",
      "if(-not $info){throw 'No hay un motor de reconocimiento de voz instalado en Windows.'}",
      "$recognizer=[System.Speech.Recognition.SpeechRecognitionEngine]::new($info)",
      "$recognizer.SetInputToDefaultAudioDevice()",
      "$recognizer.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())",
      "$handler=[System.EventHandler[System.Speech.Recognition.SpeechRecognizedEventArgs]]{param($sender,$eventArgs);if($eventArgs.Result -and $eventArgs.Result.Text){$bytes=[Text.Encoding]::UTF8.GetBytes($eventArgs.Result.Text);[Console]::Out.WriteLine(('DORNVOICE|'+[Convert]::ToBase64String($bytes)+'|'+[Math]::Round($eventArgs.Result.Confidence,3)));[Console]::Out.Flush()}}",
      "$recognizer.add_SpeechRecognized($handler)",
      "$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)",
      "[Console]::Out.WriteLine(('DORNREADY|'+$info.Culture.Name));[Console]::Out.Flush()",
      "while($true){Start-Sleep -Milliseconds 250}"
    ].join(";");
    const child = childProcess.spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.recognitionProcess = child;
    let buffer = "";
    let errorText = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim().startsWith("DORNREADY|")) {
          onEvent({ type: "ready", locale: line.trim().split("|")[1] || requestedLocale });
          continue;
        }
        const match = /^DORNVOICE\|([A-Za-z0-9+/=]+)\|([\d.]+)$/.exec(line.trim());
        if (!match) continue;
        onEvent({
          type: "text",
          text: Buffer.from(match[1], "base64").toString("utf8").slice(0, 4000),
          confidence: Math.max(0, Math.min(1, Number(match[2]) || 0)),
          locale: requestedLocale
        });
      }
    });
    child.stderr.on("data", (chunk) => { errorText += chunk.toString("utf8"); });
    child.once("error", (error) => {
      this.recognitionProcess = null;
      onEvent({ type: "error", message: error.message || String(error) });
    });
    child.once("exit", (code) => {
      const expected = this.recognitionStopping;
      this.recognitionProcess = null;
      this.recognitionStopping = false;
      if (!expected && code !== 0) {
        onEvent({
          type: "error",
          message: errorText.trim().slice(0, 500) || "Windows no pudo iniciar el reconocimiento. Instala el paquete de voz español correspondiente."
        });
      } else {
        onEvent({ type: "stopped" });
      }
    });
    return { ...this.status(), locale: requestedLocale };
  }

  speak(text, options = {}) {
    if (process.platform !== "win32") {
      throw new DornSuiteError("DORN-VOICE-001", "voice", "La voz integrada de esta compilación utiliza las voces instaladas en Windows.");
    }
    const message = String(text || "").trim().slice(0, 12000);
    if (!message) throw new DornSuiteError("DORN-VOICE-002", "voice", "No hay texto para leer.");
    this.stop();
    const encoded = Buffer.from(message, "utf16le").toString("base64");
    const rate = Math.max(-10, Math.min(10, Number(options.rate || 0)));
    const volume = Math.max(0, Math.min(100, Number(options.volume ?? 100)));
    const script = [
      "Add-Type -AssemblyName System.Speech",
      `$t=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))`,
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer",
      `$s.Rate=${rate}`,
      `$s.Volume=${volume}`,
      "$s.Speak($t)"
    ].join(";");
    const child = childProcess.spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script
    ], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    this.process = child;
    return new Promise((resolve, reject) => {
      let errorText = "";
      child.stderr.on("data", (chunk) => {
        errorText += chunk.toString("utf8");
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        this.process = null;
        if (code === 0) resolve({ spoken: true, characters: message.length });
        else reject(new DornSuiteError("DORN-VOICE-003", "voice", "Windows no pudo reproducir la voz.", {
          detail: errorText.slice(0, 500)
        }));
      });
    });
  }

  transcribeWave(filePath, options = {}) {
    if (process.platform !== "win32") throw new DornSuiteError("DORN-VOICE-007", "voice", "La transcripción local de audio necesita Windows.");
    const absolute = fs.realpathSync(String(filePath));
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || path.extname(absolute).toLowerCase() !== ".wav") throw new DornSuiteError("DORN-VOICE-008", "voice", "El motor integrado transcribe archivos WAV. MP3, M4A y otros formatos requieren Whisper local o una API configurada.");
    if (stat.size > 250 * 1024 * 1024) throw new DornSuiteError("DORN-VOICE-009", "voice", "El audio supera el límite de 250 MB.");
    const locale = /^[a-z]{2}-[A-Z]{2}$/.test(String(options.locale || "")) ? String(options.locale) : "es-CL";
    const encodedPath = Buffer.from(absolute, "utf16le").toString("base64");
    const encodedLocale = Buffer.from(locale, "utf16le").toString("base64");
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('" + encodedPath + "'))",
      "$locale=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('" + encodedLocale + "'))",
      "$installed=@([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())",
      "$info=$installed|Where-Object{$_.Culture.Name -eq $locale}|Select-Object -First 1",
      "if(-not $info){$info=$installed|Where-Object{$_.Culture.TwoLetterISOLanguageName -eq 'es'}|Select-Object -First 1}",
      "if(-not $info){$info=$installed|Select-Object -First 1}",
      "if(-not $info){throw 'No hay un motor de reconocimiento de voz instalado.'}",
      "$r=[System.Speech.Recognition.SpeechRecognitionEngine]::new($info)",
      "$r.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())",
      "$r.SetInputToWaveFile($p)",
      "$parts=New-Object System.Collections.Generic.List[object]",
      "while($true){$x=$r.Recognize();if(-not $x){break};$parts.Add([ordered]@{text=$x.Text;confidence=[Math]::Round($x.Confidence,3)})}",
      "$o=[ordered]@{locale=$info.Culture.Name;segments=$parts;text=(($parts|ForEach-Object{$_.text}) -join ' ')}",
      "$j=$o|ConvertTo-Json -Depth 5 -Compress",
      "$b=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($j))",
      "[Console]::Out.WriteLine(('DORNTRANSCRIPT|'+$b))"
    ].join(";");
    return new Promise((resolve, reject) => {
      const child = childProcess.spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      let errors = "";
      const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
      child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { errors += chunk.toString("utf8"); });
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timer);
        const match = /DORNTRANSCRIPT\|([A-Za-z0-9+/=]+)/.exec(output);
        if (code !== 0 || !match) return reject(new DornSuiteError("DORN-VOICE-010", "voice", "Windows no pudo transcribir este WAV.", { detail: errors.slice(0, 500) }));
        try {
          resolve({ ...JSON.parse(Buffer.from(match[1], "base64").toString("utf8")), engine: "Windows System.Speech", fileName: path.basename(absolute) });
        } catch {
          reject(new DornSuiteError("DORN-VOICE-010", "voice", "Windows devolvió una transcripción no válida."));
        }
      });
    });
  }
}

function providerHeaders(provider) {
  const headers = {
    "Content-Type": "application/json",
    ...(provider.headers || {})
  };
  if (provider.apiKey) {
    if (provider.authType === "x-api-key") headers[provider.authHeader || "x-api-key"] = provider.apiKey;
    else if (provider.authType !== "query") headers[provider.authHeader || "Authorization"] = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

function imageEndpoint(provider) {
  const base = String(provider.baseUrl || "").replace(/\/+$/, "");
  if (!/^https:\/\/|^http:\/\/127\.0\.0\.1(?::\d+)?/i.test(base)) {
    throw new DornSuiteError("DORN-IMAGE-001", "image", "El proveedor de imágenes necesita HTTPS o un servidor local.");
  }
  const endpoint = String(provider.imageEndpoint || "/images/generations");
  const url = new URL(endpoint.startsWith("/") ? `${base}${endpoint}` : `${base}/${endpoint}`);
  if (provider.authType === "query" && provider.apiKey) url.searchParams.set(provider.authQuery || "key", provider.apiKey);
  return url;
}

class ImageEngine {
  constructor(providers) {
    this.providers = providers;
  }

  candidates() {
    return this.providers.list()
      .filter((provider) => {
        const endpoint = String(provider.endpoint || provider.imageEndpoint || "");
        return provider.enabled
          && provider.hasApiKey
          && Array.isArray(provider.capabilities)
          && provider.capabilities.includes("image")
          && /\/images\//i.test(endpoint);
      })
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        model: provider.model,
        protocol: provider.protocol
      }));
  }

  async generate(options = {}) {
    const prompt = String(options.prompt || "").trim();
    if (!prompt) throw new DornSuiteError("DORN-IMAGE-002", "image", "La imagen necesita una descripción.");
    const available = this.candidates();
    const selected = options.providerId
      ? available.find((provider) => provider.id === options.providerId)
      : available[0];
    if (!selected) {
      throw new DornSuiteError("DORN-IMAGE-003", "image", "No hay un proveedor de imágenes configurado.", {
        actions: ["Configura una API con capacidad image.", "Indica el modelo de imagen en la conexión."]
      });
    }
    const provider = this.providers.runtime(selected.id);
    const model = String(options.model || provider.model || "").trim();
    if (!model) throw new DornSuiteError("DORN-IMAGE-004", "image", "La conexión no define un modelo de imagen.");
    const size = /^(?:auto|\d{3,4}x\d{3,4})$/.test(String(options.size || "1024x1024"))
      ? String(options.size || "1024x1024")
      : "1024x1024";
    const requestBody = {
      model,
      prompt,
      size,
      n: 1
    };
    if (!/^gpt-image-/i.test(model)) requestBody.response_format = "b64_json";
    const response = await fetch(imageEndpoint(provider), {
      method: "POST",
      headers: providerHeaders(provider),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(Math.max(30000, Math.min(600000, Number(options.timeoutMs || 180000))))
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new DornSuiteError("DORN-IMAGE-005", "image", `El proveedor respondió HTTP ${response.status}.`, {
        detail,
        actions: ["Revisa el modelo de imagen.", "Comprueba la cuota y los permisos de la API."],
        retryable: response.status === 429 || response.status >= 500
      });
    }
    const data = await response.json();
    const first = Array.isArray(data.data) ? data.data[0] : data.output?.[0];
    let buffer;
    let mimeType = data.output_format === "jpeg" ? "image/jpeg" : data.output_format === "webp" ? "image/webp" : "image/png";
    if (first?.b64_json || first?.base64) {
      buffer = Buffer.from(first.b64_json || first.base64, "base64");
    } else if (first?.url) {
      const remote = new URL(first.url);
      if (remote.protocol !== "https:") throw new DornSuiteError("DORN-IMAGE-006", "image", "El proveedor devolvió una URL de imagen no segura.");
      const imageResponse = await fetch(remote, { signal: AbortSignal.timeout(120000) });
      if (!imageResponse.ok) throw new DornSuiteError("DORN-IMAGE-007", "image", "No fue posible descargar la imagen generada.");
      const declaredLength = Number(imageResponse.headers.get("content-length") || 0);
      if (declaredLength > MAX_IMAGE_BYTES) throw new DornSuiteError("DORN-IMAGE-008", "image", "La imagen generada supera 25 MB.");
      buffer = Buffer.from(await imageResponse.arrayBuffer());
      mimeType = imageResponse.headers.get("content-type") || mimeType;
    }
    if (!buffer?.length || buffer.length > MAX_IMAGE_BYTES) {
      throw new DornSuiteError("DORN-IMAGE-009", "image", "El proveedor no devolvió una imagen válida o superó 25 MB.");
    }
    return {
      providerId: selected.id,
      providerName: selected.name,
      model,
      prompt,
      size,
      mimeType,
      bytes: buffer.length,
      sha256: sha256Buffer(buffer),
      base64: buffer.toString("base64"),
      revisedPrompt: first?.revised_prompt || null
    };
  }
}

class CollaborationEngine {
  constructor(stateRoot) {
    this.filePath = path.join(stateRoot, "collaboration.json");
    this.state = readJson(this.filePath, { messages: [], updatedAt: now() });
    this.server = null;
    this.session = null;
  }

  status() {
    return {
      active: Boolean(this.server?.listening),
      host: this.session?.host || null,
      port: this.session?.port || null,
      audience: this.session?.audience || null,
      messageCount: this.state.messages.length,
      transport: "http-json",
      tls: false
    };
  }

  appendMessage(message) {
    const author = String(message.author || "Invitado").trim().slice(0, 80);
    const content = String(message.content || "").trim();
    if (!content || Buffer.byteLength(content, "utf8") > MAX_COLLAB_MESSAGE_BYTES) {
      throw new DornSuiteError("DORN-COLLAB-001", "collaboration", "El mensaje está vacío o supera 64 KB.");
    }
    const item = {
      id: crypto.randomUUID(),
      author,
      content,
      createdAt: now()
    };
    this.state.messages.push(item);
    this.state.messages = this.state.messages.slice(-1000);
    this.state.updatedAt = now();
    atomicJson(this.filePath, this.state);
    return item;
  }

  async start(options = {}) {
    if (this.server?.listening) return { ...this.status(), token: this.session.token };
    const audience = options.audience === "lan" ? "lan" : "local";
    const host = audience === "lan" ? "0.0.0.0" : "127.0.0.1";
    const token = crypto.randomBytes(32).toString("base64url");
    const server = http.createServer((request, response) => {
      const authorization = String(request.headers.authorization || "");
      if (authorization !== `Bearer ${token}`) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (request.method === "GET" && request.url === "/api/messages") {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ messages: this.state.messages }));
        return;
      }
      if (request.method === "POST" && request.url === "/api/messages") {
        let body = Buffer.alloc(0);
        request.on("data", (chunk) => {
          body = Buffer.concat([body, chunk]);
          if (body.length > MAX_COLLAB_MESSAGE_BYTES + 4096) request.destroy();
        });
        request.on("end", () => {
          try {
            const item = this.appendMessage(JSON.parse(body.toString("utf8")));
            response.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
            response.end(JSON.stringify(item));
          } catch (error) {
            response.writeHead(400, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        });
        return;
      }
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(options.port || 0), host, resolve);
    });
    const address = server.address();
    this.server = server;
    this.session = {
      host,
      port: typeof address === "object" && address ? address.port : Number(options.port || 0),
      audience,
      token
    };
    return { ...this.status(), token };
  }

  async stop() {
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    this.session = null;
    return this.status();
  }
}

class PlatformServices {
  constructor(options) {
    this.recovery = new RecoveryEngine(options.stateRoot);
    this.telemetry = new TelemetryEngine(options.stateRoot);
    this.voice = new VoiceEngine();
    this.images = new ImageEngine(options.providers);
    this.collaboration = new CollaborationEngine(options.stateRoot);
  }

  status() {
    return {
      account: this.recovery.profileStatus(),
      backups: this.recovery.listBackups().length,
      telemetry: this.telemetry.status(),
      voice: this.voice.status(),
      imageProviders: this.images.candidates(),
      collaboration: this.collaboration.status()
    };
  }

  async stop() {
    this.voice.stop();
    await this.collaboration.stop();
  }
}

module.exports = {
  RecoveryEngine,
  TelemetryEngine,
  VoiceEngine,
  ImageEngine,
  CollaborationEngine,
  PlatformServices
};
