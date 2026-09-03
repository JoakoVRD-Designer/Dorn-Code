# DORN AI 4.0.0-alpha.7 · compilación para Windows 11 x64

DORN AI v4 alpha 3 es una edición interna para probar la nueva organización de
la suite antes de DORN 5.0. Conserva el inicio recuperado de v0.4 y el núcleo de
DORN 3, pero vuelve a una navegación más sólida e integra productos separados
que comparten un mismo motor.

Consulta `DORN-V4-CHANGELOG.md` para el detalle y
`ALCANCE-REAL-V4-ALPHA3.md` para conocer los límites reales.

## Qué incluye

- Menú robusto con chats, carpetas, configuración y cambio rápido de
  conversación.
- Panel derecho opcional y persistente.
- Router manual o automático sobre motores realmente configurados.
- Configuración de APIs y servidores locales.
- Catálogo curado con buscador para proveedores en la nube, rutas compatibles
  y motores locales.
- Temas globales y color personalizado aplicado también al inicio.
- Eliminación de chats y desconexión de carpetas sin borrar los originales.
- Imágenes con miniatura y detección SHA-256 de adjuntos repetidos.
- Historial, ramas, exportación y acciones sobre respuestas.
- Creación y modificación aprobada de archivos dentro de proyectos conectados.
- Scripts en Desarrollador con vista previa y confirmación.
- DORN Design con selección, pincel, línea, imagen, capas y transferencia PNG.
- DORN Education con enseñanza, práctica y simulacro original estilo PAES M1.
- DORN Machine como base segura para integrar dispositivos mediante conectores.

## Productos

DORN AI, Design, Editor, Education y Machine pueden abrirse desde Productos o con
accesos directos independientes. Comparten el runtime, almacenamiento y puente
seguro para no duplicar innecesariamente cientos de megabytes.

DORN Studio3D permanece señalado como desarrollo para DORN 5.0. La versión
actual no lo presenta como un reemplazo terminado de Cinema 4D o una suite CAD.

## Modelos locales y APIs

La aplicación no incluye un modelo generativo de cientos o miles de megabytes
oculto dentro del instalador. Incluye el runtime local y permite revisar,
descargar y verificar modelos compatibles desde el catálogo. Una API comercial
requiere la clave y las condiciones de su proveedor.

El catálogo orienta; no afirma contener literalmente todas las IA existentes.
Los nombres, licencias, precios, cuotas y modelos cambian y deben revisarse en
la documentación oficial de cada proveedor.

## Ejecutar el editable

Requiere Node.js 22 o superior:

```powershell
node tools\restore-github-assets.cjs
npm ci
npm run verify
npm start
```

El primer comando sólo es necesario en una copia obtenida desde GitHub. Valida
el paquete de imágenes, fuentes, audio e iconos mediante SHA-256 antes de
restaurarlo y se niega a sobrescribir un activo modificado.

## Verificar el portable

```powershell
node scripts\verify-windows-runtime.cjs `
  "C:\ruta\DORN_AI_Windows_4.0.0-alpha.7_Portable"
```

La comprobación rechaza un `.exe` truncado, otra arquitectura, archivos
faltantes, un runtime distinto de Electron 37.2.6 o hashes que no coincidan.

## Recompilar

`RECOMPILAR-WINDOWS.md` explica cómo reconstruir `app.asar`, el portable y el
instalador. El archivo oficial de Electron para Windows x64 se conserva en
`build-tools` dentro del respaldo editable.

El instalador principal de alpha 3 es código nativo editable en
`installer/native`. Se compila desde Linux con el Zig incluido, valida el ZIP
interno mediante SHA-256 y puede comprobarse de forma extraíble con
`scripts/verify-native-installer.cjs`. El proyecto NSIS continúa disponible como
constructor alternativo para Windows.

## Límites honestos

- La aplicación y el instalador todavía no tienen firma comercial de código.
- Falta una prueba visual y de audio final en un equipo Windows 11 x64 físico.
- Cuenta, sincronización pública y marketplace requieren un servidor real.
- Machine necesita hardware, protocolo y SDK autorizados para ejecutar acciones
  físicas.
- Education usa contenido original; no redistribuye pruebas oficiales.
- El frontend principal recuperado continúa como JavaScript/CSS compilado y
  debe migrarse gradualmente a TypeScript mantenible.

No borres `resources/local-ai`: contiene el runtime local. El proyecto no
incluye ni modifica `.env`, claves API, tokens o credenciales personales.
