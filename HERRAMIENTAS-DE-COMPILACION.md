# Herramientas utilizadas para DORN AI 4.0.0-alpha.3

Este registro separa las herramientas realmente ejecutadas en Linux de los
programas externos que DORN sólo puede conectar cuando el usuario los instala.

## Ejecutadas en Linux

| Herramienta | Versión comprobada | Uso en esta entrega |
|---|---:|---|
| GNU/Linux x64 + Bash | 5.2.21 | Orquestación reproducible, empaquetado y comprobaciones. |
| Node.js | 24.14.0 | Proceso principal, scripts, SQLite integrado y pruebas. El proyecto conserva compatibilidad declarada desde Node 22. |
| npm | 11.9.0 | Dependencias bloqueadas y árbol de producción de `app.asar`. |
| Electron | 37.2.6 | Runtime de desarrollo y distribución oficial win32-x64. |
| `@electron/asar` | 4.2.1 | Construcción y extracción verificable de `app.asar`. |
| Node test runner | incluido en Node | 85 pruebas automatizadas de esta compilación. |
| Zig | 0.12.0-dev.1286 | Compilación cruzada del instalador y desinstalador PE32+ x64. |
| Clang/LLD de Zig | incluido | Enlace Win32, recursos, icono y metadatos de versión. |
| Info-ZIP `zip` / `unzip` | 3.0 / 6.00 | Payload comprimido del instalador y extracción de verificación. |
| Inkscape | 1.2.2 | Render de SVG del instalador, iconos y recursos visuales. |
| ImageMagick | 6.9.12-98 | Inspección de tamaño, canales, contraste y exportaciones de imagen. |
| GNU objdump | Binutils 2.42 | Subsistema, arquitectura e importaciones de ejecutables Windows. |
| SHA-256 de coreutils/Node | local | Bloqueo de runtime, payload, entregas y archivos críticos. |

La interfaz principal usa JavaScript/React compilado y CSS; Studio3D incorpora
Three.js 185 y sus cargadores con las licencias vendorizadas. La aplicación usa
`node:sqlite` para almacenamiento local.

## No ejecutadas como integración real en este entorno

SolidWorks, AutoCAD, Fusion 360, Cinema 4D, Roblox Studio, Blender y otros
programas no fueron simulados. DORN conserva contratos, detección o puentes
preparados, pero cada integración necesita la aplicación instalada, su licencia
y su API, SDK o protocolo oficial. Open CASCADE y Assimp figuran como motores
posibles para conectores futuros; no se presentan como motores incluidos en
esta publicación.

Tampoco se ejecutó la interfaz en un escritorio Windows 11 físico. Los binarios
se validaron por estructura PE, hashes, extracción del instalador y smoke del
proceso principal. La prueba visual, audio real, micrófono, accesos directos,
PowerShell y desinstalación deben confirmarse en Windows antes de publicar.
