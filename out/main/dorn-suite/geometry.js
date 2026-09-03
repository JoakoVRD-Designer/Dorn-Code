"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DornSuiteError, safeRelativeRoot, now } = require("./common");

const FORMAT_CAPABILITIES = {
  ".obj": { family: "mesh", read: true, inspect: true, preview: true, edit: "operations", convert: "blender-or-assimp" },
  ".stl": { family: "printing", read: true, inspect: true, preview: true, edit: "operations", convert: "blender-or-assimp" },
  ".ply": { family: "mesh", read: true, inspect: true, preview: true, edit: "operations", convert: "blender-or-assimp" },
  ".gltf": { family: "scene", read: true, inspect: true, preview: true, edit: "metadata", convert: "three-or-blender" },
  ".glb": { family: "scene", read: true, inspect: true, preview: true, edit: "metadata", convert: "three-or-blender" },
  ".fbx": { family: "scene", read: false, inspect: false, preview: false, edit: false, plugin: "assimp-or-blender" },
  ".3mf": { family: "printing", read: false, inspect: false, preview: false, edit: false, plugin: "3mf-importer" },
  ".step": { family: "cad", read: false, inspect: false, preview: false, edit: false, plugin: "opencascade-or-freecad" },
  ".stp": { family: "cad", read: false, inspect: false, preview: false, edit: false, plugin: "opencascade-or-freecad" },
  ".iges": { family: "cad", read: false, inspect: false, preview: false, edit: false, plugin: "opencascade-or-freecad" },
  ".igs": { family: "cad", read: false, inspect: false, preview: false, edit: false, plugin: "opencascade-or-freecad" },
  ".dxf": { family: "drawing", read: false, inspect: false, preview: false, edit: false, plugin: "dxf-importer" }
};

function emptyBounds() {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
}

function addPoint(bounds, point) {
  for (let index = 0; index < 3; index += 1) {
    bounds.min[index] = Math.min(bounds.min[index], Number(point[index]));
    bounds.max[index] = Math.max(bounds.max[index], Number(point[index]));
  }
}

function finishBounds(bounds) {
  if (!Number.isFinite(bounds.min[0])) return null;
  return {
    min: bounds.min,
    max: bounds.max,
    dimensions: bounds.max.map((value, index) => value - bounds.min[index]),
    center: bounds.max.map((value, index) => (value + bounds.min[index]) / 2)
  };
}

function triangleArea(a, b, c) {
  const ab = b.map((value, index) => value - a[index]);
  const ac = c.map((value, index) => value - a[index]);
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  return 0.5 * Math.hypot(...cross);
}

function inspectObj(buffer) {
  const text = buffer.toString("utf8");
  const bounds = emptyBounds();
  let vertices = 0;
  let faces = 0;
  let triangles = 0;
  let objects = 0;
  const materials = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      const point = trimmed.split(/\s+/).slice(1, 4).map(Number);
      if (point.every(Number.isFinite)) {
        addPoint(bounds, point);
        vertices += 1;
      }
    } else if (trimmed.startsWith("f ")) {
      const count = trimmed.split(/\s+/).length - 1;
      faces += 1;
      triangles += Math.max(0, count - 2);
    } else if (trimmed.startsWith("o ") || trimmed.startsWith("g ")) objects += 1;
    else if (trimmed.startsWith("usemtl ")) materials.add(trimmed.slice(7).trim());
  }
  return {
    scene: { objects: Math.max(1, objects), meshes: Math.max(1, objects), materials: materials.size, textures: 0 },
    geometry: { vertices, faces, triangles },
    measurements: { units: "unknown", boundingBox: finishBounds(bounds) },
    warnings: vertices ? [] : ["El archivo OBJ no contiene vértices válidos."]
  };
}

