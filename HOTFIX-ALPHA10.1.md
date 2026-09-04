# DORN AI 3.0.0-alpha.10.1 — corrección de arranque

## Problema reproducido

La alpha.10 podía cerrarse antes de crear la ventana principal porque el árbol de
dependencias de producción estaba incompleto. `archiver-utils` no contenía archivos
necesarios de `glob` y `minimatch`.

## Corrección

- Se reconstruyeron todas las dependencias de producción desde `package-lock.json`.
- Se dejó de reutilizar el árbol incompleto heredado.
- `npm run verify` ahora carga las dependencias críticas de ejecución y detiene el
  empaquetado si falta una dependencia directa o transitiva.
- Se añadió una prueba de regresión específica.

## Compatibilidad

El portable incluido es para Windows 10/11 con procesador x64. ARM64 necesita una
compilación diferente y no debe presentarse como compatible hasta construirla y
probarla en ese entorno.

## Instalador

La entrega incluye un instalador NSIS por usuario con diseño basado en la
presentación DORN. Permite elegir carpeta, crear accesos directos, iniciar la
aplicación al terminar y desinstalarla. Conserva los datos del usuario salvo
confirmación expresa. Su proyecto visual y técnico se entrega también por
separado para futuras modificaciones.

## Alcance de la comprobación

La carga del proceso principal y sus módulos se verificó con Electron. El
instalador fue compilado, probado como archivo NSIS, extraído y comparado con el
portable. La validación visual final en un escritorio Windows 11 físico continúa
pendiente; no se declara como realizada.
