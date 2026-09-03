# Recompilar DORN AI v4 para Windows x64

Esta guía produce el editable, `app.asar`, portable e instalador de
DORN AI 4.0.0-alpha.3 sin reutilizar ejecutables truncados.

## Requisitos

- Linux x64 para reproducir el instalador nativo incluido, o Windows 11 x64
  para las pruebas finales.
- Node.js 22 o superior.
- npm, `zip`, `unzip` e Inkscape para regenerar la maqueta visual.
- Zig 0.12.0-dev.1286 incluido en `build-tools/zig-linux-x64`.
- NSIS 3.x es opcional y sólo se usa con el constructor alternativo.
- `electron-v37.2.6-win32-x64.zip`, incluido en `build-tools`.

El SHA-256 exigido para el ZIP oficial es:

```text
f7732d90dc70b9c7415a06f97f47f1ad45af8d6d89f557f6b00cee613f9a508e
```

## 1. Verificar el proyecto

```powershell
npm ci
npm run verify
```

El resultado esperado en esta entrega es 85 pruebas aprobadas y cero fallidas.

## 2. Crear app.asar

```powershell
npm run pack:asar
```

El constructor prepara un árbol temporal, instala solo dependencias de
producción y genera `dist\app.asar`.

## 2.1 Crear el editable completo

```powershell
npm run pack:editable -- "C:\salida\DORN_AI_Windows_4.0.0-alpha.3_Editable.zip"
```

Este empaquetador conserva `node_modules` completo, incluyendo las carpetas
`dist` internas de Electron y de las herramientas de compilación. Sólo omite
las cachés y resultados temporales de la raíz. El proceso se detiene si el
runtime de Electron está ausente o truncado, o si falta `dist\app.asar`.

## 3. Ensamblar el portable

Extrae `build-tools\electron-v37.2.6-win32-x64.zip` en una carpeta nueva y
ejecuta:

```powershell
node scripts\assemble-windows-portable.cjs `
  "C:\ruta\electron-37.2.6-win32-x64" `
  "dist\app.asar" `
  "C:\salida\DORN_AI_Windows_4.0.0-alpha.3_Portable"
```

Comprueba el resultado:

```powershell
node scripts\verify-windows-runtime.cjs `
  "C:\salida\DORN_AI_Windows_4.0.0-alpha.3_Portable"
```

El ejecutable esperado mide 205.883.904 bytes y debe ser PE32+ x64 con 14
secciones completas. Las funciones viven principalmente en
`resources\app.asar`; no copies o ejecutes únicamente el `.exe`.

## 4. Crear el instalador nativo principal

```bash
./installer/build-native-installer.sh \
  "/salida/DORN_AI_Windows_4.0.0-alpha.3_Portable" \
  "/salida/DORN_AI_Setup_4.0.0-alpha.3_x64.exe"
```

El constructor compila interfaz y desinstalador PE32+ x64, comprime el portable
y añade un tráiler `DORNZIP3` con tamaño y SHA-256. Comprueba el resultado:

```bash
node scripts/verify-native-installer.cjs \
  "/salida/DORN_AI_Setup_4.0.0-alpha.3_x64.exe" \
  "/salida/DORN_AI_Windows_4.0.0-alpha.3_Portable"
```

El constructor NSIS alternativo permanece en `installer/build-installer.ps1`
para equipos Windows con NSIS 3.x instalado.

## 5. Validar en Windows 11

1. Extrae completamente el portable.
2. Ejecuta `VALIDAR-Y-ABRIR-DORN.cmd`.
3. Comprueba animación, sonido, colores y apertura individual de AI, Design,
   Editor, Education y Machine.
4. Instala en una ruta nueva.
5. Confirma los cinco accesos directos seleccionables y la desinstalación.

La firma de código necesita un certificado emitido al editor. Sin él,
SmartScreen puede mostrar “Editor desconocido”; eso es distinto de un
ejecutable truncado o incompatible.