function inspectStl(buffer) {
  const bounds = emptyBounds();
  let triangles = 0;
  let surfaceArea = 0;
  const declared = buffer.length >= 84 ? buffer.readUInt32LE(80) : 0;
  const binary = buffer.length >= 84 && 84 + declared * 50 <= buffer.length;
  if (binary) {
    triangles = declared;
    for (let index = 0; index < triangles; index += 1) {
      const offset = 84 + index * 50 + 12;
      const points = [];
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const pointOffset = offset + vertex * 12;
        const point = [
          buffer.readFloatLE(pointOffset),
          buffer.readFloatLE(pointOffset + 4),
          buffer.readFloatLE(pointOffset + 8)
        ];
        points.push(point);
        addPoint(bounds, point);
      }
      surfaceArea += triangleArea(...points);
    }
  } else {
    const points = [];
    for (const match of buffer.toString("utf8").matchAll(/vertex\s+([+\-.\deE]+)\s+([+\-.\deE]+)\s+([+\-.\deE]+)/g)) {
      const point = [Number(match[1]), Number(match[2]), Number(match[3])];
      if (point.every(Number.isFinite)) {
        points.push(point);
        addPoint(bounds, point);
        if (points.length % 3 === 0) surfaceArea += triangleArea(...points.slice(-3));
      }
    }
    triangles = Math.floor(points.length / 3);
  }
  return {
    scene: { objects: triangles ? 1 : 0, meshes: triangles ? 1 : 0, materials: 0, textures: 0 },
    geometry: { vertices: triangles * 3, faces: triangles, triangles },
    measurements: { units: "unknown", boundingBox: finishBounds(bounds), surfaceArea },
    warnings: triangles ? [] : ["No se detectaron triángulos válidos en el STL."]
  };
}

function inspectPly(buffer) {
  const text = buffer.toString("utf8");
  const marker = text.indexOf("end_header");
  if (marker < 0 || !text.startsWith("ply")) {
    throw new DornSuiteError("DORN-3D-001", "studio3d", "El archivo PLY no tiene una cabecera válida.");
  }
  const header = text.slice(0, marker);
  if (!/format\s+ascii\s+1\.0/.test(header)) {
    throw new DornSuiteError("DORN-3D-002", "studio3d", "El PLY binario requiere el importador Assimp.", {
      actions: ["Instala el paquete de importación Assimp.", "Convierte una copia a PLY ASCII."]
    });
  }
  const vertexCount = Number(header.match(/element\s+vertex\s+(\d+)/)?.[1] || 0);
  const faceCount = Number(header.match(/element\s+face\s+(\d+)/)?.[1] || 0);
  const data = text.slice(marker + "end_header".length).trim().split(/\r?\n/);
  const bounds = emptyBounds();
  for (const line of data.slice(0, vertexCount)) {
    const point = line.trim().split(/\s+/).slice(0, 3).map(Number);
    if (point.every(Number.isFinite)) addPoint(bounds, point);
  }
  let triangles = 0;
  for (const line of data.slice(vertexCount, vertexCount + faceCount)) {
    const count = Number(line.trim().split(/\s+/)[0]);
    triangles += Math.max(0, count - 2);
  }
  return {
    scene: { objects: vertexCount ? 1 : 0, meshes: vertexCount ? 1 : 0, materials: 0, textures: 0 },
    geometry: { vertices: vertexCount, faces: faceCount, triangles },
    measurements: { units: "unknown", boundingBox: finishBounds(bounds) },
    warnings: []
  };
}

function inspectGltfJson(data) {
  const accessors = Array.isArray(data.accessors) ? data.accessors : [];
  let triangles = 0;
  const bounds = emptyBounds();
  for (const mesh of Array.isArray(data.meshes) ? data.meshes : []) {
    for (const primitive of Array.isArray(mesh.primitives) ? mesh.primitives : []) {
      const count = primitive.indices !== undefined
        ? Number(accessors[primitive.indices]?.count || 0)
        : Number(accessors[primitive.attributes?.POSITION]?.count || 0);
      if (primitive.mode === undefined || primitive.mode === 4) triangles += Math.floor(count / 3);
      const position = accessors[primitive.attributes?.POSITION];
      if (Array.isArray(position?.min) && Array.isArray(position?.max)) {
        addPoint(bounds, position.min);
        addPoint(bounds, position.max);
      }
    }
  }
  return {
    scene: {
      objects: Array.isArray(data.nodes) ? data.nodes.length : 0,
      meshes: Array.isArray(data.meshes) ? data.meshes.length : 0,
      materials: Array.isArray(data.materials) ? data.materials.length : 0,
      textures: Array.isArray(data.textures) ? data.textures.length : 0,
      animations: Array.isArray(data.animations) ? data.animations.length : 0
    },
    geometry: {
      vertices: accessors.filter((entry) => entry.type === "VEC3").reduce((sum, entry) => sum + Number(entry.count || 0), 0),
      triangles
    },
    measurements: { units: "meters-by-convention", boundingBox: finishBounds(bounds) },
    warnings: []
  };
}

