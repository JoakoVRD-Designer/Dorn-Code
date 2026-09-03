import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/controls/OrbitControls.js";
import { OBJLoader } from "./vendor/loaders/OBJLoader.js";
import { STLLoader } from "./vendor/loaders/STLLoader.js";
import { PLYLoader } from "./vendor/loaders/PLYLoader.js";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

const viewport = document.getElementById("viewport");
const loading = document.getElementById("loading");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 1000000);
camera.position.set(4, 3, 6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xdde8f2, 0x25282b, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8eb7d8, 1.2);
rimLight.position.set(-5, 2, -6);
scene.add(rimLight);

let modelRoot = null;
let selectionBox = null;
let wireframe = false;
let grid = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function activePalette() {
  const appearance = window.dornAppearance?.read();
  return window.dornAppearance?.variablesFor(appearance).palette || {
    accent: "#c8d0d8",
    background: "#08090b",
    surface: "#181b1f"
  };
}

function rebuildGrid(palette) {
  const previous = grid;
  grid = new THREE.GridHelper(10, 20, new THREE.Color(palette.accent), new THREE.Color(palette.surface));
  grid.material.opacity = 0.5;
  grid.material.transparent = true;
  if (previous) {
    grid.visible = previous.visible;
    grid.scale.copy(previous.scale);
    grid.position.copy(previous.position);
    scene.remove(previous);
    previous.geometry.dispose();
    previous.material.dispose();
  }
  scene.add(grid);
}

function applyStudioAppearance(palette = activePalette()) {
  renderer.setClearColor(new THREE.Color(palette.background), 1);
  rimLight.color.set(palette.accent);
  if (selectionBox) selectionBox.material.color.set(palette.accent);
  rebuildGrid(palette);
}

applyStudioAppearance();
document.addEventListener("dorn:appearance-changed", (event) => applyStudioAppearance(event.detail.palette));

function bytesFrom(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value && Array.isArray(value.data)) return Uint8Array.from(value.data);
  throw new Error("DORN no recibió los bytes del modelo.");
}

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function parseGltf(loader, data, basePath = "") {
  return new Promise((resolve, reject) => loader.parse(data, basePath, resolve, reject));
}

async function gltfTextWithLocalResources(bytes) {
  const json = JSON.parse(new TextDecoder().decode(bytes));
  const urls = [];
  const rewrite = async (entry) => {
    if (!entry?.uri || /^(?:data:|blob:)/i.test(entry.uri)) return;
    const resource = bytesFrom(await window.dornStudio.readResource(entry.uri));
    const blobUrl = URL.createObjectURL(new Blob([resource]));
    urls.push(blobUrl);
    entry.uri = blobUrl;
  };
  await Promise.all([...(json.buffers || []), ...(json.images || [])].map(rewrite));
  return { text: JSON.stringify(json), urls };
}

async function loadModel(extension, bytes) {
  if (extension === "obj") return new OBJLoader().parse(new TextDecoder().decode(bytes));
  if (extension === "stl") {
    const geometry = new STLLoader().parse(arrayBufferOf(bytes));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: 0xaeb7bf,
      metalness: 0.18,
      roughness: 0.62
    }));
  }
  if (extension === "ply") {
    const geometry = new PLYLoader().parse(arrayBufferOf(bytes));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: geometry.hasAttribute("color") ? 0xffffff : 0xaeb7bf,
      vertexColors: geometry.hasAttribute("color"),
      metalness: 0.08,
      roughness: 0.72
    }));
  }
  if (extension === "glb") {
    const gltf = await parseGltf(new GLTFLoader(), arrayBufferOf(bytes));
    return gltf.scene;
  }
  if (extension === "gltf") {
    const prepared = await gltfTextWithLocalResources(bytes);
    try {
      const gltf = await parseGltf(new GLTFLoader(), prepared.text);
      return gltf.scene;
    } finally {
      for (const url of prepared.urls) URL.revokeObjectURL(url);
    }
  }
  throw new Error(`El visor todavía no puede abrir .${extension}.`);
}

function statsFor(root) {
  let objects = 0;
  let vertices = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!object.isMesh && !object.isPoints && !object.isLine) return;
    objects += 1;
    const geometry = object.geometry;
    const positions = geometry?.getAttribute("position");
    if (!positions) return;
    vertices += positions.count;
    triangles += geometry.index ? geometry.index.count / 3 : positions.count / 3;
  });
  return { objects, vertices, triangles: Math.floor(triangles) };
}

