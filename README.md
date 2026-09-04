# DORN AI Desktop

Repositorio privado de desarrollo de DORN AI para Windows 11 x64.

DORN es un entorno de creación asistido por múltiples inteligencias artificiales. Conserva proyectos, memoria, evidencia y recuperación; coordina proveedores y agentes; y utiliza DORN Linux sobre WSL 2 como entorno administrado para toolchains y Work Units aisladas.

## Checkpoint actual

- Producto: DORN AI Desktop.
- Versión: `4.0.0-alpha.7`.
- Instalador: Installer v3 nativo x64.
- Estado: `PARTIAL`.
- Pruebas completas: `290` aprobadas, `0` fallidas y `1` omitida.
- Último límite obligatorio: prueba física en Windows 11 con WSL 2, reparación y desinstalación.

## Capacidades demostradas

- Aplicación Electron única con identidad DORN 4.0 preservada.
- Proyectos durables, Jobs, Worktrees, Evidence y rollback.
- Registro de proveedores, rutas, modelos y credenciales separadas.
- Coordinación multiagente con propiedad temporal y comparación independiente.
- DORN Linux P0: detección WSL 2, toolchain observado y Node limitado a Work Units.
- Installer v3 transaccional con verificación de payload, reparación y reversión.
- DORN Design, Editor, Education, Machine y Studio3D como espacios de la misma aplicación.

## Recuperar el checkout de fuente

Requiere Node.js 22 o superior:

```powershell
npm ci --ignore-scripts
npm run verify:source
```

El repositorio no almacena Electron, Zig, `node_modules`, modelos, ejecutables de llama.cpp, payloads ni instaladores compilados. Consulta [`docs/GITHUB-RECOVERY.md`](docs/GITHUB-RECOVERY.md) para restaurar el checkpoint completo mediante sus versiones y hashes.

## Construcción completa

La construcción reproducible requiere además los binarios fijados en [`docs/BINARY-DEPENDENCIES.md`](docs/BINARY-DEPENDENCIES.md). Con el checkpoint completo restaurado:

```powershell
node scripts\verify-recovery.cjs
node scripts\verify-runtime-dependencies.cjs
node --test tests\*.test.cjs
```

La guía del instalador está en [`installer/README.md`](installer/README.md) y el contrato Linux P0 en [`docs/DORN-PC-LINUX-RUNTIME-P0.md`](docs/DORN-PC-LINUX-RUNTIME-P0.md).

## Seguridad

- No se deben registrar `.env`, claves API, tokens, cookies ni credenciales.
- MCP, Skills, plugins y toolchains se consideran no confiables hasta completar cuarentena, inventario, permisos, pruebas y hash.
- La IA no controla directamente protecciones críticas de maquinaria.
- Ninguna capacidad planificada debe mostrarse como funcional sin evidencia de extremo a extremo.

## Derechos

Código propietario y confidencial. Todos los derechos reservados. Consulta [`LICENSE`](LICENSE).