function inspectGlb(buffer) {
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF") {
    throw new DornSuiteError("DORN-3D-003", "studio3d", "La cabecera GLB no es válida.");
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength > buffer.length) throw new DornSuiteError("DORN-3D-004", "studio3d", "El GLB está incompleto.");
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.toString("ascii", 16, 20);
  if (jsonType !== "JSON") throw new DornSuiteError("DORN-3D-005", "studio3d", "El GLB no contiene el bloque JSON inicial.");
  const data = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).replace(/\0+$/g, "").trim());
  return { ...inspectGltfJson(data), metadata: { glbVersion: version } };
}

function geometryRecommendations(report) {
  const recommendations = [];
  const triangles = Number(report.geometry?.triangles || 0);
  const bounds = report.measurements?.boundingBox;
  const dimensions = bounds?.dimensions || [];
  if (!report.geometry?.vertices) {
    recommendations.push({
      id: "verify-empty-geometry",
      severity: "error",
      title: "Verificar geometría vacía",
      reason: "El inspector no encontró vértices utilizables.",
      operation: "inspect-source",
      requiresApproval: false,
      availableInCore: true
    });
  }
  if (triangles > 1000000) {
    recommendations.push({
      id: "create-lod",
      severity: "warning",
      title: "Crear una copia optimizada",
      reason: `${triangles.toLocaleString("es-CL")} triángulos pueden afectar la interacción en equipos limitados.`,
      operation: "decimate",
      targetRatio: triangles > 5000000 ? 0.2 : 0.5,
      requiresApproval: true,
      availableInCore: false,
      requiredCapability: "convert-format"
    });
  }
  if (report.measurements?.units === "unknown") {
    recommendations.push({
      id: "confirm-units",
      severity: "info",
      title: "Confirmar unidades",
      reason: "El formato no declara una unidad física confiable.",
      operation: "set-units",
      requiresApproval: true,
      availableInCore: false
    });
  }
  if (dimensions.some((value) => value === 0)) {
    recommendations.push({
      id: "inspect-flat-axis",
      severity: "warning",
      title: "Revisar eje sin volumen",
      reason: `La caja envolvente mide ${dimensions.join(" × ")}; al menos un eje tiene espesor cero.`,
      operation: "inspect-flat-axis",
      requiresApproval: false,
      availableInCore: true
    });
  }
  if (bounds && bounds.center.some((value) => Math.abs(value) > 1e-9)) {
    recommendations.push({
      id: "center-copy",
      severity: "info",
      title: "Crear una copia centrada",
      reason: `El centro geométrico está en ${bounds.center.map((value) => Number(value.toFixed(4))).join(", ")}.`,
      operation: "center-origin",
      requiresApproval: true,
      availableInCore: report.file?.format === "OBJ"
    });
  }
  if (!report.scene?.materials) {
    recommendations.push({
      id: "review-materials",
      severity: "info",
      title: "Revisar materiales",
      reason: "No se detectaron materiales asignados.",
      operation: "inspect-materials",
      requiresApproval: false,
      availableInCore: true
    });
  }
  return recommendations;
}

