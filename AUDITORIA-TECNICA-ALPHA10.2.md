# Auditoría técnica de DORN AI 3.0.0-alpha.10.2

Fecha: 30 de julio de 2026  
Objetivo: resolver el rechazo de Windows, comprobar el paquete completo y
separar funciones reales, parciales y pendientes.

## Resultado ejecutivo

Las entregas alpha.9, alpha.10 y alpha.10.1 no debían publicarse: su
`DORN AI.exe` medía 56.754.176 bytes, pero la tabla PE exigía al menos
225.733.632 bytes. Le faltaban 168.979.456 bytes o más. Además, sus DLL y
recursos no coincidían con Electron 37.2.6.

Alpha.10.2 reemplaza el runtime completo por el artefacto oficial
`electron-v37.2.6-win32-x64.zip`. El nuevo `DORN AI.exe`:

- mide 205.883.904 bytes;
- es PE32+ x64;
- contiene 14 secciones completas;
- tiene SHA-256
  `582c6eeaac0b32d7f78cfe5e225854a3cfe38ff16d725f41f590c20800054375`.

## Fallos encontrados y resolución

| Hallazgo | Impacto | Resolución |
|---|---|---|
| Ejecutable Electron truncado | Windows mostraba “Esta aplicación no puede ejecutarse en el equipo” antes de iniciar DORN | Sustitución por runtime oficial completo |
| Runtime mezclado | EXE, DLL, PAK y snapshots pertenecían a compilaciones distintas | Sustitución de todos los archivos del runtime |
| Sólo se probaba JavaScript | 46 pruebas podían pasar aunque el PE estuviera roto | Analizador PE y manifiesto SHA-256 obligatorios |
| Fallos anteriores al log | Una dependencia ausente podía cerrar DORN sin explicación | `bootstrap.js` y `dorn-bootstrap.log` |
| Iconos solicitados ausentes | La bandeja podía fallar y Windows usaba iconografía genérica | Iconos incluidos en app, recursos y accesos directos |
| Cadena `archiver` 7 vulnerable | Siete avisos altos de denegación de servicio | Migración a `archiver` 8; auditoría final con 0 avisos |
| Recompilación difícil | El editable no reconstruía un ASAR de producción limpio | Constructor reproducible y runtime oficial bloqueado |

## Pruebas realizadas

- 51 de 51 pruebas de regresión aprobadas.
- Todas las dependencias directas y transitivas de arranque cargadas.
- Auditoría npm de producción: 0 vulnerabilidades conocidas.
- Smoke del proceso principal con Electron 37.2.6:
  SQLite, DORN Suite Core y dos ventanas creadas.
- `app.asar` extraído y probado.
- Portable verificado mediante arquitectura, secciones, versión y manifiesto.
- Instalador comprobado por NSIS/7-Zip, extraído y comparado byte por byte.
- Runtime de llama.cpp: ejecutables PE32+ x64 completos.
- Catálogo oficial de cinco Qwen3 con revisiones y SHA-256 bloqueados.

## Peso real

El peso no se utiliza como indicador de calidad, pero sí permite detectar la
truncación anterior:

- `DORN AI.exe`: 205.883.904 bytes.
- `app.asar`: aproximadamente 25,2 MB.
- Portable completo: aproximadamente 379 MB sin comprimir.
- Instalador: aproximadamente 101 MB gracias a LZMA sólida.
- DORN Local incluye llama.cpp, pero los modelos GGUF se descargan después de
  elegirlos; el modelo inicial Qwen3 0.6B Q8 añade 639.446.688 bytes.

Incluir todos los modelos dentro del instalador superaría 19 GB y duplicaría
datos que el usuario quizá no necesita. Por diseño, DORN instala el motor y
permite elegir un modelo verificado según RAM y disco.

## Funciones reales verificadas

- Conversaciones, ramas, historial, búsqueda, anclado, archivo, exportación y
  borrado confirmado.
- Modos manual y automático con recomendación y confirmación.
- DORN Core para identidad, seguridad, emergencias y configuración.
- DORN Local con descarga reanudable, tamaño, SHA-256, selección y
  `llama-server`.
- Proveedores personalizables y guías para API.
- Proyectos, memoria, permisos, acciones de archivos, terminal y restauración.
- Nueve roles de agentes y siete modos.
- Catálogo, preferencias, Gamers, Colores y apariencia compartida.
- DORN Design y DORN Editor como bases separadas conectadas.
- Studio3D como inspector/visor OBJ, STL, PLY, glTF y GLB.
- Plugins aislados, Bridge, Doctor, respaldos, voz de salida, colaboración
  local y Installer Engine.

## Funciones parciales

- DORN Design no sustituye todavía a una suite gráfica industrial.
- DORN Editor no codifica un video final hasta integrar FFmpeg validado.
- Studio3D es un producto separado conectado, pero aún no es un reemplazo de
  Cinema 4D.
- Installer Studio tiene manifiestos y contrato de plugins, no un host visual
  completo.
- Los agentes preparan y ejecutan acciones dentro de proyectos autorizados;
  no poseen acceso silencioso a todo Windows.
- La matriz del Word mantiene 149 requisitos en estados parciales y tres
  pendientes. No se presentan como terminados.

## Pendiente que requiere otro entorno o recursos oficiales

- Inicio, audio, animación, GPU e instalador vistos en un Windows 11 x64 físico.
- Certificado comercial de firma de código para eliminar “Editor desconocido”.
- Descargar y ejecutar cada GGUF completo en varios niveles de hardware.
- Credenciales reales para APIs, OAuth y servicios del usuario.
- Servidor público, sincronización de cuenta y marketplace.
- SDK/licencia oficial para SolidWorks, Fusion 360 y Cinema 4D.
- Motores industriales de CAD, render, video y virtualización.
- Reconstrucción del frontend original en TypeScript/TSX.

## Regla de publicación

Una compilación no se publica si falla cualquiera de estas comprobaciones:

1. 51 pruebas.
2. Auditoría de dependencias.
3. Smoke del proceso principal.
4. Integridad PE del EXE.
5. Manifiesto del runtime.
6. Extracción y comparación del instalador.

DORN 5.0 sigue siendo la futura versión pública. Alpha.10.2 continúa siendo una
versión interna de desarrollo.
