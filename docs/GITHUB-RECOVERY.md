# Recuperación desde GitHub

## Capa 1: fuente versionada

Clona el repositorio privado, selecciona el commit deseado y ejecuta:

```powershell
npm ci --ignore-scripts
npm run verify:source
```

Este gate verifica estructura, sintaxis y las pruebas que no dependen de
binarios excluidos del historial.

## Capa 2: checkpoint completo

Restaura únicamente desde el paquete DORN aprobado para el mismo commit:

- `build-tools/electron-v37.2.6-win32-x64.zip`;
- `build-tools/zig-linux-x64/`;
- `resources/local-ai/runtime/`;
- payload portable e instalador, sólo cuando se vaya a verificar o publicar.

Compara primero los SHA-256 descritos en `docs/BINARY-DEPENDENCIES.md`. No uses
una versión similar ni reemplaces un hash sin abrir una revisión nueva.

## Gate completo

Con las dependencias fijadas restauradas:

```powershell
node scripts\verify-recovery.cjs
node scripts\verify-runtime-dependencies.cjs
node --test tests\*.test.cjs
```

El resultado aprobado de este checkpoint es 290 pruebas activas, 0 fallos y 1
prueba omitida. La prueba física en Windows 11 y WSL 2 continúa pendiente.

## Regla de recuperación

GitHub conserva fuente e historial. Los binarios viven fuera del historial y se
relacionan por versión y hash. Nunca completes un archivo faltante descargando
o ejecutando contenido mutable sin revisar procedencia y licencia.

