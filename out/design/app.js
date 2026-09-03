"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const canvas = document.querySelector("[data-canvas]");
const statusNode = document.querySelector("[data-status]");
const layersNode = document.querySelector("[data-layers]");
const inspector = document.querySelector("[data-inspector]");
const emptySelection = document.querySelector("[data-empty-selection]");
let filePath = null;
let selectedId = null;
let history = [];
let future = [];
let zoom = 75;
let activeTool = "select";
let drawing = null;
let project = createProject();

function createProject() {
  return { schema: "dorn-design/1", name: "Diseño sin título", width: 1200, height: 800, background: "#f4f4f2", elements: [] };
}

function uid() {
  return crypto.randomUUID();
}

function clone(value) {
  return structuredClone(value);
}

function selected() {
  return project.elements.find((element) => element.id === selectedId) || null;
}

function checkpoint() {
  history.push(clone(project));
  if (history.length > 60) history.shift();
  future = [];
}

function setStatus(value) {
  statusNode.textContent = value;
}

function svgElement(element) {
  let node;
  if (element.type === "rectangle") {
    node = document.createElementNS(SVG_NS, "rect");
    node.setAttribute("x", element.x);
    node.setAttribute("y", element.y);
    node.setAttribute("width", element.width);
    node.setAttribute("height", element.height);
    node.setAttribute("rx", element.radius || 0);
  } else if (element.type === "ellipse") {
    node = document.createElementNS(SVG_NS, "ellipse");
    node.setAttribute("cx", element.x + element.width / 2);
    node.setAttribute("cy", element.y + element.height / 2);
    node.setAttribute("rx", element.width / 2);
    node.setAttribute("ry", element.height / 2);
  } else if (element.type === "text") {
    node = document.createElementNS(SVG_NS, "text");
    node.setAttribute("x", element.x);
    node.setAttribute("y", element.y + element.height);
    node.setAttribute("font-family", "Inter, Segoe UI, sans-serif");
    node.setAttribute("font-size", Math.max(8, element.height));
    node.textContent = element.text || "Texto";
  } else if (element.type === "image") {
    node = document.createElementNS(SVG_NS, "image");
    node.setAttribute("x", element.x);
    node.setAttribute("y", element.y);
    node.setAttribute("width", element.width);
    node.setAttribute("height", element.height);
    node.setAttribute("href", element.imageDataUrl);
    node.setAttribute("preserveAspectRatio", "xMidYMid meet");
  } else {
    node = document.createElementNS(SVG_NS, "path");
    const points = Array.isArray(element.points) ? element.points : [];
    node.setAttribute("d", points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "));
    node.setAttribute("transform", `translate(${element.x || 0} ${element.y || 0})`);
    node.setAttribute("fill", "none");
    node.setAttribute("stroke", element.id === selectedId ? "var(--accent)" : element.fill);
    node.setAttribute("stroke-width", element.strokeWidth || 8);
  }
  node.dataset.id = element.id;
  if (!["path", "line"].includes(element.type)) {
    node.setAttribute("fill", element.fill);
    node.setAttribute("stroke", element.id === selectedId ? "var(--accent)" : "none");
  }
  node.classList.toggle("selected", element.id === selectedId);
  node.addEventListener("pointerdown", startDrag);
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    selectedId = element.id;
    render();
  });
  return node;
}

function render() {
  canvas.replaceChildren();
  canvas.setAttribute("viewBox", `0 0 ${project.width} ${project.height}`);
  canvas.style.width = `${project.width * zoom / 100}px`;
  canvas.style.height = `${project.height * zoom / 100}px`;
  canvas.style.background = project.background;
  for (const element of project.elements) canvas.appendChild(svgElement(element));
  layersNode.innerHTML = "";
  [...project.elements].reverse().forEach((element) => {
    const button = document.createElement("button");
    button.className = `layer ${element.id === selectedId ? "active" : ""}`;
    const color = document.createElement("i");
    color.style.background = element.fill;
    const label = document.createElement("span");
    label.textContent = element.name;
    button.append(color, label);
    button.onclick = () => { selectedId = element.id; render(); };
    layersNode.appendChild(button);
  });
  document.querySelector("[data-layer-count]").textContent = String(project.elements.length);
  document.querySelector("[data-doc='width']").value = project.width;
  document.querySelector("[data-doc='height']").value = project.height;
  document.querySelector("[data-doc='background']").value = project.background;
  document.querySelector("[data-document-info]").textContent = `${project.width} × ${project.height} · ${project.elements.length} capas`;
  const element = selected();
  inspector.hidden = !element;
  emptySelection.hidden = Boolean(element);
  if (element) {
    for (const field of document.querySelectorAll("[data-element]")) {
      field.value = element[field.dataset.element] ?? "";
    }
    document.querySelector("[data-text-field]").hidden = element.type !== "text";
    document.querySelector("[data-stroke-field]").hidden = !["path", "line"].includes(element.type);
  }
}

