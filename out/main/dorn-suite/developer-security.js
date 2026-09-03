"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");

const ADMIN_PATTERN = /(?:Start-Process\b[^\r\n]*-Verb\s+RunAs|\brunas\b|\bnet\s+(?:user|localgroup)\b|\bsc\s+(?:create|delete|config|start|stop)\b|\b(?:choco|winget)\s+(?:install|uninstall|upgrade)\b|\bdism(?:\.exe)?\b|\breg\s+(?:add|delete)\s+HKLM\\)/i;

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function cleanOutput(value, maximum) {
  const buffer = Buffer.from(String(value || ""), "utf8");
  if (buffer.length <= maximum) return { value: buffer.toString("utf8"), truncated: false };
  return { value: buffer.subarray(0, maximum).toString("utf8"), truncated: true };
}

class DeveloperSecurity {
  constructor(options) {
    this.stateRoot = path.join(options.stateRoot, "developer-security");
    this.statePath = path.join(this.stateRoot, "state.json");
    this.dialog = options.dialog;
    this.parentWindow = options.parentWindow || (() => undefined);
    this.state = readJson(this.statePath, {
      enabled: false,
      uacRequestAuthorized: false,
      enabledAt: null,
      disabledAt: null,
      lastUacProbeAt: null
    });
  }

  status() {
    return {
      enabled: this.state.enabled === true,
      uacRequestAuthorized: this.state.enabled === true && this.state.uacRequestAuthorized === true,
      enabledAt: this.state.enabledAt,
      lastUacProbeAt: this.state.lastUacProbeAt,
      actualUacPerElevatedAction: process.platform === "win32",
      permanentUacTokenStored: false,
      approvalScope: "task-or-console",
      fullAccess: this.state.enabled === true
    };
  }

  commandNeedsElevation(command) {
    return ADMIN_PATTERN.test(String(command || ""));
  }

  canRequestElevation() {
    return this.state.enabled === true && this.state.uacRequestAuthorized === true;
  }

  assertElevatedAllowed() {
    if (!this.state.enabled) throw new Error("Desarrollador está desactivado. DORN bloqueó la ejecución elevada.");
    if (!this.state.uacRequestAuthorized) throw new Error("DORN no tiene autorización para solicitar administrador. Activa nuevamente Desarrollador.");
    if (process.platform !== "win32") throw new Error("La elevación UAC real sólo está disponible en Windows.");
    return true;
  }

