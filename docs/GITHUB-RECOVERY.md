# Recuperación de DORN AI desde GitHub

## Alcance del repositorio

GitHub conserva el código editable, scripts, SDK, pruebas, interfaz, instalador
nativo y documentación. No conserva dependencias reconstruibles, toolchains,
modelos, cachés ni binarios de entrega.

Esto evita que el historial crezca con archivos que no se pueden revisar como
código y permite recuperar cada avance mediante commits y ramas.

## Recuperar la fuente

```bash
git clone https://github.com/JoakoVRD-Designer/DORN-AI.git
cd DORN-AI
node tools/restore-github-assets.cjs
npm ci
node scripts/verify-recovery.cjs
npm run verify:runtime
```

El restaurador valida primero `repository-assets/BUNDLE.sha256`, compara el
contenido exacto con `repository-assets/MANIFEST.sha256` y se niega a
sobrescribir cualquier activo que ya tenga cambios locales.

Para abrir la aplicación en modo de desarrollo:

```bash
npm start
```

## Dependencias binarias

- Electron queda fijado en `package-lock.json` y se obtiene mediante `npm ci`.
- llama.cpp queda fijado por versión, origen y SHA-256 en
  `resources/local-ai/manifest.json`.
- Los modelos se descargan desde su origen y deben coincidir con el SHA-256 del
  mismo manifiesto.
- Zig y los instaladores se reconstruyen o adjuntan como artefactos de Release;
  no se guardan dentro del historial Git.
- Imágenes, tipografías, audio e iconos propios se agrupan por checkpoint en
  `repository-assets`; se restauran con el comando anterior y cada archivo
  conserva su SHA-256 individual.

No ejecutes un binario recuperado si su hash no coincide con el manifiesto de
la versión.

## Checkpoint 4.0.0-alpha.7

| Elemento | Estado |
|---|---|
| Código editable | Versionado en GitHub |
| Installer v3 Windows x64 | Artefacto externo; pendiente de adjuntar a Release |
| SHA-256 del instalador | `b4de51585eaa00e12093e71ffb3b426c8ecbb41a905194d4f37146a76d9e3e0e` |
| SHA-256 del delta editable | `4eb4caa637ef661e365e934188d95de354ef99394f230fd997a726a39c2de3df` |
| Pruebas activas del paquete | `290/290` |
| Estado del producto | `PARTIAL` |

## Estrategia de ramas

- `main`: último estado integrado y recuperable.
- `checkpoint/<versión>`: fotografía inmutable de una entrega importante.
- `feature/<capacidad>`: desarrollo aislado.
- `fix/<problema>`: corrección aislada.

Nunca se reescribe `main` con force-push. Un cambio se integra sólo después de
verificarlo y conservar el checkpoint anterior.