function addElement(type) {
  checkpoint();
  const count = project.elements.filter((element) => element.type === type).length + 1;
  const base = {
    id: uid(),
    type,
    name: `${type === "rectangle" ? "Rectángulo" : type === "ellipse" ? "Elipse" : type === "image" ? "Imagen" : "Texto"} ${count}`,
    x: 100 + count * 18,
    y: 100 + count * 18,
    width: type === "text" ? 260 : 220,
    height: type === "text" ? 42 : 150,
    fill: type === "text" ? "#111318" : type === "ellipse" ? "#5c8ee6" : "#252a30",
    strokeWidth: 8,
    text: type === "text" ? "DORN Design" : ""
  };
  project.elements.push(base);
  selectedId = base.id;
  render();
}

let drag = null;
function startDrag(event) {
  const element = project.elements.find((item) => item.id === event.currentTarget.dataset.id);
  if (!element) return;
  selectedId = element.id;
  checkpoint();
  drag = { element, startX: event.clientX, startY: event.clientY, x: element.x, y: element.y };
  event.currentTarget.setPointerCapture(event.pointerId);
}
canvas.addEventListener("pointermove", (event) => {
  if (drawing) {
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: Math.round((event.clientX - rect.left) * project.width / rect.width),
      y: Math.round((event.clientY - rect.top) * project.height / rect.height)
    };
    if (drawing.type === "line") drawing.points[1] = point;
    else {
      const previous = drawing.points.at(-1);
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 3) drawing.points.push(point);
    }
    render();
    return;
  }
  if (!drag) return;
  drag.element.x = Math.round(drag.x + (event.clientX - drag.startX) * 100 / zoom);
  drag.element.y = Math.round(drag.y + (event.clientY - drag.startY) * 100 / zoom);
  render();
});
canvas.addEventListener("pointerdown", (event) => {
  if (!["brush", "line"].includes(activeTool) || event.target !== canvas) return;
  checkpoint();
  const rect = canvas.getBoundingClientRect();
  const point = {
    x: Math.round((event.clientX - rect.left) * project.width / rect.width),
    y: Math.round((event.clientY - rect.top) * project.height / rect.height)
  };
  drawing = {
    id: uid(),
    type: activeTool === "line" ? "line" : "path",
    name: activeTool === "line" ? "Línea" : "Trazo",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fill: "#20252a",
    strokeWidth: activeTool === "line" ? 5 : 10,
    points: [point, point]
  };
  project.elements.push(drawing);
  selectedId = drawing.id;
  canvas.setPointerCapture(event.pointerId);
  render();
});
canvas.addEventListener("pointerup", () => {
  drag = null;
  if (drawing) {
    drawing = null;
    activeTool = "select";
    document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === activeTool));
    render();
  }
});
canvas.addEventListener("click", (event) => {
  if (event.target !== canvas || activeTool !== "select") return;
  selectedId = null;
  render();
});

document.querySelectorAll("[data-add]").forEach((button) => button.onclick = () => addElement(button.dataset.add));
document.querySelectorAll("[data-tool]").forEach((button) => button.onclick = () => {
  activeTool = button.dataset.tool;
  drawing = null;
  document.querySelectorAll("[data-tool]").forEach((entry) => entry.classList.toggle("active", entry === button));
  setStatus(activeTool === "select" ? "Selecciona y mueve elementos" : activeTool === "brush" ? "Dibuja un trazo sobre el lienzo" : "Arrastra para crear una línea");
});
document.querySelectorAll("[data-doc]").forEach((input) => input.onchange = () => {
  checkpoint();
  const key = input.dataset.doc;
  project[key] = key === "background" ? input.value : Math.max(64, Math.min(8192, Number(input.value) || project[key]));
  render();
});
document.querySelectorAll("[data-element]").forEach((input) => input.onchange = () => {
  const element = selected();
  if (!element) return;
  checkpoint();
  const key = input.dataset.element;
  element[key] = ["x", "y", "width", "height"].includes(key) ? Number(input.value) || 0 : input.value;
  render();
});
document.querySelector("[data-zoom]").oninput = (event) => { zoom = Number(event.target.value); render(); };

const imageInput = document.querySelector("[data-image-file]");
document.querySelector("[data-action='import-image']").onclick = () => imageInput.click();
imageInput.onchange = async () => {
  const file = imageInput.files?.[0];
  imageInput.value = "";
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
    setStatus("La imagen debe ser PNG, JPG o WebP y pesar menos de 8 MB.");
    return;
  }
  const imageDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  checkpoint();
  const element = {
    id: uid(),
    type: "image",
    name: file.name,
    x: 120,
    y: 120,
    width: Math.min(520, project.width - 240),
    height: Math.min(360, project.height - 240),
    fill: "#ffffff",
    imageDataUrl
  };
  project.elements.push(element);
  selectedId = element.id;
  render();
  setStatus(`Imagen añadida · ${file.name}`);
};

