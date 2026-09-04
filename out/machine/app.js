"use strict";

const OFFICIAL_DORN_PRODUCTS = Object.freeze([]);

function setStatus(text) {
  document.querySelector("[data-status]").textContent = text;
}

function showPage(id) {
  document.querySelectorAll("[data-page]").forEach((page) => page.classList.toggle("active", page.dataset.page === id));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
}

document.querySelector("[data-device-count]").textContent = String(OFFICIAL_DORN_PRODUCTS.length);
document.querySelectorAll("[data-window]").forEach((button) => {
  button.onclick = () => window.dornProduct.windowAction(button.dataset.window);
});
document.querySelectorAll("[data-view]").forEach((button) => {
  button.onclick = () => showPage(button.dataset.view);
});
document.querySelector("[data-open-readiness]").onclick = () => {
  showPage("automation");
  setStatus("Requisitos de publicación abiertos.");
};
document.querySelector("[data-send-diagnostics]").onclick = async () => {
  await window.dornProduct.sendToDorn({
    content: "Analiza la preparación de DORN Machine. El catálogo oficial contiene 0 productos publicados, 0 conectores y 0 comandos físicos habilitados. Diseña un plan industrial realista para el primer producto DORN: prototipo, ensayos, normativa aplicable, firmware seguro, protocolo autenticado, simulador, parada de emergencia, firma del conector, documentación, soporte y criterios de publicación. No lo presentes como producto existente."
  });
  setStatus("Plan de preparación enviado a DORN AI.");
};
