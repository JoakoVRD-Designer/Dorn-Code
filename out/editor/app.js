"use strict";

const api = window.dornProduct;
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "webm", "avi"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "flac"]);
const state = {
  project: createProject(),
  projectPath: null,
  selectedId: null,
  dirty: false
};

function createProject() {
  return {
    schema: "dorn-editor/1",
    name: "Proyecto sin título",
    fps: 30,
    width: 1920,
    height: 1080,
    clips: [],
    subtitles: []
  };
}

function byId(id) {
  return document.getElementById(id);
}

function selectedClip() {
  return state.project.clips.find((clip) => clip.id === state.selectedId) || null;
}

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const remaining = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(3).padStart(6, "0")}`;
}

function setStatus(message, isError = false) {
  byId("status").textContent = message;
  byId("status").style.color = isError ? "#ff7b86" : "";
}

function markDirty(message = "Proyecto modificado") {
  state.dirty = true;
  byId("project-state").textContent = "Cambios sin guardar";
  setStatus(message);
}

function recalculateStarts() {
  const tracks = { video: 0, audio: 0 };
  for (const clip of state.project.clips) {
    const duration = Math.max(0.01, Number(clip.outPoint) - Number(clip.inPoint));
    clip.start = tracks[clip.type];
    tracks[clip.type] += duration;
  }
}

function render() {
  byId("project-name").value = state.project.name;
  byId("project-fps").value = String(state.project.fps);
  byId("project-size").value = `${state.project.width}x${state.project.height}`;
  renderLibrary();
  renderTrack("video", "clips");
  renderTrack("audio", "audio-clips");
  renderInspector();
  renderSubtitles();
}

function renderLibrary() {
  const root = byId("media-library");
  root.replaceChildren();
  const unique = new Map();
  for (const clip of state.project.clips) {
    if (!unique.has(clip.sourceId)) unique.set(clip.sourceId, clip);
  }
  if (!unique.size) {
    const empty = document.createElement("small");
    empty.textContent = "Aún no hay archivos importados.";
    empty.style.padding = "12px";
    root.append(empty);
    return;
  }
  for (const clip of unique.values()) {
    const button = document.createElement("button");
    button.className = `media-item${clip.id === state.selectedId ? " active" : ""}`;
    button.innerHTML = `<span class="media-icon">${clip.type === "video" ? "VIDEO" : "AUDIO"}</span><span class="media-copy"><strong></strong><small></small></span>`;
    button.querySelector("strong").textContent = clip.sourceName;
    button.querySelector("small").textContent = clip.offline ? "Referencia sin vincular" : `${(clip.sizeBytes / 1024 ** 2).toFixed(1)} MB`;
    button.addEventListener("click", () => selectClip(clip.id));
    root.append(button);
  }
}

function renderTrack(type, rootId) {
  const root = byId(rootId);
  root.replaceChildren();
  for (const clip of state.project.clips.filter((entry) => entry.type === type)) {
    const button = document.createElement("button");
    button.className = `clip ${type}${clip.id === state.selectedId ? " active" : ""}`;
    const duration = Math.max(0.01, clip.outPoint - clip.inPoint);
    button.style.width = `${Math.max(85, Math.min(260, duration * 16))}px`;
    const strong = document.createElement("strong");
    strong.textContent = clip.name;
    const small = document.createElement("small");
    small.textContent = `${formatTime(clip.inPoint)} → ${formatTime(clip.outPoint)}`;
    button.append(strong, small);
    button.addEventListener("click", () => selectClip(clip.id));
    root.append(button);
  }
}

function renderInspector() {
  const clip = selectedClip();
  const inputs = ["clip-name", "clip-in", "clip-out", "clip-volume"];
  inputs.forEach((id) => { byId(id).disabled = !clip; });
  byId("clip-name").value = clip?.name || "";
  byId("clip-in").value = clip ? clip.inPoint.toFixed(2) : "";
  byId("clip-out").value = clip ? clip.outPoint.toFixed(2) : "";
  byId("clip-volume").value = clip?.volume ?? 1;
  byId("clip-duration").textContent = clip ? formatTime(clip.outPoint - clip.inPoint) : "—";
  byId("clip-path").textContent = clip?.path || "—";
}

function renderSubtitles() {
  const root = byId("subtitle-list");
  root.replaceChildren();
  state.project.subtitles.forEach((subtitle) => {
    const item = document.createElement("div");
    item.className = "subtitle-item";
    item.innerHTML = `<small></small><span></span><button aria-label="Eliminar">×</button>`;
    item.querySelector("small").textContent = `${formatTime(subtitle.start)} – ${formatTime(subtitle.end)}`;
    item.querySelector("span").textContent = subtitle.text;
    item.querySelector("button").addEventListener("click", () => {
      state.project.subtitles = state.project.subtitles.filter((entry) => entry.id !== subtitle.id);
      markDirty("Subtítulo eliminado.");
      renderSubtitles();
    });
    root.append(item);
  });
}

function selectClip(id) {
  const clip = state.project.clips.find((entry) => entry.id === id);
  if (!clip) return;
  state.selectedId = clip.id;
  const preview = byId("preview");
  if (clip.fileUrl && !clip.offline) {
    preview.src = clip.fileUrl;
    preview.style.display = "block";
    byId("viewer-empty").style.display = "none";
    preview.volume = clip.volume;
    const seek = () => {
      preview.currentTime = Math.min(clip.inPoint, Number.isFinite(preview.duration) ? preview.duration : clip.inPoint);
      preview.removeEventListener("loadedmetadata", seek);
    };
    preview.addEventListener("loadedmetadata", seek);
  } else {
    preview.removeAttribute("src");
    preview.load();
    preview.style.display = "none";
    byId("viewer-empty").style.display = "";
    setStatus("El proyecto recuerda la referencia, pero debes volver a importar el medio para autorizarlo.", true);
  }
  byId("active-media").textContent = clip.name;
  render();
}

async function importFile() {
  try {
    const file = await api.openFile();
    if (!file) return;
    if (file.extension === "json") {
      await loadProject(file);
      return;
    }
    const type = VIDEO_EXTENSIONS.has(file.extension) ? "video" : AUDIO_EXTENSIONS.has(file.extension) ? "audio" : null;
    if (!type) throw new Error("El formato seleccionado no está soportado en esta base.");
    const offlineMatches = state.project.clips.filter((clip) => clip.offline && clip.sourceName.toLowerCase() === file.name.toLowerCase() && clip.type === type);
    if (offlineMatches.length) {
      const relink = confirm(`El proyecto contiene ${offlineMatches.length} referencia(s) sin vincular a “${file.name}”. ¿Volver a conectarlas con este archivo?`);
      if (relink) {
        for (const clip of offlineMatches) {
          clip.path = file.path;
          clip.fileUrl = file.fileUrl;
          clip.extension = file.extension;
          clip.sizeBytes = file.sizeBytes;
          clip.offline = false;
        }
        state.selectedId = offlineMatches[0].id;
        markDirty(`${file.name} volvió a vincularse sin duplicar los clips.`);
        selectClip(offlineMatches[0].id);
        return;
      }
    }
    const sourceId = crypto.randomUUID();
    const clip = {
      id: crypto.randomUUID(),
      sourceId,
      sourceName: file.name,
      name: file.name,
      path: file.path,
      fileUrl: file.fileUrl,
      extension: file.extension,
      type,
      start: 0,
      inPoint: 0,
      outPoint: 10,
      duration: null,
      volume: 1,
      sizeBytes: file.sizeBytes,
      offline: false
    };
    state.project.clips.push(clip);
    recalculateStarts();
    state.selectedId = clip.id;
    markDirty(`${file.name} fue añadido a la secuencia.`);
    selectClip(clip.id);
  } catch (error) {
    setStatus(error.message || "No se pudo importar el archivo.", true);
  }
}

function validateProject(project) {
  if (!project || project.schema !== "dorn-editor/1" || !Array.isArray(project.clips) || !Array.isArray(project.subtitles)) {
    throw new Error("El archivo no es un proyecto DORN Editor compatible.");
  }
  if (project.clips.length > 2000 || project.subtitles.length > 10000) throw new Error("El proyecto supera los límites seguros.");
  return {
    schema: "dorn-editor/1",
    name: String(project.name || "Proyecto importado").slice(0, 120),
    fps: [24, 25, 30, 50, 60].includes(Number(project.fps)) ? Number(project.fps) : 30,
    width: Math.max(320, Math.min(7680, Number(project.width) || 1920)),
    height: Math.max(240, Math.min(4320, Number(project.height) || 1080)),
    clips: project.clips.map((clip) => ({
      id: crypto.randomUUID(),
      sourceId: String(clip.sourceId || crypto.randomUUID()),
      sourceName: String(clip.sourceName || clip.name || "Medio"),
      name: String(clip.name || "Clip").slice(0, 160),
      path: String(clip.path || ""),
      fileUrl: null,
      extension: String(clip.extension || "").toLowerCase(),
      type: clip.type === "audio" ? "audio" : "video",
      start: Math.max(0, Number(clip.start) || 0),
      inPoint: Math.max(0, Number(clip.inPoint) || 0),
      outPoint: Math.max(0.01, Number(clip.outPoint) || 10),
      duration: Number.isFinite(clip.duration) ? clip.duration : null,
      volume: Math.max(0, Math.min(1, Number(clip.volume) || 0)),
      sizeBytes: Math.max(0, Number(clip.sizeBytes) || 0),
      offline: true
    })),
    subtitles: project.subtitles.map((subtitle) => ({
      id: crypto.randomUUID(),
      text: String(subtitle.text || "").slice(0, 2000),
      start: Math.max(0, Number(subtitle.start) || 0),
      end: Math.max(0.1, Number(subtitle.end) || 0.1)
    }))
  };
}

async function loadProject(file) {
  const parsed = JSON.parse(file.content);
  state.project = validateProject(parsed);
  state.projectPath = file.path;
  state.selectedId = state.project.clips[0]?.id || null;
  state.dirty = false;
  byId("project-state").textContent = file.name;
  setStatus("Proyecto abierto. Por seguridad, vuelve a importar cada medio cuando quieras reproducirlo.");
  render();
}

function serializableProject() {
  return {
    ...state.project,
    updatedAt: new Date().toISOString(),
    clips: state.project.clips.map(({ fileUrl, offline, ...clip }) => clip)
  };
}

async function saveProject(saveAs = false) {
  try {
    const result = await api.saveFile({
      path: saveAs ? null : state.projectPath,
      saveAs,
      suggestedName: `${state.project.name.replace(/[<>:"/\\|?*]/g, "-").slice(0, 90) || "dorn-editor"}.dorn-editor.json`,
      content: JSON.stringify(serializableProject(), null, 2)
    });
    if (!result) return;
    state.projectPath = result.path;
    state.dirty = false;
    byId("project-state").textContent = result.name;
    setStatus(`Proyecto guardado: ${result.name}`);
  } catch (error) {
    setStatus(error.message || "No se pudo guardar.", true);
  }
}

