# DORN AI 3.0.0-alpha.10.2 — reparación real del ejecutable

## Causa demostrada

El `DORN AI.exe` heredado desde alpha.9 no era un ejecutable completo. El
archivo físico medía 56.754.176 bytes, mientras su cabecera PE declaraba
secciones hasta el byte 225.733.632. Windows lo rechazaba antes de que Electron
pudiera ejecutar el código de DORN; por eso las pruebas JavaScript anteriores
podían aprobar y el programa igualmente no abría.

El resto de sus DLL tampoco coincidía con Electron 37.2.6, la versión declarada
por `package-lock.json`. Era un runtime mezclado y no debía publicarse.

## Solución

- Se descargó la distribución oficial `electron-v37.2.6-win32-x64.zip`.
- Se sustituyó el runtime completo: EXE, DLL, paquetes, snapshots, locales y
  archivos Vulkan.
- El ejecutable íntegro mide 205.883.904 bytes.
- Se incorporó `ELECTRON-RUNTIME.json` con tamaños y SHA-256.
- `verify-windows-runtime.cjs` analiza la tabla PE y todos los hashes antes de
  compilar el instalador.
- `COMPROBAR-DORN.ps1` repite la comprobación en el computador del usuario.
- `bootstrap.js` registra fallos de módulos incluso antes de crear la ventana.
- Los iconos de ventana, bandeja y accesos directos ahora existen en el paquete.
- `archiver` se actualizó a la versión 8; la auditoría de dependencias de
  producción termina con cero vulnerabilidades conocidas.

## Límite de validación

La integridad binaria puede demostrarse sin Windows. El inicio visual, el audio,
la GPU y el flujo del instalador todavía deben probarse en un Windows 11 x64
real. Esta compilación interna no está firmada con certificado comercial.