function transformObjText(text, operation = {}) {
  const lines = String(text).split(/\r?\n/);
  const points = [];
  for (const line of lines) {
    const match = line.match(/^(\s*v\s+)([+\-.\deE]+)\s+([+\-.\deE]+)\s+([+\-.\deE]+)(.*)$/);
    if (!match) continue;
    const point = [Number(match[2]), Number(match[3]), Number(match[4])];
    if (point.every(Number.isFinite)) points.push(point);
  }
  if (!points.length) {
    throw new DornSuiteError("DORN-3D-012", "studio3d", "El OBJ no contiene vértices que se puedan transformar.");
  }
  const bounds = emptyBounds();
  for (const point of points) addPoint(bounds, point);
  const measured = finishBounds(bounds);
  const scale = Number(operation.scale ?? 1);
  const translation = Array.isArray(operation.translation)
    ? operation.translation.map(Number)
    : [0, 0, 0];
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100000) {
    throw new DornSuiteError("DORN-3D-013", "studio3d", "El factor de escala no es válido.");
  }
  if (translation.length !== 3 || !translation.every(Number.isFinite)) {
    throw new DornSuiteError("DORN-3D-014", "studio3d", "La traslación debe tener tres valores numéricos.");
  }
  const centerOffset = operation.center ? measured.center.map((value) => -value) : [0, 0, 0];
  const output = lines.map((line) => {
    const match = line.match(/^(\s*v\s+)([+\-.\deE]+)\s+([+\-.\deE]+)\s+([+\-.\deE]+)(.*)$/);
    if (!match) return line;
    const point = [Number(match[2]), Number(match[3]), Number(match[4])];
    if (!point.every(Number.isFinite)) return line;
    const transformed = point.map((value, index) => (value + centerOffset[index]) * scale + translation[index]);
    return `${match[1]}${transformed.map((value) => Number(value.toFixed(9))).join(" ")}${match[5] || ""}`;
  });
  const transformedBounds = emptyBounds();
  for (const point of points) {
    addPoint(
      transformedBounds,
      point.map((value, index) => (value + centerOffset[index]) * scale + translation[index])
    );
  }
  return {
    content: output.join("\n"),
    operation: {
      center: Boolean(operation.center),
      scale,
      translation
    },
    before: measured,
    after: finishBounds(transformedBounds),
    verticesChanged: points.length
  };
}