document.querySelectorAll("[data-window]").forEach((button) => button.onclick = () => window.dornProduct.windowAction(button.dataset.window));
document.querySelector("[data-action='new']").onclick = () => {
  if (!confirm("¿Crear un documento nuevo? Los cambios no guardados se perderán.")) return;
  project = createProject(); filePath = null; selectedId = null; history = []; future = []; render(); setStatus("Documento nuevo");
};
document.querySelector("[data-action='open']").onclick = async () => {
  try {
    const opened = await window.dornProduct.openFile();
    if (!opened) return;
    const parsed = JSON.parse(opened.content);
    if (parsed.schema !== "dorn-design/1" || !Array.isArray(parsed.elements) || parsed.elements.length > 5000) throw new Error("No es un proyecto DORN Design válido.");
    project = parsed; filePath = opened.path; selectedId = null; history = []; future = []; render(); setStatus(`Abierto · ${opened.name}`);
  } catch (error) { setStatus(error.message || String(error)); }
};
async function save(saveAs = false) {
  const saved = await window.dornProduct.saveFile({ path: filePath, saveAs, suggestedName: "dorn-design.json", content: JSON.stringify(project, null, 2) });
  if (saved) { filePath = saved.path; setStatus(`Guardado · ${saved.name}`); }
}
document.querySelector("[data-action='save']").onclick = () => void save(false);
document.querySelector("[data-action='export-svg']").onclick = async () => {
  const output = canvas.cloneNode(true);
  output.querySelectorAll(".selected").forEach((node) => node.classList.remove("selected"));
  output.setAttribute("width", project.width);
  output.setAttribute("height", project.height);
  const content = new XMLSerializer().serializeToString(output);
  const saved = await window.dornProduct.saveFile({ saveAs: true, suggestedName: "dorn-design.svg", content });
  if (saved) setStatus(`SVG exportado · ${saved.name}`);
};
async function createPngDataUrl() {
  const output = canvas.cloneNode(true);
  output.querySelectorAll(".selected").forEach((node) => node.classList.remove("selected"));
  output.setAttribute("width", project.width);
  output.setAttribute("height", project.height);
  const svg = new Blob([new XMLSerializer().serializeToString(output)], { type: "image/svg+xml" });
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
    const bitmap = document.createElement("canvas");
    bitmap.width = project.width; bitmap.height = project.height;
    const context = bitmap.getContext("2d");
    context.fillStyle = project.background; context.fillRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(image.src);
      resolve(bitmap.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(image.src);
      reject(new Error("No se pudo rasterizar el diseño."));
    };
    image.src = URL.createObjectURL(svg);
  });
}
document.querySelector("[data-action='export-png']").onclick = async () => {
  try {
    const dataUrl = await createPngDataUrl();
    const base64 = dataUrl.split(",")[1];
    const saved = await window.dornProduct.saveFile({ saveAs: true, suggestedName: "dorn-design.png", encoding: "base64", content: base64 });
    if (saved) setStatus(`PNG exportado · ${saved.name}`);
  } catch (error) {
    setStatus(error.message || String(error));
  }
};
document.querySelector("[data-action='delete']").onclick = () => {
  if (!selected()) return;
  checkpoint(); project.elements = project.elements.filter((element) => element.id !== selectedId); selectedId = null; render();
};
document.querySelector("[data-action='duplicate']").onclick = () => {
  const element = selected(); if (!element) return;
  checkpoint(); const copy = { ...clone(element), id: uid(), name: `${element.name} copia`, x: element.x + 24, y: element.y + 24 };
  project.elements.push(copy); selectedId = copy.id; render();
};
document.querySelector("[data-action='undo']").onclick = () => {
  if (!history.length) return; future.push(clone(project)); project = history.pop(); selectedId = null; render();
};
document.querySelector("[data-action='redo']").onclick = () => {
  if (!future.length) return; history.push(clone(project)); project = future.pop(); selectedId = null; render();
};
document.querySelector("[data-action='ai']").onclick = async () => {
  try {
    const imageDataUrl = await createPngDataUrl();
    await window.dornProduct.sendToDorn({
      content: `Analiza esta vista previa de “${project.name}” creada en DORN Design. Describe la composición, detecta problemas visuales y propón mejoras concretas. No afirmes haber modificado el archivo.`,
      imageDataUrl,
      attachmentName: `${project.name.replace(/[^a-z0-9_-]+/gi, "-") || "dorn-design"}.png`
    });
    setStatus("Vista previa enviada a DORN AI como imagen.");
  } catch (error) {
    setStatus(error.message || String(error));
  }
};

render();
