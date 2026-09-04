"use strict";

(() => {
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const labels = { image: "Imágenes", audio: "Audio", video: "Video", archive: "Comprimidos", application: "Aplicaciones", installer: "Instaladores", document: "Documentos", spreadsheet: "Planillas", presentation: "Presentaciones", code: "Código", text: "Texto", web: "Web", model3d: "3D", cad: "CAD", file: "Archivos" };
  const glyphs = { archive: "ZIP", audio: "AU", video: "VD", image: "IMG", application: "EXE", installer: "SET", document: "DOC", spreadsheet: "XLS", presentation: "PPT", code: "</>", text: "TXT", web: "WEB", model3d: "3D", cad: "CAD", file: "FILE" };
  const bytes = (value) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(2)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;

  function preview(item) {
    if (item.category === "image") return `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.name)}">`;
    if (item.category === "audio") return `<audio controls preload="metadata" src="${escapeHtml(item.previewUrl)}"></audio>`;
    if (item.category === "video") return `<video controls preload="metadata" src="${escapeHtml(item.previewUrl)}"></video>`;
    return `<span class="dorn-result-glyph">${escapeHtml(glyphs[item.category] || (item.extension || "FILE").replace(".", "").slice(0, 4).toUpperCase())}</span>`;
  }

  async function showText(item) {
    const result = await window.dorn.creation.textPreview(item.id);
    if (!result) return;
    const layer = document.createElement("div");
    layer.className = "dorn-gallery-preview";
    layer.innerHTML = `<section><header><strong>${escapeHtml(item.name)}</strong><button>×</button></header><pre>${escapeHtml(result.content)}</pre></section>`;
    document.body.appendChild(layer);
    layer.querySelector("button").onclick = () => layer.remove();
    layer.onclick = (event) => { if (event.target === layer) layer.remove(); };
  }

  async function openGallery() {
    document.querySelector(".dorn-gallery-layer")?.remove();
    const layer = document.createElement("div");
    layer.className = "dorn-gallery-layer";
    layer.innerHTML = `<section class="dorn-gallery-panel" role="dialog" aria-modal="true" aria-label="Galería de resultados DORN"><header class="dorn-gallery-head"><span><small>RESULTADOS DE CREACIÓN</small><h2>Galería DORN</h2><p>Imágenes visibles, audio reproducible y formatos reconocidos por tipo.</p></span><button data-close>×</button></header><div class="dorn-gallery-toolbar"><input data-query placeholder="Buscar por nombre, proyecto o ruta…"><select data-category><option value="">Todos los formatos</option>${Object.entries(labels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select><button data-refresh>Actualizar</button><button class="primary" data-scan>Detectar resultados</button></div><main class="dorn-gallery-body"><div class="dorn-gallery-status">Cargando resultados…</div></main></section>`;
    document.body.appendChild(layer);
    const body = layer.querySelector(".dorn-gallery-body");
    const query = layer.querySelector("[data-query]");
    const category = layer.querySelector("[data-category]");

    async function render() {
      body.innerHTML = '<div class="dorn-gallery-status">Actualizando galería…</div>';
      try {
        const items = await window.dorn.creation.list({ query: query.value, category: category.value, limit: 500 });
        if (!items.length) { body.innerHTML = '<div class="dorn-gallery-status">Todavía no hay resultados indexados. Usa “Detectar resultados” para revisar los proyectos conectados.</div>'; return; }
        body.innerHTML = `<div class="dorn-gallery-grid">${items.map((item) => `<article class="dorn-result-card" data-result="${escapeHtml(item.id)}"><div class="dorn-result-preview">${preview(item)}</div><div class="dorn-result-meta"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><small>${escapeHtml(labels[item.category] || item.category)} · ${bytes(item.sizeBytes)} · ${escapeHtml(item.projectName)}</small><small title="${escapeHtml(item.relativePath)}">${escapeHtml(item.relativePath)}</small></div><div class="dorn-result-actions"><button data-open>Abrir</button>${["text", "code", "web", "spreadsheet"].includes(item.category) ? '<button data-preview>Vista</button>' : ""}<button data-reveal>Ubicación</button><button class="danger" data-remove title="Quitar del índice">×</button></div></article>`).join("")}</div>`;
        for (const card of body.querySelectorAll("[data-result]")) {
          const item = items.find((entry) => entry.id === card.dataset.result);
          card.querySelector("[data-open]").onclick = () => window.dorn.creation.open(item.id);
          card.querySelector("[data-reveal]").onclick = () => window.dorn.creation.reveal(item.id);
          card.querySelector("[data-preview]")?.addEventListener("click", () => showText(item));
          card.querySelector("[data-remove]").onclick = async () => { await window.dorn.creation.remove(item.id); await render(); };
        }
      } catch (error) {
        body.innerHTML = `<div class="dorn-gallery-status">${escapeHtml(error.message || String(error))}</div>`;
      }
    }
    layer.querySelector("[data-close]").onclick = () => layer.remove();
    layer.onclick = (event) => { if (event.target === layer) layer.remove(); };
    query.oninput = render;
    category.onchange = render;
    layer.querySelector("[data-refresh]").onclick = render;
    layer.querySelector("[data-scan]").onclick = async (event) => {
      event.currentTarget.disabled = true;
      body.innerHTML = '<div class="dorn-gallery-status">Revisando los proyectos conectados…</div>';
      try { await window.dorn.creation.scan(); await render(); } catch (error) { body.innerHTML = `<div class="dorn-gallery-status">${escapeHtml(error.message || String(error))}</div>`; }
      finally { event.currentTarget.disabled = false; }
    };
    await render();
  }

  const observer = new MutationObserver(() => {
    const footer = document.querySelector(".sidebar-footer");
    if (!footer || footer.querySelector(".dorn-gallery-trigger") || !window.dorn?.creation) return;
    const button = document.createElement("button");
    button.className = "dorn-gallery-trigger";
    button.innerHTML = "<b>▦</b><span>Galería de resultados</span>";
    button.onclick = openGallery;
    footer.prepend(button);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
