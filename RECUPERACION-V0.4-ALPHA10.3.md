# Recuperación de DORN AI v0.4 para Windows 3.0 alpha 10.3

## Separación de productos

**DORN Lite no forma parte de DORN AI 3.0.** Queda reservado como una futura
aplicación independiente para equipos modestos y flujos livianos. Dentro de
DORN AI, Qwen3 0.6B se presenta como **DORN Compact** y Qwen3 1.7B como
**DORN Core**. Son niveles de modelo local, no ediciones distintas del
programa.

## Fuente revisada

Se auditó el paquete recuperado `DORN AI v0.4.zip` sin convertirlo en la base
del proyecto nuevo. El objetivo fue rescatar comportamiento y recursos propios
de DORN sin reintroducir dependencias, binarios o límites de la versión antigua.

Inventario comprobado:

- paquete recuperado: 264.806.152 bytes;
- ejecutable recuperado: 225.733.632 bytes, PE32+ x86-64;
- aplicación interna: `resources/app.asar`, 39.387.041 bytes;
- presentación: `resources/startup/splash.html`, 5.023 bytes;
- firma sonora: `resources/startup/dorn-startup.wav`, 537.644 bytes;
- audio PCM estéreo, 48 kHz, 16 bits y 2,8 segundos;
- runtime local llama.cpp y licencias incluidos.

## Qué ya estaba preservado

La presentación HTML y la firma sonora de alpha 10.2 eran copias exactas de los
recursos recuperados. Sus hashes SHA-256 coinciden:

- splash: `c3a317778a418b24de2a052389b311d404453a9f46438d0580a5c3ec09b90142`;
- audio: `385d89de3803a4d781f5a8a77ba6b25f20a0db82713bc6a258c314e84b6c7aea`.

El núcleo 3.0 también conserva la base funcional de v0.4 y la amplía con
agentes, router, proyectos, preferencias, Design, Editor, Studio 3D, Installer
Engine, pruebas y diagnóstico de arranque.

La comparación estática confirmó:

- 52 funciones principales en v0.4 y 62 en 3.0;
- ninguna función principal de v0.4 ausente en 3.0;
- 41 canales IPC en v0.4 y 63 en 3.0;
- ningún canal IPC de v0.4 eliminado;
- diez funciones principales nuevas para agentes, memoria, exportación,
  productos, Studio 3D, apariencia y recuperación de recursos.

## Problemas reales corregidos

1. El editable buscaba el splash en `build/splash.html`, aunque el recurso real
   estaba en `resources/startup/splash.html`.
2. El editable buscaba llama.cpp en `vendor/local-ai`, una carpeta inexistente,
   en vez de `resources/local-ai`.
3. La ventana animada se creaba después de inicializar la mayoría de módulos.
4. `introAnimation` e `introSound` existían en la base de datos, pero el flujo de
   arranque y el menú no los respetaban de manera completa.
5. El sonido podía recibir varios intentos de reproducción y reiniciarse.
6. La extracción de control de un instalador NSIS monolítico volvió a producir
   un `DORN AI.exe` incompleto, aunque el archivo exterior superaba su CRC.

## Integración realizada

- resolución común de recursos para editable, portable e instalación;
- splash creado inmediatamente después de abrir la configuración local;
- prioridad `alwaysOnTop`, `moveTop` y visibilidad entre escritorios;
- siete segundos mínimos antes de mostrar la interfaz principal;
- reproducción única y comprobable de la firma sonora;
- controles separados para animación y sonido en Configuración;
- indicador minimalista `.  ..  ...`;
- versión real de la compilación visible en la presentación;
- registros explícitos cuando el recurso falta o Windows bloquea el audio;
- almacenamiento del ejecutable en cuatro fragmentos de hasta 64 MiB;
- reconstrucción durante la instalación y comprobación del tamaño exacto;
- pruebas automatizadas para rutas, preferencias, duración y recursos.

## Qué no se reutilizó

No se reemplazó el runtime de Electron 37.2.6 ni se copió el `app.asar` antiguo
sobre la 3.0. Hacerlo habría eliminado funciones nuevas y podría haber
reintroducido vulnerabilidades o incompatibilidades. El recuperado se conserva
como evidencia y referencia histórica, no como dependencia de ejecución.
