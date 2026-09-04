(() => {
  "use strict";

  if (window.dornAppearance) return;

  const APPEARANCE_KEY = "dorn:appearance:v1";
  const PALETTES = Object.freeze({
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
    customPalette: PALETTES.graphite
  });
  let initialized = false;
  let unsubscribe = null;

  function bridge() {
    return window.dorn?.appearance || window.dornProduct?.appearance || window.dornStudio?.appearance || null;
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

  function luminance(value) {
    const channels = hexRgb(value).map((channel) => {
      const part = channel / 255;
      return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(first, second) {
    const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  }

  function mixHex(first, second, amount) {
    const a = hexRgb(first);
    const b = hexRgb(second);
    return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
  }

  function normalizePalette(value = {}, fallback = PALETTES.graphite) {
    return {
      accent: normalizeHex(value.accent, fallback.accent),
      background: normalizeHex(value.background, fallback.background),
      panel: normalizeHex(value.panel, fallback.panel),
      surface: normalizeHex(value.surface, fallback.surface),
      text: normalizeHex(value.text, fallback.text),
      muted: normalizeHex(value.muted, fallback.muted)
    };
  }

  function safeCustomPalette(value = {}) {
    const requested = normalizePalette(value, PALETTES.graphite);
    const accent = requested.accent;
    return {
      accent,
      background: mixHex("#08090a", accent, 0.055),
      panel: mixHex("#101214", accent, 0.08),
      surface: mixHex("#181b1f", accent, 0.12),
      text: "#f4f6f8",
      muted: mixHex("#9ba3ac", accent, 0.08)
    };
  }

  function normalizeBackgroundImage(value) {
    const image = String(value || "").trim();
    return /^dorn-background:\/\/current\/asset\?v=[a-f0-9]{12}$/i.test(image) ? image : "";
  }

  function numberInRange(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
  }

  function normalizeAppearance(value = {}) {
    const theme = Object.hasOwn(PALETTES, value.theme) || value.theme === "custom"
      ? value.theme
      : DEFAULT_APPEARANCE.theme;
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
      backgroundOriginalName: hasBackground ? String(value.backgroundOriginalName || "").slice(0, 180) : "",
      backgroundFit: ["cover", "contain", "tile"].includes(value.backgroundFit) ? value.backgroundFit : "cover",
      backgroundStrength: numberInRange(value.backgroundStrength, 35, 10, 100),
      backgroundBlur: numberInRange(value.backgroundBlur, 0, 0, 24),
      backgroundTint: numberInRange(value.backgroundTint, 58, 0, 92),
      backgroundBlend: ["normal", "multiply", "overlay", "soft-light"].includes(value.backgroundBlend) ? value.backgroundBlend : "normal",
      customPalette: theme === "custom"
        ? safeCustomPalette(value.customPalette)
        : normalizePalette(value.customPalette, PALETTES.graphite)
    };
  }

  function readLocal() {
    try {
      return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "{}"));
    } catch {
      return normalizeAppearance(DEFAULT_APPEARANCE);
    }
  }

  function variablesFor(appearance) {
    const palette = appearance.theme === "custom" ? appearance.customPalette : PALETTES[appearance.theme];
    const muted = appearance.contrast === "high" ? mixHex(palette.text, palette.background, 0.25) : palette.muted;
    const accentRgb = hexRgb(palette.accent).join(", ");
    const textRgb = hexRgb(palette.text).join(", ");
    const onAccent = contrastRatio(palette.accent, "#08090a") >= contrastRatio(palette.accent, "#ffffff")
      ? "#08090a"
      : "#ffffff";
    return {
      palette,
      css: {
        "--dorn-accent": palette.accent,
        "--dorn-accent-rgb": accentRgb,
        "--dorn-background": palette.background,
        "--dorn-panel": palette.panel,
        "--dorn-panel-2": palette.surface,
        "--dorn-text": palette.text,
        "--dorn-text-rgb": textRgb,
        "--dorn-muted": muted,
        "--dorn-on-accent": onAccent,
        "--bg": palette.background,
        "--panel": palette.panel,
        "--panel-2": palette.surface,
        "--panel-3": mixHex(palette.surface, palette.text, 0.08),
        "--line": `rgba(${textRgb}, 0.075)`,
        "--line-strong": `rgba(${textRgb}, 0.15)`,
        "--text": palette.text,
        "--muted": muted,
        "--dim": mixHex(muted, palette.background, 0.28),
        "--accent": palette.accent,
        "--accent-2": mixHex(palette.accent, palette.text, 0.28),
        "--dorn-background-image": appearance.backgroundImage ? `url("${appearance.backgroundImage}")` : "none",
        "--dorn-background-size": appearance.backgroundFit === "tile" ? "auto" : appearance.backgroundFit,
        "--dorn-background-repeat": appearance.backgroundFit === "tile" ? "repeat" : "no-repeat",
        "--dorn-background-strength": String(appearance.backgroundStrength / 100),
        "--dorn-background-tint": String(appearance.backgroundTint / 100),
        "--dorn-background-blend": appearance.backgroundBlend,
        "--dorn-background-blur": `${appearance.backgroundBlur}px`
      }
    };
  }

  function applyToDocument(value) {
    const appearance = normalizeAppearance(value);
    const { palette, css } = variablesFor(appearance);
    const root = document.documentElement;
    root.dataset.dornTheme = appearance.theme;
    root.dataset.dornDensity = appearance.density;
    root.dataset.dornMotion = appearance.motion;
    root.dataset.dornMotionIntensity = appearance.motionIntensity;
    root.dataset.dornWindowEffect = appearance.windowEffect;
    root.dataset.dornContrast = appearance.contrast;
    root.dataset.dornBackground = appearance.backgroundMode;
    root.style.colorScheme = luminance(palette.background) > 0.42 ? "light" : "dark";
    Object.entries(css).forEach(([name, color]) => root.style.setProperty(name, color));
    document.dispatchEvent(new CustomEvent("dorn:appearance-changed", {
      detail: { appearance, palette, css }
    }));
    return appearance;
  }

  function apply(value, options = {}) {
    const appearance = applyToDocument(value);
    if (options.persist !== false) localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
    if (options.sync !== false) void bridge()?.save(appearance).catch(() => undefined);
    return appearance;
  }

  async function initialize() {
    if (initialized) return readLocal();
    initialized = true;
    let appearance = apply(readLocal(), { persist: true, sync: false });
    const appearanceBridge = bridge();
    if (!appearanceBridge) return appearance;
    try {
      appearance = apply(await appearanceBridge.get(), { persist: true, sync: false });
    } catch {
      // La apariencia local sigue disponible aunque el puente no responda.
    }
    unsubscribe = appearanceBridge.onChange((next) => {
      apply(next, { persist: true, sync: false });
    });
    return appearance;
  }

  window.addEventListener("beforeunload", () => unsubscribe?.(), { once: true });
  window.dornAppearance = Object.freeze({
    key: APPEARANCE_KEY,
    PALETTES,
    DEFAULT_APPEARANCE,
    normalizeHex,
    contrastRatio,
    normalizePalette,
    safeCustomPalette,
    normalizeAppearance,
    read: readLocal,
    apply,
    initialize,
    variablesFor
  });

  void initialize();
})();