function fitView(root) {
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const maximum = Math.max(size.x, size.y, size.z, 0.001);
  const distance = maximum / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.35;
  camera.near = Math.max(distance / 10000, 0.0001);
  camera.far = Math.max(distance * 100, 1000);
  camera.updateProjectionMatrix();
  camera.position.set(distance * 0.85, distance * 0.65, distance);
  controls.target.set(0, 0, 0);
  controls.update();
  grid.scale.setScalar(Math.max(maximum / 10, 0.001));
  grid.position.y = -size.y / 2;
  return size;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function updateInspector(context, root, measuredSize) {
  const stats = statsFor(root);
  const report = context.inspection;
  const dimensions = measuredSize
    ? [measuredSize.x, measuredSize.y, measuredSize.z].map((value) => Number(value.toFixed(4)))
    : report.measurements?.boundingBox?.dimensions;
  setText("file-name", context.fileName);
  setText("model-title", context.fileName);
  setText("format", context.extension.toUpperCase());
  setText("objects", stats.objects.toLocaleString("es-CL"));
  setText("vertices", stats.vertices.toLocaleString("es-CL"));
  setText("triangles", stats.triangles.toLocaleString("es-CL"));
  setText("dimensions", dimensions ? dimensions.join(" × ") : "No disponibles");
  setText("file-size", formatBytes(context.sizeBytes));
  const warnings = document.getElementById("warnings");
  warnings.replaceChildren();
  const messages = report.warnings?.length ? report.warnings : ["Sin advertencias del inspector disponible."];
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    warnings.append(item);
  }
}

function setWireframe(enabled) {
  wireframe = enabled;
  modelRoot?.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material && "wireframe" in material) material.wireframe = enabled;
  });
  document.getElementById("toggle-wireframe").setAttribute("aria-pressed", String(enabled));
}

function selectAt(event) {
  if (!modelRoot) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = (event.clientX - bounds.left) / bounds.width * 2 - 1;
  pointer.y = -(event.clientY - bounds.top) / bounds.height * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(modelRoot, true).find((entry) => entry.object.isMesh);
  if (selectionBox) {
    scene.remove(selectionBox);
    selectionBox.geometry.dispose();
    selectionBox.material.dispose();
    selectionBox = null;
  }
  if (!hit) {
    setText("selection-name", "Ningún objeto");
    setText("selection-detail", "Haz clic en una pieza del modelo.");
    return;
  }
  selectionBox = new THREE.BoxHelper(hit.object, new THREE.Color(activePalette().accent));
  scene.add(selectionBox);
  const geometry = hit.object.geometry;
  const vertexCount = geometry?.getAttribute("position")?.count || 0;
  const triangleCount = geometry?.index ? geometry.index.count / 3 : vertexCount / 3;
  setText("selection-name", hit.object.name || "Objeto sin nombre");
  setText("selection-detail", `${vertexCount.toLocaleString("es-CL")} vértices · ${Math.floor(triangleCount).toLocaleString("es-CL")} triángulos`);
}

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

document.getElementById("fit-view").addEventListener("click", () => modelRoot && fitView(modelRoot));
document.getElementById("toggle-wireframe").addEventListener("click", () => setWireframe(!wireframe));
document.getElementById("toggle-grid").addEventListener("click", (event) => {
  grid.visible = !grid.visible;
  event.currentTarget.setAttribute("aria-pressed", String(grid.visible));
});
document.getElementById("copy-report").addEventListener("click", async () => {
  const result = await window.dornStudio.copyReport();
  setText("status", result ? "Informe copiado" : "No se pudo copiar");
});
renderer.domElement.addEventListener("pointerup", selectAt);
new ResizeObserver(resize).observe(viewport);

async function start() {
  try {
    const context = await window.dornStudio.context();
    const bytes = bytesFrom(await window.dornStudio.readFile());
    modelRoot = await loadModel(context.extension, bytes);
    scene.add(modelRoot);
    const measuredSize = fitView(modelRoot);
    updateInspector(context, modelRoot, measuredSize);
    loading.remove();
    setText("status", `${context.inspection.file.format} · ${context.inspection.geometry.triangles || 0} triángulos inspeccionados`);
  } catch (error) {
    loading.classList.add("error");
    loading.textContent = `No se pudo abrir el modelo.\n${error.message || String(error)}`;
  }
}

function animate() {
  controls.update();
  if (selectionBox) selectionBox.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

resize();
animate();
void start();
