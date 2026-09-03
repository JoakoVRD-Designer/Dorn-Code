"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("dornStudio", {
  context: () => ipcRenderer.invoke("dorn:studio3d_context"),
  readFile: () => ipcRenderer.invoke("dorn:studio3d_read_file"),
  readResource: (relativeUri) => ipcRenderer.invoke("dorn:studio3d_read_resource", relativeUri),
  copyReport: () => ipcRenderer.invoke("dorn:studio3d_copy_report"),
  appearance: {
    get: () => ipcRenderer.invoke("dorn:appearance_get"),
    save: (value) => ipcRenderer.invoke("dorn:appearance_save", value),
    onChange: (callback) => subscribe("dorn:appearance_changed", callback)
  }
});