function boxObj(name, origin, size, startIndex) {
  const [x, y, z] = origin;
  const [w, d, h] = size;
  const vertices = [
    [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
    [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]
  ];
  const faces = [
    [1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2],
    [2, 6, 7, 3], [3, 7, 8, 4], [5, 1, 4, 8]
  ].map((face) => face.map((value) => value + startIndex));
  return [
    `o ${name}`,
    ...vertices.map((point) => `v ${point.join(" ")}`),
    ...faces.map((face) => `f ${face.join(" ")}`)
  ].join("\n");
}

class GeometryEngine {
  constructor(options = {}) {
    this.audit = options.audit || (() => {});
  }

  formats() {
    return structuredClone(FORMAT_CAPABILITIES);
  }

  inspect(projectRoot, relativePath) {
    const { root, target } = safeRelativeRoot(projectRoot, relativePath);
    const canonicalTarget = fs.realpathSync(target);
    if (canonicalTarget !== root && !canonicalTarget.startsWith(`${root}${path.sep}`)) {
      throw new DornSuiteError("DORN-3D-011", "studio3d", "El modelo está enlazado fuera del proyecto autorizado.");
    }
    const stat = fs.statSync(canonicalTarget);
    if (!stat.isFile()) throw new DornSuiteError("DORN-3D-006", "studio3d", "La ruta no corresponde a un archivo.");
    if (stat.size > 256 * 1024 * 1024) {
      throw new DornSuiteError("DORN-3D-007", "studio3d", "El modelo supera el límite del inspector integrado.", {
        actions: ["Instala el importador avanzado.", "Crea una copia optimizada."]
      });
    }
    const extension = path.extname(canonicalTarget).toLowerCase();
    const capability = FORMAT_CAPABILITIES[extension];
    if (!capability) throw new DornSuiteError("DORN-3D-008", "studio3d", `Formato 3D no reconocido: ${extension || "sin extensión"}.`);
    if (!capability.inspect) {
      throw new DornSuiteError("DORN-3D-009", "studio3d", `El formato ${extension} requiere ${capability.plugin}.`, {
        actions: ["Abre Componentes DORN para instalar el motor requerido.", "Convierte una copia a GLB, OBJ o STL."]
      });
    }
    const buffer = fs.readFileSync(canonicalTarget);
    let report;
    if (extension === ".obj") report = inspectObj(buffer);
    else if (extension === ".stl") report = inspectStl(buffer);
    else if (extension === ".ply") report = inspectPly(buffer);
    else if (extension === ".gltf") report = inspectGltfJson(JSON.parse(buffer.toString("utf8")));
    else report = inspectGlb(buffer);
    const result = {
      reportId: crypto.randomUUID(),
      file: {
        name: path.basename(canonicalTarget),
        format: extension.slice(1).toUpperCase(),
        sizeBytes: stat.size,
        relativePath
      },
      capability,
      ...report,
      generatedAt: now()
    };
    this.audit(null, "studio3d.inspected", {
      file: relativePath,
      format: result.file.format,
      triangles: result.geometry.triangles || 0
    });
    return result;
  }

  recommend(projectRoot, relativePath) {
    const report = this.inspect(projectRoot, relativePath);
    return {
      report,
      recommendations: geometryRecommendations(report),
      generatedAt: now()
    };
  }

  prepareObjEdit(projectRoot, relativePath, operation = {}) {
    const { root, target } = safeRelativeRoot(projectRoot, relativePath);
    const canonicalTarget = fs.realpathSync(target);
    if (canonicalTarget !== root && !canonicalTarget.startsWith(`${root}${path.sep}`)) {
      throw new DornSuiteError("DORN-3D-015", "studio3d", "El modelo está enlazado fuera del proyecto.");
    }
    if (path.extname(canonicalTarget).toLowerCase() !== ".obj") {
      throw new DornSuiteError("DORN-3D-016", "studio3d", "La edición integrada inicial admite OBJ. Usa un adaptador para este formato.", {
        actions: ["Convierte una copia a OBJ.", "Instala un conector DORN Bridge autorizado."]
      });
    }
    const stat = fs.statSync(canonicalTarget);
    if (stat.size > 256 * 1024 * 1024) {
      throw new DornSuiteError("DORN-3D-017", "studio3d", "El OBJ supera 256 MB y requiere un motor externo.");
    }
    const sourceBuffer = fs.readFileSync(canonicalTarget);
    const transformed = transformObjText(sourceBuffer.toString("utf8"), operation);
    this.audit(null, "studio3d.edit-prepared", {
      file: relativePath,
      operation: transformed.operation,
      verticesChanged: transformed.verticesChanged
    });
    return {
      ...transformed,
      source: {
        relativePath,
        sha256: crypto.createHash("sha256").update(sourceBuffer).digest("hex")
      }
    };
  }

  createIndustrialTable(parameters = {}) {
    const width = Number(parameters.width || 1200);
    const depth = Number(parameters.depth || 700);
    const height = Number(parameters.height || 900);
    const profile = Number(parameters.profile || 50);
    const profileThickness = Number(parameters.profileThickness || 3);
    const topThickness = Number(parameters.topThickness || 30);
    for (const [name, value] of Object.entries({ width, depth, height, profile, profileThickness, topThickness })) {
      if (!Number.isFinite(value) || value <= 0 || value > 100000) {
        throw new DornSuiteError("DORN-3D-010", "studio3d", `Parámetro no válido: ${name}.`);
      }
    }
    const parts = [
      { name: "tablero", origin: [0, 0, height - topThickness], size: [width, depth, topThickness], material: "superficie" },
      { name: "pata_frontal_izquierda", origin: [0, 0, 0], size: [profile, profile, height - topThickness], material: "acero" },
      { name: "pata_frontal_derecha", origin: [width - profile, 0, 0], size: [profile, profile, height - topThickness], material: "acero" },
      { name: "pata_trasera_izquierda", origin: [0, depth - profile, 0], size: [profile, profile, height - topThickness], material: "acero" },
      { name: "pata_trasera_derecha", origin: [width - profile, depth - profile, 0], size: [profile, profile, height - topThickness], material: "acero" }
    ];
    const blocks = parts.map((part, index) => boxObj(part.name, part.origin, part.size, index * 8));
    return {
      type: "industrial_table",
      units: "mm",
      dimensions: { width, depth, height },
      material: String(parameters.material || "steel"),
      profile: `${profile}x${profile}x${profileThickness}`,
      parts,
      billOfMaterials: [
        { item: "Patas de perfil", quantity: 4, lengthMm: height - topThickness, profile: `${profile}x${profile}x${profileThickness}` },
        { item: "Superficie", quantity: 1, dimensionsMm: [width, depth, topThickness] }
      ],
      objContent: [
        "# DORN Studio 3D · modelo paramétrico",
        "# Unidades: milímetros",
        ...blocks
      ].join("\n\n"),
      warnings: [
        "La geometría representa dimensiones y piezas, no valida cargas ni uniones.",
        "La fabricación requiere material, soldadura, tolerancias y revisión profesional."
      ]
    };
  }
}

module.exports = {
  FORMAT_CAPABILITIES,
  GeometryEngine,
  geometryRecommendations,
  transformObjText
};
