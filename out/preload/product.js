"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("dornProduct", {
  context: () => ipcRenderer.invoke("dorn:product_context"),
  openFile: () => ipcRenderer.invoke("dorn:product_open_file"),
  saveFile: (payload) => ipcRenderer.invoke("dorn:product_save_file", payload),
  sendToDorn: (payload) => ipcRenderer.invoke("dorn:product_send_to_dorn", payload),
  windowAction: (action) => ipcRenderer.invoke("dorn:product_window_action", action),
  appearance: {
    get: () => ipcRenderer.invoke("dorn:appearance_get"),
    save: (value) => ipcRenderer.invoke("dorn:appearance_save", value),
    onChange: (callback) => subscribe("dorn:appearance_changed", callback)
  },
  voice: {
    status: () => ipcRenderer.invoke("dorn:suite_voice_status"),
    diagnostics: () => ipcRenderer.invoke("dorn:voice_diagnostics"),
    speak: (text, options = {}) => ipcRenderer.invoke("dorn:suite_voice_speak", text, options),
    stop: () => ipcRenderer.invoke("dorn:suite_voice_stop"),
    transcribeAudio: (locale = "es-CL") => ipcRenderer.invoke("dorn:voice_transcribe_pick", locale),
    startRecognition: (locale = "es-CL") => ipcRenderer.invoke("dorn:voice_recognition_start", locale),
    stopRecognition: () => ipcRenderer.invoke("dorn:voice_recognition_stop"),
    onRecognition: (callback) => subscribe("dorn:voice_recognition_event", callback)
  }
});
