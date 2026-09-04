"use strict";

(() => {
  const features = window.__DORN_INTERNAL_FEATURES__ || Object.freeze({});
  const authenticationEnabled = features.accountAuthentication === true;
  const accountControlsEnabled = authenticationEnabled && features.accountControls === true;
  const root = document.createElement("div");
  root.id = "dorn-auth-root";
  let status = null;
  let pendingRegistration = null;
  let registrationInFlight = false;
  let applicationLoaded = false;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function shell(content) {
    if (!root.isConnected) document.body.appendChild(root);
    root.innerHTML = `<section class="dorn-auth-visual"><div class="dorn-auth-glow"></div><div class="dorn-auth-word">DORN</div><div class="dorn-auth-rule"></div><div class="dorn-auth-kicker">INTELLIGENT WORKSYSTEM</div><p class="dorn-auth-copy">Una sola cuenta DORN AI abre toda la suite: AI, Design, Editor, Education, Machine y Studio 3D. DORN Admin conserva una identidad independiente y privada para el operador.</p></section><section class="dorn-auth-panel">${content}</section>`;
  }

  function serverWarning() {
    if (status?.serverReachable !== false) return "";
    return `<div class="dorn-auth-server">DORN Admin no está disponible en <strong>${escapeHtml(status.server)}</strong>. Abre DORN Admin o <button data-server-config>cambia la dirección</button>.</div>`;
  }

  function bindServerButton() {
    root.querySelector("[data-server-config]")?.addEventListener("click", async () => {
      const value = window.prompt("Dirección del servidor DORN Admin", status.server);
      if (!value) return;
      try { status = await window.dorn.auth.configureServer(value); welcome(); } catch (error) { window.alert(error.message || String(error)); }
    });
  }

  function welcome() {
    shell(`<div class="dorn-auth-card"><div class="dorn-auth-eyebrow"><i></i>IDENTIDAD DORN</div><h1>Bienvenido a DORN</h1><p>Inicia sesión o crea tu identidad para continuar al espacio de trabajo.</p>${serverWarning()}<div class="dorn-auth-actions"><button class="dorn-auth-button primary" data-google>Continuar con Google</button><button class="dorn-auth-button" data-email>Continuar con correo electrónico</button><div class="dorn-auth-divider">O ELIGE UNA OPCIÓN</div><button class="dorn-auth-button" data-login>Iniciar sesión</button><button class="dorn-auth-button" data-register>Crear cuenta</button></div><div class="dorn-auth-error"></div></div>`);
    bindServerButton();
    root.querySelector("[data-google]").onclick = google;
    root.querySelector("[data-email]").onclick = emailChoice;
    root.querySelector("[data-login]").onclick = login;
    root.querySelector("[data-register]").onclick = registerStepOne;
  }

  function emailChoice() {
    shell(`<div class="dorn-auth-card"><button class="dorn-auth-back">← Volver</button><div class="dorn-auth-eyebrow"><i></i>CORREO ELECTRÓNICO</div><h1>¿Cómo quieres continuar?</h1><p>Usa una cuenta existente o crea una nueva identidad DORN.</p><div class="dorn-auth-actions"><button class="dorn-auth-button primary" data-login>Iniciar sesión</button><button class="dorn-auth-button" data-register>Crear cuenta</button></div></div>`);
    root.querySelector(".dorn-auth-back").onclick = welcome;
    root.querySelector("[data-login]").onclick = login;
    root.querySelector("[data-register]").onclick = registerStepOne;
  }

  function login() {
    shell(`<form class="dorn-auth-card"><button type="button" class="dorn-auth-back">← Volver</button><div class="dorn-auth-eyebrow"><i></i>SESIÓN SEGURA</div><h1>Iniciar sesión</h1><p>Accede a tu espacio mediante DORN Admin.</p>${serverWarning()}<div class="dorn-auth-fields"><label class="dorn-auth-field">Correo electrónico<input name="email" type="email" autocomplete="email" required></label><label class="dorn-auth-field">Contraseña<input name="password" type="password" autocomplete="current-password" required></label></div><div class="dorn-auth-options"><label><input name="maintainSession" type="checkbox" checked> Mantener sesión iniciada</label></div><button class="dorn-auth-button primary">Iniciar sesión</button><div class="dorn-auth-error"></div></form>`);
    bindServerButton();
    root.querySelector(".dorn-auth-back").onclick = welcome;
    const form = root.querySelector("form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const error = form.querySelector(".dorn-auth-error");
      error.textContent = "";
      try {
        const values = Object.fromEntries(new FormData(form));
        status = await window.dorn.auth.login({ email: values.email, password: values.password, maintainSession: form.elements.maintainSession.checked });
        await authenticated();
      } catch (failure) { error.textContent = failure.message || String(failure); }
    };
  }

  function validateRegistration(email, password, confirmation) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Ingresa un correo electrónico válido.");
    if (password.length < 8 || password.length > 256) throw new Error("Usa entre 8 y 256 caracteres. Las mayúsculas son opcionales.");
    if (password !== confirmation) throw new Error("Las contraseñas no coinciden.");
  }

  function registerStepOne() {
    shell(`<form class="dorn-auth-card"><button type="button" class="dorn-auth-back">← Volver</button><div class="dorn-auth-eyebrow"><i></i>CREAR CUENTA · PASO 1 DE 2</div><h1>Protege tu identidad DORN AI</h1><p>Esta cuenta será válida para toda la suite. Puedes usar el mismo correo en DORN Admin porque la cuenta del operador es independiente.</p>${serverWarning()}<div class="dorn-auth-fields"><label class="dorn-auth-field">Correo electrónico<input name="email" type="email" autocomplete="email" required></label><label class="dorn-auth-field">Contraseña<input name="password" type="password" minlength="8" maxlength="256" autocomplete="new-password" required><small>8 caracteres como mínimo; no es obligatorio usar mayúsculas.</small></label><label class="dorn-auth-field">Confirmar contraseña<input name="confirmation" type="password" minlength="8" maxlength="256" autocomplete="new-password" required></label><label class="dorn-auth-field">Código de invitación (si corresponde)<input name="invitationCode" autocomplete="off" maxlength="128"></label></div><div class="dorn-auth-options"><label><input name="maintainSession" type="checkbox" checked> Mantener sesión iniciada</label></div><button class="dorn-auth-button primary">Siguiente</button><div class="dorn-auth-error"></div></form>`);
    bindServerButton();
    root.querySelector(".dorn-auth-back").onclick = welcome;
    const form = root.querySelector("form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      try {
        validateRegistration(values.email, values.password, values.confirmation);
        pendingRegistration = { email: values.email.trim(), password: values.password, invitationCode: String(values.invitationCode || "").trim(), maintainSession: form.elements.maintainSession.checked };
        await registrationTransition();
        registerStepTwo();
      } catch (failure) { form.querySelector(".dorn-auth-error").textContent = failure.message || String(failure); }
    };
  }

  async function registrationTransition() {
    const messages = ["Preparando tu espacio", "Creando tu identidad", "Bienvenido a DORN"];
    for (const message of messages) {
      shell(`<div class="dorn-auth-card dorn-auth-transition"><div><span></span><strong>${message}</strong><small>DORN ADMIN · IDENTIDAD SEGURA</small></div></div>`);
      await delay(720);
    }
  }

  function registerStepTwo() {
    shell(`<form class="dorn-auth-card"><button type="button" class="dorn-auth-back">← Volver</button><div class="dorn-auth-eyebrow"><i></i>CREAR CUENTA · PASO 2 DE 2</div><h1>¿Cómo quieres que DORN te llame?</h1><p>Es solamente tu nombre visible. Puede repetirse: distintas personas pueden usar el mismo nombre.</p><div class="dorn-auth-fields"><label class="dorn-auth-field">Nombre visible<input name="displayName" maxlength="120" autocomplete="name" autofocus required></label></div><button class="dorn-auth-button primary">Crear cuenta</button><div class="dorn-auth-error"></div></form>`);
    root.querySelector(".dorn-auth-back").onclick = registerStepOne;
    const form = root.querySelector("form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (registrationInFlight) return;
      const displayName = String(new FormData(form).get("displayName") || "").trim();
      if (!displayName) { form.querySelector(".dorn-auth-error").textContent = "Escribe el nombre que DORN utilizará."; return; }
      registrationInFlight = true;
      const submit = form.querySelector("button[type='submit'], button.dorn-auth-button.primary");
      submit.disabled = true;
      try {
        const result = await window.dorn.auth.register({ ...pendingRegistration, displayName });
        if (result?.verificationRequired) {
          pendingRegistration.displayName = displayName;
          pendingRegistration.expiresAt = result.expiresAt || null;
          verifyEmailStep(result.message);
          return;
        }
        status = result;
        pendingRegistration = null;
        await authenticated();
      } catch (failure) {
        form.querySelector(".dorn-auth-error").textContent = failure.message || String(failure);
        submit.disabled = false;
      } finally {
        registrationInFlight = false;
      }
    };
  }

  function verifyEmailStep(message = "") {
    shell(`<form class="dorn-auth-card"><button type="button" class="dorn-auth-back">← Volver</button><div class="dorn-auth-eyebrow"><i></i>VERIFICAR CORREO</div><h1>Ingresa los 6 dígitos</h1><p>${escapeHtml(message || `Enviamos un código a ${pendingRegistration.email}.`)}</p><div class="dorn-auth-fields"><label class="dorn-auth-field">Código de verificación<input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code" autofocus required></label></div><button class="dorn-auth-button primary">Verificar y entrar</button><button type="button" class="dorn-auth-button ghost" data-resend>Reenviar código</button><div class="dorn-auth-error"></div></form>`);
    const form = root.querySelector("form");
    root.querySelector(".dorn-auth-back").onclick = registerStepOne;
    root.querySelector("[data-resend]").onclick = async () => {
      const error = form.querySelector(".dorn-auth-error");
      try {
        const result = await window.dorn.auth.resendVerification({ email: pendingRegistration.email });
        error.textContent = result.message || "Código reenviado.";
      } catch (failure) { error.textContent = failure.message || String(failure); }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      const error = form.querySelector(".dorn-auth-error");
      error.textContent = "";
      try {
        status = await window.dorn.auth.verifyEmail({
          email: pendingRegistration.email,
          code: new FormData(form).get("code"),
          maintainSession: pendingRegistration.maintainSession
        });
        pendingRegistration = null;
        await authenticated();
      } catch (failure) { error.textContent = failure.message || String(failure); }
    };
  }

  async function google() {
    const error = root.querySelector(".dorn-auth-error");
    try {
      error.textContent = "Abriendo Google…";
      const flow = await window.dorn.auth.googleStart();
      shell(`<div class="dorn-auth-card dorn-auth-transition"><div><span></span><strong>Completa el acceso en Google</strong><small>ESTA VENTANA CONTINUARÁ AUTOMÁTICAMENTE</small><button class="dorn-auth-button ghost" data-cancel>Cancelar</button></div></div>`);
      let cancelled = false;
      root.querySelector("[data-cancel]").onclick = () => { cancelled = true; welcome(); };
      const deadline = Date.now() + 10 * 60_000;
      while (!cancelled && Date.now() < deadline) {
        await delay(1800);
        const result = await window.dorn.auth.googlePoll(flow.flowId, true);
        if (result.complete) { status = result.status; await authenticated(); return; }
      }
    } catch (failure) { welcome(); root.querySelector(".dorn-auth-error").textContent = failure.message || String(failure); }
  }

  function loadApplication() {
    if (applicationLoaded) return;
    applicationLoaded = true;
    if (root.isConnected) root.remove();
    const module = document.createElement("script");
    module.type = "module";
    module.src = "./assets/index-CBtOwcb-.js";
    document.body.appendChild(module);
    if (accountControlsEnabled) injectAccountControl();
  }

  function injectAccountControl() {
    const observer = new MutationObserver(() => {
      const footer = document.querySelector(".sidebar-footer");
      if (!footer || footer.querySelector(".dorn-auth-account") || !status?.user) return;
      const button = document.createElement("button");
      button.className = "dorn-auth-account";
      button.innerHTML = `<b>${escapeHtml(status.user.displayName?.slice(0,1).toUpperCase() || "D")}</b><span><strong>${escapeHtml(status.user.displayName)}</strong><small>${escapeHtml(status.user.email)}</small></span>`;
      button.title = "Cerrar sesión de DORN";
      button.onclick = async () => {
        if (!window.confirm("¿Cerrar la sesión de DORN en este equipo?")) return;
        await window.dorn.auth.logout();
        window.location.reload();
      };
      footer.prepend(button);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function authenticated() {
    await window.dorn.auth.activity();
    loadApplication();
  }

  if (!authenticationEnabled) {
    loadApplication();
    return;
  }

  let activityTimer = 0;
  ["pointerdown", "keydown", "wheel", "focus"].forEach((eventName) => window.addEventListener(eventName, () => {
    const current = Date.now();
    if (current - activityTimer < 10_000) return;
    activityTimer = current;
    void window.dorn.auth.activity();
  }, { passive: true, capture: true }));
  window.addEventListener("error", (event) => void window.dorn.auth.reportError({ kind: "renderer", component: "DORN AI renderer", message: event.message, stack: event.error?.stack || "" }));
  window.addEventListener("unhandledrejection", (event) => void window.dorn.auth.reportError({ kind: "renderer-promise", component: "DORN AI renderer", message: event.reason?.message || String(event.reason), stack: event.reason?.stack || "" }));

  void (async () => {
    try {
      status = await window.dorn.auth.status();
      if (status.authenticated) await authenticated(); else welcome();
    } catch (error) {
      status = { server: "DORN Admin", serverReachable: false };
      welcome();
      root.querySelector(".dorn-auth-error").textContent = error.message || String(error);
    }
  })();
})();