function splitSelected() {
  const clip = selectedClip();
  if (!clip) return;
  const preview = byId("preview");
  const cursor = Number.isFinite(preview.currentTime) ? preview.currentTime : clip.inPoint;
  if (cursor <= clip.inPoint + 0.05 || cursor >= clip.outPoint - 0.05) {
    setStatus("Sitúa el cursor dentro del clip para dividirlo.", true);
    return;
  }
  const second = { ...clip, id: crypto.randomUUID(), name: `${clip.name} · 2`, inPoint: cursor };
  clip.name = `${clip.name} · 1`;
  clip.outPoint = cursor;
  const index = state.project.clips.indexOf(clip);
  state.project.clips.splice(index + 1, 0, second);
  recalculateStarts();
  state.selectedId = second.id;
  markDirty("Clip dividido en el cursor.");
  render();
}

function moveSelected(direction) {
  const clip = selectedClip();
  if (!clip) return;
  const sameTrack = state.project.clips.filter((entry) => entry.type === clip.type);
  const position = sameTrack.indexOf(clip);
  const neighbor = sameTrack[position + direction];
  if (!neighbor) return;
  const first = state.project.clips.indexOf(clip);
  const second = state.project.clips.indexOf(neighbor);
  [state.project.clips[first], state.project.clips[second]] = [state.project.clips[second], state.project.clips[first]];
  recalculateStarts();
  markDirty("Orden de clips actualizado.");
  render();
}

