"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const childProcess = require("node:child_process");
const { promisify } = require("node:util");
const { now, redact } = require("./common");

const execFile = promisify(childProcess.execFile);

async function detectExecutable(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await execFile(locator, [command], {
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 128 * 1024
    });
    const executablePath = result.stdout.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || null;
    return { command, installed: Boolean(executablePath), path: executablePath };
  } catch {
    return { command, installed: false, path: null };
  }
}

function diskProfile(targetPath) {
  try {
    const stat = fs.statfsSync(targetPath);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
  } catch (error) {
    return { error: redact(error instanceof Error ? error.message : String(error)) };
  }
}

function directorySize(rootPath, limits = {}) {
  const maxFiles = Number(limits.maxFiles || 100000);
  const maxDurationMs = Number(limits.maxDurationMs || 2500);
  const started = Date.now();
  let files = 0;
  let directories = 0;
  let sizeBytes = 0;
  let truncated = false;
  const pending = [rootPath];
  while (pending.length) {
    if (files >= maxFiles || Date.now() - started >= maxDurationMs) {
      truncated = true;
      break;
    }
    const directory = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    directories += 1;
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) {
        try {
          sizeBytes += fs.statSync(absolute).size;
          files += 1;
        } catch {
        }
      }
    }
  }
  return { files, directories, sizeBytes, truncated, durationMs: Date.now() - started };
}

class DoctorEngine {
  constructor(options) {
    this.userDataPath = options.userDataPath;
    this.providers = options.providers;
    this.localRuntime = options.localRuntime;
    this.suiteStatus = options.suiteStatus;
  }

  async run() {
    const tools = await Promise.all([
      detectExecutable("git"),
      detectExecutable("node"),
      detectExecutable("python"),
      detectExecutable("blender"),
      detectExecutable("freecad"),
      detectExecutable("ffmpeg"),
      detectExecutable("adb")
    ]);
    const providerList = this.providers().map((provider) => ({
      id: provider.id,
      name: provider.name,
      enabled: provider.enabled,
      local: provider.local,
      configured: provider.authType === "none" || provider.hasApiKey,
      protocol: provider.protocol,
      model: provider.model
    }));
    const memory = {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem(),
      usedBytes: os.totalmem() - os.freemem()
    };
    const warnings = [];
    if (memory.freeBytes < 2 * 1024 ** 3) warnings.push("Quedan menos de 2 GB de RAM disponibles.");
    const disk = diskProfile(this.userDataPath);
    if (disk.freeBytes && disk.freeBytes < 5 * 1024 ** 3) warnings.push("Quedan menos de 5 GB libres en la unidad de datos de DORN.");
    const local = this.localRuntime();
    if (!local.installed) warnings.push(local.detail);
    const report = {
      diagnosisId: `doctor-${Date.now()}`,
      generatedAt: now(),
      platform: {
        os: process.platform,
        architecture: process.arch,
        release: os.release(),
        cpu: os.cpus()[0]?.model || "No identificado",
        cores: os.cpus().length
      },
      memory,
      disk,
      localRuntime: local,
      providers: providerList,
      tools,
      suite: this.suiteStatus(),
      storage: directorySize(this.userDataPath),
      warnings
    };
    return report;
  }
}

module.exports = {
  detectExecutable,
  directorySize,
  DoctorEngine
};
