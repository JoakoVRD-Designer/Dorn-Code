# Instalador de DORN AI

Proyecto editable del instalador de DORN AI 4.0.0-alpha.7 para Windows x64.
La identidad visual combina grafito, plata y un bosque tecnológico propio. El
panel izquierdo utiliza `assets/dorn-installer-forest.bmp`; el instalador nativo
dibuja luces en movimiento sobre el recurso sin depender de un reproductor GIF.

## Instalador principal verificado

La entrega alpha 7 utiliza un instalador nativo propio, compilado como PE32+ x64
desde `native/dorn-installer.c`. No depende de Electron para mostrar el asistente
ni de NSIS para reconstruirse. El ejecutable contiene un ZIP real y un tráiler
`DORNZIP3` con tamaño y SHA-256; antes de copiar un archivo vuelve a calcular el
hash completo.

## Qué hace

- Instala por usuario en `%LOCALAPPDATA%\Programs\DORN AI`, sin pedir
  privilegios de administrador.
- Permite elegir la carpeta.
- Crea accesos directos opcionales para DORN AI, Design, Editor, Education y Machine.
- Registra DORN AI en Aplicaciones instaladas.
- Escribe un desinstalador real.
- Conserva por defecto conversaciones, preferencias y modelos al desinstalar.
- Rechaza ARM64 en esta entrega para no instalar una compilación incompatible.
- Inicia DORN AI opcionalmente al finalizar.
- Rechaza antes de empaquetar cualquier `DORN AI.exe` truncado, de otra
  arquitectura o mezclado con otra versión de Electron.
- Verifica el ZIP interno con SHA-256 antes de extraerlo.
- Rechaza carpetas no vacías que no demuestren ser una instalación DORN exacta.
- Registra un manifiesto SHA-256 de todos los archivos, sin rutas duplicadas para Windows.
- Actualiza mediante respaldo de la instalación anterior y rollback si falla la nueva copia.
- Registra un desinstalador nativo PE32+ x64 y conserva los datos del perfil.
- El desinstalador sólo borra cuando su ubicación coincide con el registro de Windows,
  su manifiesto de propiedad y el conjunto exacto de archivos; una copia movida se bloquea.
- DORN AI siempre se instala; la selección de productos controla sus accesos
  independientes. En esta alpha los productos todavía comparten `app.asar`.

## Compilar desde Linux

El editable incluye el compilador Zig bloqueado y su licencia. Con el portable
ya ensamblado:

```bash
./installer/build-native-installer.sh \
  "/ruta/DORN_AI_Windows_4.0.0-alpha.7_Portable" \
  "/ruta/DORN_AI_Setup_4.0.0-alpha.7_x64.exe"
```

Validación extraíble del resultado:

```bash
node scripts/verify-native-installer.cjs \
  "/ruta/DORN_AI_Setup_4.0.0-alpha.7_x64.exe" \
  "/ruta/DORN_AI_Windows_4.0.0-alpha.7_Portable"
```

## Constructor NSIS alternativo para Windows

El proyecto NSIS se conserva como alternativa editable, pero no es el
instalador principal de esta publicación.

1. Instala NSIS 3.x en Windows.
2. Coloca el portable completo en una carpeta.
3. Abre PowerShell en este directorio.
4. Ejecuta:

```powershell
.\build-installer.ps1 -PortablePath "C:\ruta\DORN_AI_Windows_4.0.0-alpha.7_Portable"
```

El resultado se guarda en `output`.

## Cambiar el diseño

- `native/dorn-installer.c`: interfaz grafito, textos, opciones, progreso,
  animación, instalación y desinstalación del instalador principal.
- `native/dorn-installer.rc`: icono, versión y metadatos visibles en Windows.

- `assets/dorn-sidebar.svg`: lateral de bienvenida y final.
- `assets/dorn-header.svg`: cabecera de las páginas.
- `../resources/startup/dorn-logo-official-source.ico`: fuente canónica exacta
  del símbolo externo entregado por el usuario.
- `assets/dorn-installer.ico`: derivado multirresolución usado por Windows,
  NSIS, el desinstalador y los accesos directos.
- `assets/dorn-installer-icon.svg`: recurso histórico conservado, no usado como
  fuente de la identidad oficial actual.
- `assets/dorn-installer-preview.svg`: maqueta visual.
- `assets/dorn-installer-forest.png`: fuente visual generada para esta versión.
- `assets/dorn-installer-forest.bmp`: recurso compilable del bosque tecnológico.
- Los `.bmp` y `.ico` son los recursos compilados que consume NSIS.
- Los textos y la página oscura de bienvenida están en `dorn-installer.nsi`.
- `reference/DORN_Presentacion_Animada.html` conserva la referencia visual.

Los tamaños de los BMP no deben cambiar:

- lateral: 164 × 314 px;
- cabecera: 150 × 57 px.

## Límites honestos

El instalador no está firmado digitalmente porque el proyecto todavía no tiene
un certificado de firma de código. Windows puede mostrar el editor como
desconocido. Eso no debe confundirse con un error de arquitectura. El
runtime oficial bloqueado mide 205.883.904 bytes antes de personalizarlo o
firmarlo; el verificador también revisa todas sus secciones PE. El resto del
programa vive en `resources\app.asar` y en recursos separados, por lo que el
tamaño del archivo `.exe` no representa por sí solo todas las funciones.
El flujo visual, el selector de carpetas, PowerShell y los accesos directos aún
deben probarse manualmente en un escritorio Windows 11 x64 antes de publicación.