function deleteSelected() {
  if (!state.selectedId) return;
  state.project.clips = state.project.clips.filter((clip) => clip.id !== state.selectedId);
  state.selectedId = state.project.clips[0]?.id || null;
  recalculateStarts();
  byId("preview").pause();
  markDirty("Clip eliminado de la secuencia; el archivo original no cambió.");
  render();
}

async function sendToDorn() {
  try {
    const summary = serializableProject();
    await api.sendToDorn([
      "Estoy trabajando en DORN Editor. Analiza esta secuencia audiovisual y ayúdame a planificar el siguiente resultado.",
      "No asumas que el video final ya fue codificado ni que tienes acceso al contenido binario.",
      JSON.stringify(summary, null, 2)
    ].join("\n\n"));
    setStatus("El contexto de la secuencia fue enviado a DORN AI.");
  } catch (error) {
    setStatus(error.message || "No se pudo enviar a DORN AI.", true);
  }
}

function bind() {
  document.querySelectorAll("[data-window]").forEach((button) => {
    button.addEventListener("click", () => api.windowAction(button.dataset.window));
  });
  byId("new-project").addEventListener("click", () => {
    if (state.dirty && !confirm("Hay cambios sin guardar. ¿Crear un proyecto nuevo?")) return;
    state.project = createProject();
    state.projectPath = null;
    state.selectedId = null;
    state.dirty = false;
    byId("preview").removeAttribute("src");
    byId("preview").load();
    byId("preview").style.display = "none";
    byId("viewer-empty").style.display = "";
    byId("project-state").textContent = "Proyecto nuevo";
    render();
  });
  ["import-file", "library-import"].forEach((id) => byId(id).addEventListener("click", importFile));
  byId("open-project").addEventListener("click", importFile);
  byId("save-project").addEventListener("click", () => saveProject(false));
  byId("export-project").addEventListener("click", () => saveProject(true));
  byId("split-clip").addEventListener("click", splitSelected);
  byId("move-left").addEventListener("click", () => moveSelected(-1));
  byId("move-right").addEventListener("click", () => moveSelected(1));
  byId("delete-clip").addEventListener("click", deleteSelected);
  byId("send-to-dorn").addEventListener("click", sendToDorn);
  byId("project-name").addEventListener("input", (event) => {
    state.project.name = event.target.value.slice(0, 120);
    markDirty();
  });
  byId("project-fps").addEventListener("change", (event) => {
    state.project.fps = Number(event.target.value);
    markDirty();
  });
  byId("project-size").addEventListener("change", (event) => {
    [state.project.width, state.project.height] = event.target.value.split("x").map(Number);
    markDirty();
  });
  byId("clip-name").addEventListener("input", (event) => {
    const clip = selectedClip();
    if (!clip) return;
    clip.name = event.target.value.slice(0, 160);
    markDirty();
    renderTrack(clip.type, clip.type === "video" ? "clips" : "audio-clips");
  });
  ["clip-in", "clip-out"].forEach((id) => byId(id).addEventListener("change", () => {
    const clip = selectedClip();
    if (!clip) return;
    const start = Math.max(0, Number(byId("clip-in").value) || 0);
    const end = Math.max(start + 0.01, Number(byId("clip-out").value) || start + 0.01);
    clip.inPoint = Math.min(start, clip.duration || start);
    clip.outPoint = Math.min(end, clip.duration || end);
    recalculateStarts();
    markDirty("Puntos de entrada y salida actualizados.");
    render();
  }));
  byId("clip-volume").addEventListener("input", (event) => {
    const clip = selectedClip();
    if (!clip) return;
    clip.volume = Number(event.target.value);
    byId("preview").volume = clip.volume;
    markDirty("Volumen del clip actualizado.");
  });
  byId("add-subtitle").addEventListener("click", () => {
    const text = byId("subtitle-text").value.trim();
    const start = Math.max(0, Number(byId("subtitle-start").value) || 0);
    const end = Math.max(start + 0.1, Number(byId("subtitle-end").value) || start + 0.1);
    if (!text) return setStatus("Escribe el texto del subtítulo.", true);
    state.project.subtitles.push({ id: crypto.randomUUID(), text: text.slice(0, 2000), start, end });
    byId("subtitle-text").value = "";
    markDirty("Subtítulo añadido.");
    renderSubtitles();
  });
  const preview = byId("preview");
  preview.addEventListener("loadedmetadata", () => {
    const clip = selectedClip();
    if (!clip || !Number.isFinite(preview.duration)) return;
    clip.duration = preview.duration;
    if (clip.outPoint === 10 || clip.outPoint > clip.duration) clip.outPoint = clip.duration;
    recalculateStarts();
    render();
  });
  preview.addEventListener("timeupdate", () => {
    byId("time-readout").textContent = `${formatTime(preview.currentTime)} / ${formatTime(preview.duration)}`;
    const clip = selectedClip();
    if (clip && preview.currentTime >= clip.outPoint) preview.pause();
  });
}

bind();
render();