  runUacProbe() {
    if (process.platform !== "win32") {
      return { ok: true, platformValidated: false, detail: "La ruta UAC queda preparada para Windows." };
    }
    fs.mkdirSync(this.stateRoot, { recursive: true });
    const nonce = crypto.randomBytes(24).toString("hex");
    const proofPath = path.join(this.stateRoot, `uac-proof-${crypto.randomUUID()}.txt`);
    const encoded = Buffer.from(`Set-Content -LiteralPath ${psQuote(proofPath)} -Value ${psQuote(nonce)} -Encoding UTF8`, "utf16le").toString("base64");
    const command = `$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'); exit $p.ExitCode } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1223 }`;
    const result = childProcess.spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 120_000
    });
    let proof = "";
    try { proof = fs.readFileSync(proofPath, "utf8").trim(); } catch {}
    try { fs.unlinkSync(proofPath); } catch {}
    if (result.status !== 0 || proof !== nonce) {
      throw new Error("Windows no concedió la autorización UAC. Desarrollador permanece desactivado.");
    }
    return { ok: true, platformValidated: true, detail: "Windows confirmó la solicitud UAC." };
  }

  async setEnabled(enabled) {
    if (!enabled) {
      this.state = {
        ...this.state,
        enabled: false,
        uacRequestAuthorized: false,
        disabledAt: new Date().toISOString()
      };
      atomicJson(this.statePath, this.state);
      return this.status();
    }
    if (this.canRequestElevation()) return this.status();
    const confirmation = await this.dialog.showMessageBox(this.parentWindow(), {
      type: "warning",
      title: "Activar DORN Desarrollador",
      message: "¿Permitir que DORN prepare y ejecute herramientas de desarrollo dentro de proyectos autorizados?",
      detail: "DORN mostrará siempre su confirmación interna. Las acciones elevadas abrirán además el UAC real de Windows. No se guardará ningún token UAC permanente.",
      buttons: ["No", "Sí, continuar"],
      defaultId: 0,
      cancelId: 0
    });
    if (confirmation.response !== 1) throw new Error("Activación cancelada. Desarrollador permanece desactivado.");
    const probe = this.runUacProbe();
    const timestamp = new Date().toISOString();
    this.state = {
      ...this.state,
      enabled: true,
      uacRequestAuthorized: true,
      enabledAt: timestamp,
      disabledAt: null,
      lastUacProbeAt: probe.platformValidated ? timestamp : this.state.lastUacProbeAt
    };
    atomicJson(this.statePath, this.state);
    return { ...this.status(), probe };
  }

  executeElevated(request, cwd, options = {}) {
    this.assertElevatedAllowed();
    const maximum = Number(options.maximumOutput || 1024 * 1024);
    const sessionRoot = path.join(this.stateRoot, "sessions", crypto.randomUUID());
    fs.mkdirSync(sessionRoot, { recursive: true });
    const commandPath = path.join(sessionRoot, "command.txt");
    const scriptPath = path.join(sessionRoot, "elevated.ps1");
    const stdoutPath = path.join(sessionRoot, "stdout.txt");
    const stderrPath = path.join(sessionRoot, "stderr.txt");
    const resultPath = path.join(sessionRoot, "result.json");
    fs.writeFileSync(commandPath, String(request.command), { encoding: "utf8", mode: 0o600 });
    const executable = request.shell === "powershell" ? "powershell.exe" : (process.env.ComSpec || "cmd.exe");
    const argumentsExpression = request.shell === "powershell"
      ? "@('-NoLogo','-NoProfile','-NonInteractive','-Command',$command)"
      : "@('/d','/s','/c',$command)";
    const wrapper = [
      "$ErrorActionPreference='Continue'",
      `$command=Get-Content -Raw -LiteralPath ${psQuote(commandPath)}`,
      `Set-Location -LiteralPath ${psQuote(cwd)}`,
      `$process=Start-Process -FilePath ${psQuote(executable)} -ArgumentList ${argumentsExpression} -Wait -PassThru -NoNewWindow -RedirectStandardOutput ${psQuote(stdoutPath)} -RedirectStandardError ${psQuote(stderrPath)}`,
      `$result=[ordered]@{exitCode=$process.ExitCode;finishedAt=(Get-Date).ToUniversalTime().ToString('o')}`,
      `$result|ConvertTo-Json -Compress|Set-Content -LiteralPath ${psQuote(resultPath)} -Encoding UTF8`,
      "exit $process.ExitCode"
    ].join("\r\n");
    fs.writeFileSync(scriptPath, wrapper, { encoding: "utf8", mode: 0o600 });
    const encodedLauncher = Buffer.from(`$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${psQuote(scriptPath)}); exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1223 }`, "utf16le").toString("base64");
    const startedAt = new Date().toISOString();
    const child = childProcess.spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedLauncher], {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const promise = new Promise((resolve, reject) => {
      let launcherError = "";
      child.stderr.on("data", (chunk) => { launcherError += chunk.toString("utf8"); });
      const timeout = setTimeout(() => child.kill(), Number(request.timeoutMs || 120_000));
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (launcherCode, signal) => {
        clearTimeout(timeout);
        try {
          if (!fs.existsSync(resultPath)) {
            throw new Error(launcherCode === 1223 ? "El usuario canceló el UAC de Windows." : launcherError.trim() || "La ejecución elevada no produjo un resultado verificable.");
          }
          const metadata = JSON.parse(fs.readFileSync(resultPath, "utf8").replace(/^\uFEFF/, ""));
          const stdout = cleanOutput(fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf8") : "", maximum);
          const stderr = cleanOutput(fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf8") : "", maximum);
          resolve({
            startedAt,
            finishedAt: metadata.finishedAt || new Date().toISOString(),
            exitCode: Number(metadata.exitCode),
            signal,
            stdout: stdout.value,
            stderr: stderr.value,
            truncated: stdout.truncated || stderr.truncated,
            elevated: true,
            uacDisplayed: true
          });
        } catch (error) {
          reject(error);
        } finally {
          try { fs.rmSync(sessionRoot, { recursive: true, force: true }); } catch {}
        }
      });
    });
    return { child, promise };
  }
}

module.exports = { DeveloperSecurity, ADMIN_PATTERN };
