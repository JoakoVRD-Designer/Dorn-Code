(function registerDornRichRender(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DornRichRender = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDornRichRender() {
  "use strict";

  let renderSequence = 0;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function librarySet(overrides) {
    const source = overrides || (typeof globalThis !== "undefined" ? globalThis : {});
    return {
      marked: source.marked,
      DOMPurify: source.DOMPurify,
      katex: source.katex,
      mermaid: source.mermaid,
      hljs: source.hljs
    };
  }

  function requireRenderLibraries(libraries) {
    if (!libraries.marked || typeof libraries.marked.parse !== "function") {
      throw new Error("El motor Markdown no está disponible.");
    }
    if (!libraries.DOMPurify || typeof libraries.DOMPurify.sanitize !== "function") {
      throw new Error("El sanitizador HTML no está disponible.");
    }
  }

  function reserveCode(source) {
    const values = [];
    const reserve = (value) => {
      const token = `DORNCODETOKEN${values.length}END`;
      values.push(value);
      return token;
    };
    let text = source.replace(/```[\s\S]*?```/g, reserve);
    text = text.replace(/`[^`\n]*`/g, reserve);
    return {
      text,
      restore(value) {
        return value.replace(/DORNCODETOKEN(\d+)END/g, (_, index) => values[Number(index)] || "");
      }
    };
  }

  function reserveMath(source) {
    const values = [];
    const reserve = (formula, display) => {
      const token = `DORNMATHTOKEN${values.length}END`;
      values.push({ formula: formula.trim(), display });
      return token;
    };
    let text = source;
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => reserve(formula, true));
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, formula) => reserve(formula, true));
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, formula) => reserve(formula, false));
    text = text.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_, prefix, formula) => `${prefix}${reserve(formula, false)}`);
    return { text, values };
  }

  function renderMath(entry, libraries) {
    if (!libraries.katex || typeof libraries.katex.renderToString !== "function") {
      return `<span class="math-error" title="KaTeX no está disponible">${escapeHtml(entry.formula)}</span>`;
    }
    try {
      const html = libraries.katex.renderToString(entry.formula, {
        displayMode: entry.display,
        throwOnError: true,
        strict: "warn",
        trust: false,
        output: "htmlAndMathml"
      });
      return libraries.DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true, mathMl: true, svg: true }
      });
    } catch (error) {
      const message = error && error.message ? error.message : "Fórmula no válida";
      return `<span class="math-error" title="${escapeHtml(message)}">${escapeHtml(entry.formula)}</span>`;
    }
  }

  function render(source, overrides) {
    const libraries = librarySet(overrides);
    requireRenderLibraries(libraries);
    const normalized = String(source == null ? "" : source).replace(/\r\n?/g, "\n");
    const code = reserveCode(normalized);
    const math = reserveMath(code.text);
    const markdown = code.restore(math.text);
    const rawHtml = libraries.marked.parse(markdown, {
      async: false,
      breaks: true,
      gfm: true
    });
    let cleanHtml = libraries.DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["class", "target", "rel"],
      FORBID_TAGS: ["style", "iframe", "object", "embed", "form", "input", "button"],
      FORBID_ATTR: ["style", "onerror", "onload", "onclick"]
    });
    cleanHtml = cleanHtml.replace(/DORNMATHTOKEN(\d+)END/g, (_, index) => {
      const entry = math.values[Number(index)];
      return entry ? renderMath(entry, libraries) : "";
    });
    return cleanHtml;
  }

  function languageLabel(code) {
    const match = Array.from(code.classList || []).find((name) => name.startsWith("language-"));
    return match ? match.slice("language-".length) : "texto";
  }

  function secureLinks(container) {
    for (const link of container.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    }
  }

  function decorateCode(container, libraries) {
    for (const code of container.querySelectorAll("pre > code")) {
      if (code.classList.contains("language-mermaid")) continue;
      if (libraries.hljs && typeof libraries.hljs.highlightElement === "function") {
        libraries.hljs.highlightElement(code);
      }
      const pre = code.parentElement;
      if (!pre || (pre.parentElement && pre.parentElement.classList.contains("code-block"))) continue;
      const wrapper = container.ownerDocument.createElement("div");
      wrapper.className = "code-block";
      const bar = container.ownerDocument.createElement("div");
      bar.className = "code-bar";
      const label = container.ownerDocument.createElement("span");
      label.textContent = languageLabel(code).toUpperCase();
      const copy = container.ownerDocument.createElement("button");
      copy.type = "button";
      copy.textContent = "Copiar";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(code.textContent || "");
          copy.textContent = "Copiado";
          setTimeout(() => {
            copy.textContent = "Copiar";
          }, 1200);
        } catch (_) {
          copy.textContent = "No disponible";
        }
      });
      bar.append(label, copy);
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.append(bar, pre);
    }
  }

  async function renderDiagrams(container, libraries) {
    const diagrams = Array.from(container.querySelectorAll("pre > code.language-mermaid"));
    if (!diagrams.length) return;
    if (!libraries.mermaid || typeof libraries.mermaid.render !== "function") {
      for (const code of diagrams) code.parentElement.classList.add("diagram-error");
      return;
    }
    if (!libraries.mermaid.__dornInitialized) {
      libraries.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
        suppressErrorRendering: true,
        flowchart: { htmlLabels: false }
      });
      libraries.mermaid.__dornInitialized = true;
    }
    for (const code of diagrams) {
      const pre = code.parentElement;
      const definition = code.textContent || "";
      try {
        const id = `dorn-mermaid-${Date.now()}-${renderSequence++}`;
        const result = await libraries.mermaid.render(id, definition);
        const figure = container.ownerDocument.createElement("figure");
        figure.className = "mermaid-diagram";
        figure.innerHTML = libraries.DOMPurify.sanitize(result.svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["foreignObject", "script"],
          FORBID_ATTR: ["onerror", "onload", "onclick"]
        });
        pre.replaceWith(figure);
      } catch (error) {
        pre.classList.add("diagram-error");
        pre.setAttribute("title", error && error.message ? error.message : "Diagrama Mermaid no válido");
      }
    }
  }

  async function enhance(container, overrides) {
    if (!container) return;
    const libraries = librarySet(overrides);
    secureLinks(container);
    await renderDiagrams(container, libraries);
    decorateCode(container, libraries);
  }

  return {
    escapeHtml,
    render,
    enhance,
    _private: { reserveCode, reserveMath, renderMath }
  };
});
