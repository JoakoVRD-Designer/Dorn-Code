"use strict";

if (!process.versions.electron) {
  console.error("Este smoke test debe ejecutarse con ELECTRON_RUN_AS_NODE=1 y Electron 37.2.6.");
  process.exit(2);
}

const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const projectRoot = path.resolve(__dirname, "..");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dorn-main-smoke-"));
const resourcesPath = path.resolve(
  process.env.DORN_TEST_RESOURCES_PATH || path.join(projectRoot, "resources")
);
const errors = [];
const windows = [];
let nextWebContentsId = 1;

class MockWebContents extends EventEmitter {
  constructor() {
    super();
    this.id = nextWebContentsId++;
  }
  send() {
  }
  isDestroyed() {
    return false;
  }
  setWindowOpenHandler() {
  }
  executeJavaScript() {
    return Promise.resolve(true);
  }
}

class MockBrowserWindow extends EventEmitter {
  constructor() {
    super();
    this.webContents = new MockWebContents();
    this.visible = false;
    windows.push(this);
  }
  static getAllWindows() {
    return windows.filter((window) => !window.destroyed);
  }
  loadFile() {
    setImmediate(() => {
      this.webContents.emit("did-finish-load");
      this.emit("ready-to-show");
    });
    return Promise.resolve();
  }
  loadURL() {
    return this.loadFile();
  }
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  focus() {
  }
  close() {
    this.destroyed = true;
    this.emit("closed");
  }
  destroy() {
    this.close();
  }
  isDestroyed() {
    return Boolean(this.destroyed);
  }
  isFocused() {
    return true;
  }
  isMinimized() {
    return false;
  }
  isMaximized() {
    return false;
  }
  minimize() {
  }
  maximize() {
    this.emit("maximize");
  }
  unmaximize() {
    this.emit("unmaximize");
  }
  restore() {
  }
  setAlwaysOnTop() {
  }
  setVisibleOnAllWorkspaces() {
  }
  moveTop() {
  }
}

class MockTray extends EventEmitter {
  setToolTip() {
  }
  setContextMenu() {
  }
}

class MockNotification {
  static isSupported() {
    return true;
  }
  show() {
  }
}

const appEvents = new EventEmitter();
const electronMock = {
  app: {
    isPackaged: true,
    commandLine: { appendSwitch() {} },
    setPath() {},
    setName() {},
    setAppUserModelId() {},
    requestSingleInstanceLock() { return true; },
    whenReady() { return Promise.resolve(); },
    on: appEvents.on.bind(appEvents),
    quit() {},
    exit(code) { process.exitCode = code; },
    getVersion() { return "4.0.0-alpha.3"; },
    getAppPath() { return projectRoot; },
    getPath(name) {
      if (name === "userData") return userData;
      return userData;
    },
    getGPUInfo() { return Promise.resolve({ gpuDevice: [] }); },
    setLoginItemSettings() {}
  },
  BrowserWindow: MockBrowserWindow,
  Tray: MockTray,
  Notification: MockNotification,
  Menu: {
    setApplicationMenu() {},
    buildFromTemplate(template) { return template; }
  },
  ipcMain: {
    handle() {}
  },
  protocol: {
    registerSchemesAsPrivileged() {},
    handle() {}
  },
  net: {
    fetch() { return Promise.resolve(new Response("", { status: 404 })); }
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {}
    }
  },
  dialog: {
    showErrorBox(title, detail) {
      errors.push(`${title}: ${detail}`);
    },
    showMessageBox() { return Promise.resolve({ response: 0 }); },
    showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
    showSaveDialog() { return Promise.resolve({ canceled: true, filePath: null }); }
  },
  safeStorage: {
    isEncryptionAvailable() { return false; },
    encryptString(value) { return Buffer.from(value, "utf8"); },
    decryptString(value) { return value.toString("utf8"); }
  },
  clipboard: { writeText() {} },
  shell: { openExternal() { return Promise.resolve(); } }
};

const originalLoad = Module._load;
Module._load = function dornSmokeLoad(request, parent, isMain) {
  if (request === "electron") return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

Object.defineProperty(process, "resourcesPath", {
  configurable: true,
  value: resourcesPath
});

require("../out/main/bootstrap.js");

setTimeout(() => {
  const startupLog = path.join(userData, "dorn-startup.log");
  const bootstrapLog = path.join(userData, "dorn-bootstrap.log");
  const startupText = fs.existsSync(startupLog) ? fs.readFileSync(startupLog, "utf8") : "";
  const bootstrapText = fs.existsSync(bootstrapLog) ? fs.readFileSync(bootstrapLog, "utf8") : "";
  const failures = [];
  if (errors.length) failures.push(...errors);
  if (!/Bootstrap DORN 4\.0\.0-alpha\.3/.test(bootstrapText)) {
    failures.push("El bootstrap no dejó su registro.");
  }
  if (!/Base de datos lista/.test(startupText)) {
    failures.push("La base SQLite no completó el arranque.");
  }
  if (!/DORN Suite Core 4\.0\.0-alpha\.3 listo/.test(startupText)) {
    failures.push("DORN Suite Core no completó el arranque.");
  }
  if (!windows.length) failures.push("No se creó ninguna ventana de DORN.");

  if (failures.length) {
    console.error("SMOKE DEL PROCESO PRINCIPAL RECHAZADO");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    `Smoke principal correcto · SQLite + Suite Core + ${windows.length} ventana(s) · ${startupLog}`
  );
  process.exit(0);
}, 1500);
