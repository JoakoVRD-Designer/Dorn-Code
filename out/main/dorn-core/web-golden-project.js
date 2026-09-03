"use strict";

const fs = require("node:fs");
const path = require("node:path");

const GOLDEN_FILES = Object.freeze([
  "README.md",
  "app.js",
  "assets/system-map.svg",
  "design-contract.json",
  "index.html",
  "styles.css",
  "tests/golden.test.cjs",
  "verification/golden-validator.cjs"
]);

function webError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function cleanText(value, fallback, maximum = 160) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maximum);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function containsInlineCode(html) {
  const tags = String(html || "").match(/<[^>]+>/g) || [];
  const attributeNames = tags.map((tag) => tag.replace(/"[^"]*"|'[^']*'/g, ""));
  return attributeNames.some((tag) => /\son[a-z]+\s*=/i.test(tag)) || /<script(?![^>]+src=)|<style\b/i.test(String(html || ""));
}

function normalizeBrief(input = {}) {
  const siteName = cleanText(input.siteName, "Northstar Studio", 80);
  const features = (Array.isArray(input.features) ? input.features : []).slice(0, 6).map((entry, index) => ({
    title: cleanText(entry?.title, `Capacidad ${index + 1}`, 70),
    copy: cleanText(entry?.copy, "Una capacidad diseñada con claridad, velocidad y resultados verificables.", 220)
  }));
  while (features.length < 3) {
    const defaults = [
      ["Dirección clara", "De la intención al sistema visual con decisiones explícitas y una jerarquía fácil de recorrer."],
      ["Ejecución precisa", "Componentes accesibles, comportamiento rápido y una base preparada para evolucionar."],
      ["Evidencia real", "Cada entrega incluye criterios comprobables para revisar calidad, seguridad y rendimiento."]
    ][features.length];
    features.push({ title: defaults[0], copy: defaults[1] });
  }
  return {
    siteName,
    eyebrow: cleanText(input.eyebrow, "SISTEMAS DIGITALES · DISEÑO Y DESARROLLO", 90),
    headline: cleanText(input.headline, "Convertimos ideas complejas en productos que se sienten inevitables.", 130),
    summary: cleanText(input.summary, "Estrategia, experiencia e ingeniería reunidas en un proceso corto, observable y preparado para producción.", 280),
    primaryCta: cleanText(input.primaryCta, "Iniciar un proyecto", 40),
    secondaryCta: cleanText(input.secondaryCta, "Ver el método", 40),
    features
  };
}

function renderHtml(brief) {
  const features = brief.features.map((feature, index) => `
          <article class="capability-card reveal" data-reveal>
            <span class="card-index">0${index + 1}</span>
            <h3>${escapeHtml(feature.title)}</h3>
            <p>${escapeHtml(feature.copy)}</p>
          </article>`).join("");
  return `<!doctype html>
<html lang="es" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(brief.summary)}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'">
  <title>${escapeHtml(brief.siteName)} · Producto digital</title>
  <link rel="stylesheet" href="./styles.css">
  <script src="./app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#contenido">Saltar al contenido</a>
  <header class="site-header" data-header>
    <a class="brand" href="#inicio" aria-label="${escapeHtml(brief.siteName)} · Inicio">
      <span aria-hidden="true">N/</span><strong>${escapeHtml(brief.siteName)}</strong>
    </a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="navigation" data-menu-toggle>
      <span class="sr-only">Abrir navegación</span><i></i><i></i>
    </button>
    <nav id="navigation" class="site-nav" aria-label="Navegación principal" data-navigation>
      <a href="#capacidades">Capacidades</a><a href="#metodo">Método</a><a href="#caso">Caso</a>
      <a class="nav-cta" href="#contacto">Conversar</a>
    </nav>
    <button class="theme-toggle" type="button" aria-label="Cambiar tema" aria-pressed="false" data-theme-toggle><span aria-hidden="true">◐</span></button>
  </header>

  <main id="contenido">
    <section id="inicio" class="hero" aria-labelledby="hero-title">
      <div class="hero-copy reveal" data-reveal>
        <p class="eyebrow">${escapeHtml(brief.eyebrow)}</p>
        <h1 id="hero-title">${escapeHtml(brief.headline)}</h1>
        <p class="hero-summary">${escapeHtml(brief.summary)}</p>
        <div class="hero-actions">
          <a class="button primary" href="#contacto">${escapeHtml(brief.primaryCta)}</a>
          <a class="button secondary" href="#metodo">${escapeHtml(brief.secondaryCta)}</a>
        </div>
      </div>
      <figure class="hero-visual reveal" data-reveal>
        <img src="./assets/system-map.svg" alt="Mapa de un sistema digital que conecta estrategia, diseño, desarrollo y validación" width="760" height="620">
        <figcaption><span>01</span> Sistema vivo, no una maqueta aislada.</figcaption>
      </figure>
      <div class="proof-strip" aria-label="Indicadores del proceso">
        <span><strong>4×</strong><small>disciplinas coordinadas</small></span>
        <span><strong>0</strong><small>dependencias externas</small></span>
        <span><strong>AA</strong><small>objetivo de accesibilidad</small></span>
      </div>
    </section>

    <section id="capacidades" class="section-shell" aria-labelledby="capabilities-title">
      <div class="section-heading"><p class="eyebrow">CAPACIDADES</p><h2 id="capabilities-title">Menos ruido. Más sistema.</h2><p>Un lenguaje visual coherente desde el primer gesto hasta el último estado de interacción.</p></div>
      <div class="capability-grid">${features}
      </div>
    </section>

    <section id="metodo" class="method section-shell" aria-labelledby="method-title">
      <div class="section-heading"><p class="eyebrow">MÉTODO</p><h2 id="method-title">Avanzar sin perder el criterio.</h2></div>
      <ol class="method-list">
        <li class="reveal" data-reveal><span>01</span><div><h3>Enmarcar</h3><p>Objetivo, audiencia, límites y definición de éxito antes de diseñar.</p></div></li>
        <li class="reveal" data-reveal><span>02</span><div><h3>Explorar</h3><p>Tres direcciones comparables; una decisión argumentada y documentada.</p></div></li>
        <li class="reveal" data-reveal><span>03</span><div><h3>Construir</h3><p>Componentes semánticos, adaptables y sin deuda visual innecesaria.</p></div></li>
        <li class="reveal" data-reveal><span>04</span><div><h3>Romper</h3><p>Accesibilidad, contenido extremo, teclado, contraste y rendimiento bajo presión.</p></div></li>
      </ol>
    </section>

    <section id="caso" class="case-study section-shell" aria-labelledby="case-title">
      <div class="case-copy reveal" data-reveal><p class="eyebrow">CASO DESTACADO · 2026</p><h2 id="case-title">Una operación compleja convertida en una vista que decide.</h2><p>La interfaz reúne señales dispersas, explica el estado y mantiene la acción principal visible sin saturar al equipo.</p><a class="text-link" href="#contacto">Revisar el enfoque <span aria-hidden="true">↗</span></a></div>
      <div class="case-panel reveal" data-reveal aria-label="Resumen del caso">
        <span class="status"><i></i> Sistema estable</span>
        <div class="metric"><small>Tiempo de decisión</small><strong>−38%</strong><em>vs. flujo anterior</em></div>
        <div class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="case-footer"><span>Claridad</span><span>Velocidad</span><span>Control</span></div>
      </div>
    </section>

    <section class="faq section-shell" aria-labelledby="faq-title">
      <div class="section-heading"><p class="eyebrow">PREGUNTAS</p><h2 id="faq-title">Lo esencial, sin letra pequeña.</h2></div>
      <div class="faq-list">
        <details><summary>¿La experiencia funciona sin JavaScript?<span aria-hidden="true">+</span></summary><p>El contenido, la navegación y las acciones principales permanecen disponibles. JavaScript añade progresivamente menú compacto, tema y revelado.</p></details>
        <details><summary>¿Qué se valida antes de entregar?<span aria-hidden="true">+</span></summary><p>Estructura semántica, teclado, movimiento reducido, contraste, rutas locales, comportamiento adaptable y ausencia de dependencias remotas.</p></details>
        <details><summary>¿Puede evolucionar a una aplicación?<span aria-hidden="true">+</span></summary><p>Sí. Los tokens, componentes y contratos quedan separados para crecer sin rehacer la dirección visual.</p></details>
      </div>
    </section>

    <section id="contacto" class="contact section-shell" aria-labelledby="contact-title">
      <p class="eyebrow">SIGUIENTE PASO</p><h2 id="contact-title">Construyamos algo que merezca existir.</h2><p>Una conversación breve, un alcance claro y una primera dirección que se pueda criticar.</p><a class="button primary" href="mailto:hello@example.com">${escapeHtml(brief.primaryCta)}</a>
    </section>
  </main>

  <footer class="site-footer"><strong>${escapeHtml(brief.siteName)}</strong><span>Diseñado para claridad, acceso y evolución.</span><a href="#inicio">Volver arriba</a></footer>
</body>
</html>
`;
}

function renderCss() {
  return `:root {
  color-scheme: dark;
  --bg: #0a0d0e; --panel: #111719; --panel-2: #182023; --text: #f2f5f3; --muted: #9aa7a3;
  --line: rgba(230, 242, 237, .14); --accent: #a8ff78; --accent-2: #5ce1e6; --on-accent: #081008;
  --display: clamp(3.35rem, 8.4vw, 8.8rem); --h2: clamp(2.25rem, 5vw, 5.2rem); --body: clamp(1rem, 1.4vw, 1.18rem);
  --radius-sm: .8rem; --radius: 1.5rem; --radius-lg: 2.25rem; --max: 92rem; --gutter: clamp(1rem, 4vw, 4.5rem);
  --shadow: 0 2rem 7rem rgba(0, 0, 0, .34); --ease: cubic-bezier(.22, 1, .36, 1);
}
html[data-theme="light"] { color-scheme: light; --bg: #eef2ed; --panel: #ffffff; --panel-2: #dfe7e1; --text: #101513; --muted: #52605b; --line: rgba(12, 30, 22, .16); --shadow: 0 2rem 7rem rgba(31, 51, 42, .12); }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font: 400 var(--body)/1.62 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-x: hidden; }
a { color: inherit; } img { display: block; max-width: 100%; height: auto; }
button, a { -webkit-tap-highlight-color: transparent; }
:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 4px; border-radius: .35rem; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.skip-link { position: fixed; z-index: 100; top: .75rem; left: .75rem; padding: .8rem 1rem; background: var(--accent); color: var(--on-accent); transform: translateY(-160%); }
.skip-link:focus { transform: translateY(0); }
.site-header { position: fixed; z-index: 50; top: 1rem; left: 50%; width: min(calc(100% - 2rem), var(--max)); transform: translateX(-50%); display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 1rem; padding: .75rem .8rem .75rem 1rem; border: 1px solid var(--line); border-radius: 999px; background: color-mix(in srgb, var(--bg) 76%, transparent); backdrop-filter: blur(18px); transition: background .25s ease, box-shadow .25s ease; }
.site-header.scrolled { background: color-mix(in srgb, var(--panel) 92%, transparent); box-shadow: var(--shadow); }
.brand { display: inline-flex; align-items: center; gap: .7rem; width: max-content; text-decoration: none; letter-spacing: -.02em; }
.brand > span { display: grid; place-items: center; width: 2.1rem; aspect-ratio: 1; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-weight: 900; font-size: .72rem; }
.site-nav { display: flex; align-items: center; gap: clamp(.4rem, 1.4vw, 1.4rem); }
.site-nav a { padding: .55rem .7rem; color: var(--muted); text-decoration: none; font-size: .88rem; font-weight: 650; }
.site-nav a:hover { color: var(--text); }
.site-nav .nav-cta { border: 1px solid var(--line); border-radius: 999px; color: var(--text); }
.theme-toggle, .menu-toggle { border: 0; background: transparent; color: var(--text); cursor: pointer; }
.theme-toggle { width: 2.5rem; aspect-ratio: 1; border-radius: 50%; background: var(--panel-2); font-size: 1.05rem; }
.menu-toggle { display: none; }
.hero { min-height: 100svh; max-width: var(--max); margin: 0 auto; padding: clamp(9rem, 16vh, 12rem) var(--gutter) 2rem; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(22rem, .85fr); gap: clamp(2rem, 5vw, 6rem); align-items: center; position: relative; }
.hero::before { content: ""; position: absolute; width: 38rem; height: 38rem; top: -18rem; right: -10rem; border-radius: 50%; background: color-mix(in srgb, var(--accent) 15%, transparent); filter: blur(80px); pointer-events: none; }
.eyebrow { margin: 0 0 1.1rem; color: var(--accent); font-size: .72rem; font-weight: 850; letter-spacing: .17em; }
h1, h2, h3, p { text-wrap: pretty; }
h1 { max-width: 10ch; margin: 0; font-size: var(--display); line-height: .88; letter-spacing: -.072em; font-weight: 790; }
.hero-summary { max-width: 43rem; margin: 2rem 0 0; color: var(--muted); font-size: clamp(1.05rem, 1.6vw, 1.35rem); }
.hero-actions { display: flex; flex-wrap: wrap; gap: .8rem; margin-top: 2.2rem; }
.button { display: inline-flex; justify-content: center; align-items: center; min-height: 3.25rem; padding: .8rem 1.25rem; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; font-weight: 750; transition: transform .2s ease, background .2s ease; }
.button:hover { transform: translateY(-2px); }.button.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }.button.secondary { background: var(--panel); }
.hero-visual { margin: 0; padding: clamp(1rem, 3vw, 2rem); border: 1px solid var(--line); border-radius: var(--radius-lg); background: linear-gradient(145deg, var(--panel), var(--panel-2)); box-shadow: var(--shadow); transform: rotate(1.2deg); }
.hero-visual figcaption { display: flex; gap: 1rem; align-items: center; padding: 1rem .4rem 0; color: var(--muted); font-size: .86rem; }.hero-visual figcaption span { color: var(--accent); font-weight: 800; }
.proof-strip { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); margin-top: clamp(1rem, 5vh, 4rem); }
.proof-strip > span { display: flex; align-items: baseline; gap: .8rem; padding: 1.2rem; }.proof-strip > span + span { border-left: 1px solid var(--line); }.proof-strip strong { font-size: 1.7rem; }.proof-strip small { color: var(--muted); }
.section-shell { max-width: var(--max); margin: 0 auto; padding: clamp(6rem, 12vw, 11rem) var(--gutter); }
.section-heading { display: grid; grid-template-columns: 1.1fr .6fr; align-items: end; gap: 2rem; margin-bottom: clamp(2.5rem, 6vw, 5.5rem); }.section-heading .eyebrow { grid-column: 1 / -1; margin-bottom: 0; }.section-heading h2 { margin: 0; max-width: 12ch; font-size: var(--h2); line-height: .96; letter-spacing: -.055em; }.section-heading > p:last-child { margin: 0; color: var(--muted); }
.capability-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }.capability-card { min-height: 22rem; padding: clamp(1.4rem, 3vw, 2.3rem); border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); display: flex; flex-direction: column; }.capability-card:nth-child(2) { transform: translateY(2rem); }.card-index { color: var(--accent); font: 800 .75rem/1 monospace; }.capability-card h3 { margin: auto 0 .7rem; font-size: clamp(1.55rem, 2.4vw, 2.2rem); letter-spacing: -.035em; }.capability-card p { margin: 0; color: var(--muted); }
.method { border-top: 1px solid var(--line); }.method-list { list-style: none; padding: 0; margin: 0; }.method-list li { display: grid; grid-template-columns: 6rem 1fr; gap: 1rem; padding: 2rem 0; border-top: 1px solid var(--line); }.method-list li:last-child { border-bottom: 1px solid var(--line); }.method-list > li > span { color: var(--accent); font: 800 .8rem/1 monospace; }.method-list h3 { margin: 0; font-size: clamp(1.7rem, 3vw, 3rem); }.method-list p { margin: .6rem 0 0; color: var(--muted); }
.case-study { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(2rem, 7vw, 8rem); align-items: center; }.case-copy h2 { margin: 0; font-size: var(--h2); line-height: .98; letter-spacing: -.055em; }.case-copy > p:not(.eyebrow) { color: var(--muted); max-width: 42rem; }.text-link { display: inline-flex; gap: .5rem; margin-top: 1rem; color: var(--accent); font-weight: 800; text-decoration: none; }
.case-panel { min-height: 30rem; padding: clamp(1.5rem, 4vw, 3rem); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--panel); box-shadow: var(--shadow); }.status { display: inline-flex; align-items: center; gap: .5rem; color: var(--muted); font-size: .8rem; }.status i { width: .55rem; aspect-ratio: 1; border-radius: 50%; background: var(--accent); box-shadow: 0 0 1rem var(--accent); }.metric { display: grid; margin-top: 4rem; }.metric small, .metric em { color: var(--muted); font-style: normal; }.metric strong { font-size: clamp(4rem, 10vw, 8rem); line-height: 1; letter-spacing: -.08em; }.signal-bars { height: 5rem; display: flex; gap: .4rem; align-items: end; margin-top: 2rem; }.signal-bars i { flex: 1; min-height: 12%; background: linear-gradient(var(--accent-2), var(--accent)); border-radius: .3rem .3rem 0 0; }.signal-bars i:nth-child(2) { height: 35%; }.signal-bars i:nth-child(3) { height: 64%; }.signal-bars i:nth-child(4) { height: 48%; }.signal-bars i:nth-child(5) { height: 78%; }.signal-bars i:nth-child(6) { height: 60%; }.signal-bars i:nth-child(7) { height: 92%; }.case-footer { display: flex; justify-content: space-between; margin-top: 1rem; color: var(--muted); font-size: .75rem; }
.faq-list details { border-top: 1px solid var(--line); }.faq-list details:last-child { border-bottom: 1px solid var(--line); }.faq-list summary { display: flex; justify-content: space-between; gap: 2rem; padding: 1.5rem 0; cursor: pointer; font-size: clamp(1.1rem, 2vw, 1.45rem); font-weight: 750; }.faq-list summary::marker { content: ""; }.faq-list details p { max-width: 54rem; margin: 0 0 1.8rem; color: var(--muted); }.faq-list details[open] summary span { transform: rotate(45deg); }
.contact { text-align: center; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--panel); }.contact h2 { max-width: 13ch; margin: 0 auto; font-size: var(--h2); line-height: .96; letter-spacing: -.055em; }.contact > p:not(.eyebrow) { max-width: 42rem; margin: 1.4rem auto 2rem; color: var(--muted); }
.site-footer { max-width: var(--max); margin: 2rem auto 0; padding: 2.5rem var(--gutter); display: flex; justify-content: space-between; gap: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .82rem; }.site-footer strong { color: var(--text); }
.reveal { opacity: 0; transform: translateY(1.5rem); transition: opacity .7s var(--ease), transform .7s var(--ease); }.reveal.visible { opacity: 1; transform: none; }
@media (max-width: 900px) {
  .site-header { grid-template-columns: 1fr auto auto; }.menu-toggle { display: grid; place-content: center; gap: .35rem; width: 2.5rem; aspect-ratio: 1; }.menu-toggle i { display: block; width: 1.1rem; height: 2px; background: currentColor; }
  .site-nav { position: absolute; top: calc(100% + .6rem); left: 0; right: 0; padding: 1rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: var(--shadow); display: none; flex-direction: column; align-items: stretch; }.site-nav.open { display: flex; }
  .hero, .case-study { grid-template-columns: 1fr; }.hero { padding-top: 9rem; }.hero-visual { max-width: 42rem; }.section-heading { grid-template-columns: 1fr; }.capability-grid { grid-template-columns: 1fr; }.capability-card, .capability-card:nth-child(2) { min-height: 17rem; transform: none; }.proof-strip { grid-template-columns: 1fr; }.proof-strip > span + span { border-left: 0; border-top: 1px solid var(--line); }
}
@media (max-width: 560px) { :root { --gutter: 1rem; }.site-header { top: .5rem; width: calc(100% - 1rem); }.brand strong { max-width: 11rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.hero-actions .button { width: 100%; }.method-list li { grid-template-columns: 2.5rem 1fr; }.site-footer { flex-direction: column; }.theme-toggle { display: none; } }
@media (prefers-contrast: more) { :root { --line: currentColor; }.button, .site-header, .capability-card, .case-panel { border-width: 2px; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }.reveal { opacity: 1; transform: none; } }
`;
}

function renderScript() {
  return `"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  const menuButton = document.querySelector("[data-menu-toggle]");
  const navigation = document.querySelector("[data-navigation]");
  const themeButton = document.querySelector("[data-theme-toggle]");
  const header = document.querySelector("[data-header]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const closeMenu = () => {
    navigation?.classList.remove("open");
    menuButton?.setAttribute("aria-expanded", "false");
  };
  menuButton?.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    navigation?.classList.toggle("open", open);
  });
  navigation?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
  window.addEventListener("resize", () => { if (window.innerWidth > 900) closeMenu(); }, { passive: true });

  let storedTheme = null;
  try { storedTheme = window.localStorage.getItem("golden-theme"); } catch {}
  if (storedTheme === "light" || storedTheme === "dark") root.dataset.theme = storedTheme;
  const syncThemeButton = () => themeButton?.setAttribute("aria-pressed", String(root.dataset.theme === "light"));
  syncThemeButton();
  themeButton?.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    try { window.localStorage.setItem("golden-theme", root.dataset.theme); } catch {}
    syncThemeButton();
  });

  const updateHeader = () => header?.classList.toggle("scrolled", window.scrollY > 16);
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  const revealItems = [...document.querySelectorAll("[data-reveal]")];
  if (reduceMotion || !("IntersectionObserver" in window)) revealItems.forEach((item) => item.classList.add("visible"));
  else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); } });
    }, { threshold: .14, rootMargin: "0px 0px -6%" });
    revealItems.forEach((item) => observer.observe(item));
  }
});
`;
}

function renderSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 620" role="img" aria-labelledby="title desc"><title id="title">Mapa del sistema de producto</title><desc id="desc">Cuatro módulos conectados: estrategia, diseño, desarrollo y evidencia.</desc><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#a8ff78"/><stop offset="1" stop-color="#5ce1e6"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="24"/></filter></defs><rect width="760" height="620" rx="34" fill="#0d1214"/><circle cx="380" cy="310" r="190" fill="none" stroke="#293438" stroke-width="1" stroke-dasharray="7 12"/><circle cx="380" cy="310" r="118" fill="#11191b" stroke="url(#g)" stroke-width="2"/><circle cx="380" cy="310" r="80" fill="url(#g)" opacity=".12" filter="url(#blur)"/><text x="380" y="302" text-anchor="middle" fill="#f2f5f3" font-family="system-ui,sans-serif" font-size="30" font-weight="750">PRODUCTO</text><text x="380" y="336" text-anchor="middle" fill="#9aa7a3" font-family="system-ui,sans-serif" font-size="15" letter-spacing="3">SISTEMA VIVO</text><g fill="#141c1f" stroke="#344246"><rect x="56" y="92" width="210" height="104" rx="22"/><rect x="494" y="92" width="210" height="104" rx="22"/><rect x="56" y="424" width="210" height="104" rx="22"/><rect x="494" y="424" width="210" height="104" rx="22"/></g><g stroke="url(#g)" stroke-width="2" fill="none"><path d="M266 144C340 144 320 230 350 250"/><path d="M494 144C420 144 440 230 410 250"/><path d="M266 476C340 476 320 390 350 370"/><path d="M494 476C420 476 440 390 410 370"/></g><g fill="#a8ff78"><circle cx="266" cy="144" r="5"/><circle cx="494" cy="144" r="5"/><circle cx="266" cy="476" r="5"/><circle cx="494" cy="476" r="5"/></g><g font-family="system-ui,sans-serif"><g fill="#8b9894" font-size="11" letter-spacing="2"><text x="82" y="126">01 · ENMARCAR</text><text x="520" y="126">02 · EXPLORAR</text><text x="82" y="458">03 · CONSTRUIR</text><text x="520" y="458">04 · VALIDAR</text></g><g fill="#f2f5f3" font-size="22" font-weight="700"><text x="82" y="164">Estrategia</text><text x="520" y="164">Dirección</text><text x="82" y="496">Ingeniería</text><text x="520" y="496">Evidencia</text></g></g></svg>`;
}

function renderContract(brief) {
  return `${JSON.stringify({
    schema: "dorn.web-golden-design/1",
    siteName: brief.siteName,
    selectedDirection: "precision-editorial",
    directions: [
      { id: "precision-editorial", name: "Precisión editorial", traits: ["tipografía protagonista", "ritmo amplio", "datos sobrios"] },
      { id: "technical-grid", name: "Retícula técnica", traits: ["estructura visible", "módulos densos", "señalización industrial"] },
      { id: "kinetic-studio", name: "Estudio cinético", traits: ["capas expresivas", "color energético", "movimiento dirigido"] }
    ],
    rationale: "La precisión editorial equilibra autoridad profesional, lectura rápida y una personalidad propia sin depender de librerías externas.",
    tokens: { color: ["--bg", "--panel", "--text", "--muted", "--accent", "--accent-2"], spacing: "fluid-clamp", radius: ["sm", "base", "large"], motion: "progressive-with-reduced-motion" },
    breakpoints: [560, 900],
    accessibilityTarget: "WCAG 2.2 AA",
    externalRuntimeDependencies: []
  }, null, 2)}\n`;
}

function renderValidator() {
  return String.raw`"use strict";
const fs = require("node:fs");
const path = require("node:path");

function validate(root = path.resolve(__dirname, "..")) {
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  const html = read("index.html"); const css = read("styles.css"); const script = read("app.js");
  const contract = JSON.parse(read("design-contract.json")); const svg = read("assets/system-map.svg");
  const failures = [];
  const need = (value, label) => { if (!value) failures.push(label); };
  need(/<!doctype html>/i.test(html), "doctype"); need(/<html lang="es"/i.test(html), "lang");
  need(/Content-Security-Policy/.test(html) && /connect-src 'none'/.test(html), "csp");
  need(/<main id="contenido">/.test(html), "main"); need(/<nav[^>]+aria-label=/.test(html), "nav"); need(/class="skip-link"/.test(html), "skip-link");
  need(/aria-controls="navigation"/.test(html) && /id="navigation"/.test(html), "menu-control");
  need(/alt="[^"]+"/.test(html), "image-alt"); need((html.match(/<h1\b/g) || []).length === 1, "single-h1");
  const tags = (html.match(/<[^>]+>/g) || []).map((tag) => tag.replace(/"[^"]*"|'[^']*'/g, ""));
  need(!tags.some((tag) => /\son[a-z]+\s*=/i.test(tag)) && !/<script(?![^>]+src=)|<style\b/i.test(html), "no-inline-code");
  need(!/(?:src|href)=["']https?:\/\//i.test(html), "no-remote-assets");
  need(/:focus-visible/.test(css), "focus-visible"); need(/prefers-reduced-motion/.test(css), "reduced-motion"); need(/@media \(max-width: 900px\)/.test(css), "responsive");
  need(!/eval\s*\(|new Function|\.innerHTML|document\.write|fetch\s*\(/.test(script), "safe-script");
  need(contract.schema === "dorn.web-golden-design/1" && contract.directions.length >= 3, "design-contract");
  need(contract.directions.some((entry) => entry.id === contract.selectedDirection), "selected-direction");
  need(/<title[^>]*>[^<]+<\/title>/.test(svg) && !/<script\b|(?:href|src)=["']https?:\/\//i.test(svg), "safe-svg");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  need(new Set(ids).size === ids.length, "unique-ids");
  for (const target of [...html.matchAll(/(?:href="#|aria-controls=")([^"]+)"/g)].map((match) => match[1])) need(ids.includes(target), "missing-target:" + target);
  return { passed: failures.length === 0, failures, checks: 20, files: 8 };
}
module.exports = { validate };
`;
}

function renderTest() {
  return `"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { validate } = require("../verification/golden-validator.cjs");

test("el Golden Project cumple su contrato independiente", () => {
  const report = validate();
  assert.equal(report.passed, true, report.failures.join(", "));
  assert.equal(report.files, 8);
  assert.ok(report.checks >= 20);
});
`;
}

function renderReadme(brief) {
  return `# ${brief.siteName}\n\nGolden Project web producido por DORN con HTML semántico, CSS adaptable y JavaScript progresivo.\n\n## Verificación\n\n\`node --test tests/golden.test.cjs\`\n\nLa validación estática cubre estructura, CSP, rutas locales, teclado, movimiento reducido, adaptación responsive, contrato visual y ausencia de ejecución remota. La aprobación visual requiere una captura real de navegador y no puede inferirse desde este archivo.\n`;
}

function generateWebGoldenProject(input = {}) {
  const brief = normalizeBrief(input);
  const files = {
    "README.md": renderReadme(brief),
    "app.js": renderScript(),
    "assets/system-map.svg": renderSvg(),
    "design-contract.json": renderContract(brief),
    "index.html": renderHtml(brief),
    "styles.css": renderCss(),
    "tests/golden.test.cjs": renderTest(),
    "verification/golden-validator.cjs": renderValidator()
  };
  const report = validateWebGoldenFiles(files);
  if (!report.passed) throw webError("WEB_GOLDEN_GENERATOR_INVALID", `El autor produjo un proyecto inválido: ${report.failures.join(", ")}`, { report });
  return { schema: "dorn.web-golden/1", brief, files, report };
}

function validateWebGoldenFiles(files) {
  const failures = [];
  if (!files || typeof files !== "object" || Array.isArray(files)) return { passed: false, failures: ["FILES_INVALID"], checks: 0 };
  const names = Object.keys(files).sort();
  if (JSON.stringify(names) !== JSON.stringify([...GOLDEN_FILES].sort())) failures.push("FILE_SET_MISMATCH");
  for (const name of names) {
    const value = files[name];
    if (typeof value !== "string" || !value.length || Buffer.byteLength(value, "utf8") > 2 * 1024 * 1024) failures.push(`FILE_INVALID:${name}`);
  }
  const html = String(files["index.html"] || "");
  const css = String(files["styles.css"] || "");
  const script = String(files["app.js"] || "");
  const svg = String(files["assets/system-map.svg"] || "");
  const test = String(files["tests/golden.test.cjs"] || "");
  const need = (value, label) => { if (!value) failures.push(label); };
  need(/<!doctype html>/i.test(html), "HTML_DOCTYPE");
  need(/<html lang="es"/i.test(html), "HTML_LANGUAGE");
  need(/Content-Security-Policy/.test(html) && /connect-src 'none'/.test(html), "HTML_CSP");
  need(/<main id="contenido">/.test(html) && /<nav[^>]+aria-label=/.test(html), "HTML_LANDMARKS");
  need(/class="skip-link"/.test(html) && /:focus-visible/.test(css), "KEYBOARD_ACCESS");
  need(/aria-controls="navigation"/.test(html) && /aria-expanded="false"/.test(html), "MENU_ACCESSIBILITY");
  need(/alt="[^"]+"/.test(html), "IMAGE_ALT");
  need((html.match(/<h1\b/g) || []).length === 1, "HEADING_H1_COUNT");
  need(!containsInlineCode(html), "INLINE_CODE_DENIED");
  need(!/(?:src|href)=["']https?:\/\//i.test(html), "REMOTE_ASSET_DENIED");
  need(/@media \(max-width: 900px\)/.test(css) && /@media \(max-width: 560px\)/.test(css), "RESPONSIVE_CONTRACT");
  need(/prefers-reduced-motion/.test(css) && /prefers-contrast/.test(css), "ACCESSIBILITY_MEDIA");
  need(/clamp\(/.test(css) && /--accent:/.test(css), "DESIGN_TOKENS");
  need(!/eval\s*\(|new Function|\.innerHTML|document\.write|fetch\s*\(/.test(script), "SCRIPT_UNSAFE");
  need(/IntersectionObserver/.test(script) && /localStorage/.test(script), "PROGRESSIVE_BEHAVIOR");
  need(/<title[^>]*>[^<]+<\/title>/.test(svg) && /<desc[^>]*>[^<]+<\/desc>/.test(svg), "SVG_ACCESSIBILITY");
  need(!/<script\b|(?:href|src)=["']https?:\/\//i.test(svg), "SVG_UNSAFE");
  need(/node:test/.test(test) && /golden-validator\.cjs/.test(test), "INDEPENDENT_TEST_MISSING");
  try {
    const contract = JSON.parse(files["design-contract.json"] || "{}");
    need(contract.schema === "dorn.web-golden-design/1", "CONTRACT_SCHEMA");
    need(Array.isArray(contract.directions) && contract.directions.length >= 3, "VISUAL_EXPLORATION_MISSING");
    need(contract.directions?.some((entry) => entry.id === contract.selectedDirection), "VISUAL_SELECTION_INVALID");
    need(Array.isArray(contract.externalRuntimeDependencies) && contract.externalRuntimeDependencies.length === 0, "EXTERNAL_DEPENDENCY_PRESENT");
  } catch { failures.push("CONTRACT_JSON_INVALID"); }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  need(new Set(ids).size === ids.length, "DUPLICATE_IDS");
  for (const target of [...html.matchAll(/(?:href="#|aria-controls=")([^"]+)"/g)].map((match) => match[1])) {
    if (!ids.includes(target)) failures.push(`MISSING_REFERENCE:${target}`);
  }
  return { schema: "dorn.web-golden-validation/1", passed: failures.length === 0, failures, checks: 24, files: names.length };
}

function safeRelative(root, relativePath) {
  const name = String(relativePath || "").replaceAll("\\", "/");
  if (!name || path.isAbsolute(name) || name.includes("\0") || name.split("/").some((part) => !part || part === "." || part === "..")) {
    throw webError("WEB_GOLDEN_PATH_UNSAFE", "El Golden Project recibió una ruta insegura.");
  }
  const absolute = path.resolve(root, ...name.split("/"));
  if (!absolute.startsWith(`${root}${path.sep}`)) throw webError("WEB_GOLDEN_PATH_ESCAPE", "El Golden Project intentó salir de su carpeta.");
  return absolute;
}

function ensureDirectories(root, relativePath) {
  let current = root;
  for (const part of path.dirname(relativePath).split("/").filter((entry) => entry && entry !== ".")) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw webError("WEB_GOLDEN_DIRECTORY_UNSAFE", "Una carpeta destino no es segura.");
    } else fs.mkdirSync(current, { mode: 0o700 });
  }
}

function writeWebGoldenFiles(targetRoot, files, options = {}) {
  const root = fs.realpathSync(String(targetRoot || ""));
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw webError("WEB_GOLDEN_ROOT_UNSAFE", "La carpeta destino no es segura.");
  const report = validateWebGoldenFiles(files);
  if (!report.passed) throw webError("WEB_GOLDEN_FILES_INVALID", `Los archivos no superaron el contrato: ${report.failures.join(", ")}`, { report });
  const written = [];
  for (const relativePath of GOLDEN_FILES) {
    const absolute = safeRelative(root, relativePath);
    ensureDirectories(root, relativePath);
    if (fs.existsSync(absolute)) {
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw webError("WEB_GOLDEN_TARGET_UNSAFE", `El destino ${relativePath} no es un archivo regular.`);
      if (options.allowReplace !== true) throw webError("WEB_GOLDEN_TARGET_EXISTS", `El destino ${relativePath} ya existe y no fue sobrescrito.`);
    }
    const temporary = `${absolute}.dorn-${process.pid}.tmp`;
    fs.writeFileSync(temporary, files[relativePath], { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    fs.renameSync(temporary, absolute);
    written.push(relativePath);
  }
  return { written, report };
}

module.exports = {
  GOLDEN_FILES,
  containsInlineCode,
  generateWebGoldenProject,
  normalizeBrief,
  validateWebGoldenFiles,
  writeWebGoldenFiles
};
