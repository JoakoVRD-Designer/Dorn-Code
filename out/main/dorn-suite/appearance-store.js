"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const THEMES = new Set([
  "graphite", "titanium", "midnight", "amber", "emerald", "violet", "crimson",
  "arctic", "cobalt", "ocean", "cyan", "teal", "forest", "lime", "copper",
  "bronze", "rose", "magenta", "indigo", "sand", "custom"
]);
const PRESET_PALETTES = Object.freeze({
  graphite: { accent: "#c8d0d8", background: "#08090a", panel: "#111316", surface: "#181b1f", text: "#f4f6f8", muted: "#9ba3ac" },
  titanium: { accent: "#e1e6ea", background: "#111315", panel: "#1a1d20", surface: "#24282c", text: "#f5f6f7", muted: "#adb4ba" },
  midnight: { accent: "#73a7ff", background: "#050914", panel: "#090f1b", surface: "#101b2d", text: "#eef4ff", muted: "#91a2bd" },
  amber: { accent: "#f2a93b", background: "#0e0a05", panel: "#15110b", surface: "#231b10", text: "#fff6e7", muted: "#b8a589" },
  emerald: { accent: "#5ed5a0", background: "#050d09", panel: "#09140f", surface: "#10231a", text: "#effbf5", muted: "#8fafa0" },
  violet: { accent: "#b18cff", background: "#0a0711", panel: "#120d1d", surface: "#211632", text: "#f7f1ff", muted: "#ae9dbe" },
  crimson: { accent: "#ff6b73", background: "#100607", panel: "#190b0d", surface: "#2b1115", text: "#fff1f2", muted: "#bd9699" },
  arctic: { accent: "#b9e8ff", background: "#061014", panel: "#0a181e", surface: "#11262f", text: "#effbff", muted: "#91b2bf" },
  cobalt: { accent: "#4f7dff", background: "#050711", panel: "#090d1b", surface: "#111a33", text: "#eef2ff", muted: "#929dbd" },
  ocean: { accent: "#3aa8ff", background: "#040b11", panel: "#07131c", surface: "#0d2232", text: "#edf8ff", muted: "#87a8bd" },
  cyan: { accent: "#45e2e8", background: "#030d0f", panel: "#071719", surface: "#0d272a", text: "#ecffff", muted: "#86b5b7" },
  teal: { accent: "#36c9b0", background: "#040d0c", panel: "#081614", surface: "#0e2622", text: "#effdfa", muted: "#88aca6" },
  forest: { accent: "#79c76a", background: "#070d06", panel: "#0d160b", surface: "#172515", text: "#f3fbf0", muted: "#98ad92" },
  lime: { accent: "#b7db55", background: "#0a0d04", panel: "#121708", surface: "#20280f", text: "#faffeb", muted: "#aab38d" },
  copper: { accent: "#d98855", background: "#0e0805", panel: "#17100b", surface: "#281a12", text: "#fff5ed", muted: "#b49d8d" },
  bronze: { accent: "#caa85d", background: "#0d0a05", panel: "#17120a", surface: "#282013", text: "#fff8e9", muted: "#b2a58b" },
  rose: { accent: "#ff85ae", background: "#10060b", panel: "#190b11", surface: "#2b1320", text: "#fff1f6", muted: "#bd96a5" },
  magenta: { accent: "#ed6fff", background: "#0e0610", panel: "#170a1a", surface: "#28112d", text: "#fff0ff", muted: "#b69abc" },
  indigo: { accent: "#8c82ff", background: "#070611", panel: "#0e0c1b", surface: "#1a1730", text: "#f3f1ff", muted: "#9d99bb" },
  sand: { accent: "#e1c58a", background: "#0d0b07", panel: "#17130d", surface: "#272117", text: "#fff9ef", muted: "#b4aa98" }
});
const DEFAULT_APPEARANCE = Object.freeze({
  schema: "dorn-appearance/2",
  theme: "graphite",
  density: "comfortable",
  motion: "full",
  motionIntensity: "balanced",
  windowEffect: "default",
  contrast: "normal",
  backgroundMode: "color",
  backgroundImage: "",
  backgroundFileName: "",
  backgroundMime: "",
  backgroundOriginalName: "",
  backgroundFit: "cover",
  backgroundStrength: 35,
  backgroundBlur: 0,
  backgroundTint: 58,
  backgroundBlend: "normal",
  customPalette: PRESET_PALETTES.graphite
});
const MAX_BACKGROUND_BYTES = 48 * 1024 * 1024;
const BACKGROUND_FORMATS = Object.freeze({
  png: { extension: "png", mime: "image/png" },
  jpeg: { extension: "jpg", mime: "image/jpeg" },
  gif: { extension: "gif", mime: "image/gif" },
  webp: { extension: "webp", mime: "image/webp" },
  bmp: { extension: "bmp", mime: "image/bmp" },
  avif: { extension: "avif", mime: "image/avif" },
  ico: { extension: "ico", mime: "image/x-icon" }
});

function backgroundFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return BACKGROUND_FORMATS.png;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return BACKGROUND_FORMATS.jpeg;
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return BACKGROUND_FORMATS.gif;
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return BACKGROUND_FORMATS.webp;
  if (buffer.subarray(0, 2).toString("ascii") === "BM") return BACKGROUND_FORMATS.bmp;
  if (buffer.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return BACKGROUND_FORMATS.ico;
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp" && /^(?:avif|avis)$/.test(buffer.subarray(8, 12).toString("ascii"))) return BACKGROUND_FORMATS.avif;
  return null;
}

function normalizeBackgroundImage(value) {
  const image = String(value || "").trim();
  return /^dorn-background:\/\/current\/asset\?v=[a-f0-9]{12}$/i.test(image) ? image : "";
}

function numberInRange(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
}

function normalizeHex(value, fallback) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${[...text.slice(1)].map((part) => part.repeat(2)).join("")}`.toLowerCase();
  }
  return fallback;
}

function hexRgb(value) {
  const color = normalizeHex(value, "#000000");
  return [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
}

function mixHex(first, second, amount) {
  const a = hexRgb(first);
  const b = hexRgb(second);
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function safeCustomPalette(value = {}) {
  const requested = normalizePalette(value, PRESET_PALETTES.graphite);
  const accent = requested.accent;
  const base = "#08090a";
  const text = "#f4f6f8";
  return {
    accent,
    background: mixHex(base, accent, 0.055),
    panel: mixHex("#101214", accent, 0.08),
    surface: mixHex("#181b1f", accent, 0.12),
    text,
    muted: mixHex("#9ba3ac", accent, 0.08)
  };
}

function normalizePalette(value = {}, fallback = PRESET_PALETTES.graphite) {
  return {
    accent: normalizeHex(value.accent, fallback.accent),
    background: normalizeHex(value.background, fallback.background),
    panel: normalizeHex(value.panel, fallback.panel),
    surface: normalizeHex(value.surface, fallback.surface),
    text: normalizeHex(value.text, fallback.text),
    muted: normalizeHex(value.muted, fallback.muted)
  };
}

function normalizeAppearance(value = {}) {
  const theme = THEMES.has(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme;
  const backgroundImage = normalizeBackgroundImage(value.backgroundImage);
  const backgroundFileName = /^background\.(?:png|jpg|gif|webp|bmp|avif|ico)$/i.test(String(value.backgroundFileName || ""))
    ? String(value.backgroundFileName)
    : "";
  const hasBackground = Boolean(backgroundImage && backgroundFileName);
  return {
    schema: "dorn-appearance/2",
    theme,
    density: value.density === "compact" ? "compact" : "comfortable",
    motion: value.motion === "reduced" ? "reduced" : "full",
    motionIntensity: ["very-soft", "soft", "balanced", "dynamic", "aggressive"].includes(value.motionIntensity)
      ? value.motionIntensity
      : "balanced",
    windowEffect: ["default", "fade", "scale", "slide", "spring", "cinematic"].includes(value.windowEffect)
      ? value.windowEffect
      : "default",
    contrast: value.contrast === "high" ? "high" : "normal",
    backgroundMode: value.backgroundMode === "image" && hasBackground ? "image" : "color",
    backgroundImage: hasBackground ? backgroundImage : "",
    backgroundFileName: hasBackground ? backgroundFileName : "",
    backgroundMime: hasBackground && /^image\/[a-z0-9.+-]+$/i.test(String(value.backgroundMime || "")) ? String(value.backgroundMime) : "",
    backgroundOriginalName: hasBackground ? path.basename(String(value.backgroundOriginalName || "")).slice(0, 180) : "",
    backgroundFit: ["cover", "contain", "tile"].includes(value.backgroundFit) ? value.backgroundFit : "cover",
    backgroundStrength: numberInRange(value.backgroundStrength, 35, 10, 100),
    backgroundBlur: numberInRange(value.backgroundBlur, 0, 0, 24),
    backgroundTint: numberInRange(value.backgroundTint, 58, 0, 92),
    backgroundBlend: ["normal", "multiply", "overlay", "soft-light"].includes(value.backgroundBlend) ? value.backgroundBlend : "normal",
    customPalette: theme === "custom"
      ? safeCustomPalette(value.customPalette)
      : normalizePalette(value.customPalette, PRESET_PALETTES.graphite)
  };
}

class AppearanceStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, "dorn-appearance.json");
    this.assetDirectory = path.join(userDataPath, "appearance");
    this.state = this.read();
  }

  read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(String(raw.backgroundImage || ""))) return this.migrateLegacyBackground(raw);
      const appearance = normalizeAppearance(raw);
      if (appearance.backgroundFileName && !fs.existsSync(path.join(this.assetDirectory, appearance.backgroundFileName))) {
        return normalizeAppearance({ ...appearance, backgroundMode: "color", backgroundImage: "", backgroundFileName: "" });
      }
      return appearance;
    } catch {
      return normalizeAppearance(DEFAULT_APPEARANCE);
    }
  }

  migrateLegacyBackground(raw) {
    try {
      const buffer = Buffer.from(String(raw.backgroundImage).split(",", 2)[1] || "", "base64");
      const format = backgroundFormat(buffer);
      if (!format || buffer.length > MAX_BACKGROUND_BYTES) return normalizeAppearance(DEFAULT_APPEARANCE);
      return normalizeAppearance({ ...raw, ...this.writeBackgroundBuffer(buffer, format, "fondo-anterior"), backgroundMode: "image" });
    } catch {
      return normalizeAppearance(DEFAULT_APPEARANCE);
    }
  }

  writeBackgroundBuffer(buffer, format, originalName) {
    fs.mkdirSync(this.assetDirectory, { recursive: true });
    const fileName = "background." + format.extension;
    const destination = path.join(this.assetDirectory, fileName);
    const temporary = path.join(this.assetDirectory, "incoming-" + process.pid + "-" + Date.now() + "." + format.extension);
    fs.writeFileSync(temporary, buffer, { mode: 0o600 });
    fs.renameSync(temporary, destination);
    for (const name of fs.readdirSync(this.assetDirectory)) {
      if (/^background\.(?:png|jpg|gif|webp|bmp|avif|ico)$/i.test(name) && name !== fileName) {
        try { fs.unlinkSync(path.join(this.assetDirectory, name)); } catch { /* El archivo nuevo sigue siendo válido. */ }
      }
    }
    const digest = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    return {
      backgroundImage: "dorn-background://current/asset?v=" + digest,
      backgroundFileName: fileName,
      backgroundMime: format.mime,
      backgroundOriginalName: path.basename(String(originalName || fileName)).slice(0, 180)
    };
  }

  importBackground(sourcePath) {
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile() || stat.size < 12) throw new Error("El fondo seleccionado está vacío o no es un archivo.");
    if (stat.size > MAX_BACKGROUND_BYTES) throw new Error("El fondo supera el máximo seguro de 48 MB.");
    const buffer = fs.readFileSync(sourcePath);
    const format = backgroundFormat(buffer);
    if (!format) throw new Error("Formato no compatible. Usa PNG, JPG, GIF, WebP, AVIF, BMP o ICO.");
    return this.save({ ...this.state, ...this.writeBackgroundBuffer(buffer, format, path.basename(sourcePath)), backgroundMode: "image" });
  }

  removeBackground() {
    for (const name of ["background.png", "background.jpg", "background.gif", "background.webp", "background.bmp", "background.avif", "background.ico"]) {
      try { fs.unlinkSync(path.join(this.assetDirectory, name)); } catch { /* El fondo puede no existir. */ }
    }
    return this.save({ ...this.state, backgroundMode: "color", backgroundImage: "", backgroundFileName: "", backgroundMime: "", backgroundOriginalName: "" });
  }

  backgroundFile() {
    if (!this.state.backgroundFileName) return null;
    const filePath = path.join(this.assetDirectory, this.state.backgroundFileName);
    return fs.existsSync(filePath) ? filePath : null;
  }

  get() {
    return structuredClone(this.state);
  }

  save(value) {
    const normalized = normalizeAppearance(value);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    this.state = normalized;
    return this.get();
  }

  palette() {
    return this.state.theme === "custom"
      ? { ...this.state.customPalette }
      : { ...PRESET_PALETTES[this.state.theme] };
  }

  backgroundColor() {
    return this.palette().background;
  }
}

module.exports = {
  AppearanceStore,
  DEFAULT_APPEARANCE,
  PRESET_PALETTES,
  normalizeAppearance,
  MAX_BACKGROUND_BYTES
};
