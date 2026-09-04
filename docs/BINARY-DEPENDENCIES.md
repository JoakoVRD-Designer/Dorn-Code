# Dependencias binarias excluidas

| Componente | Revisión fijada | SHA-256 | Estado |
|---|---|---|---|
| Electron Windows x64 | `37.2.6` | `f7732d90dc70b9c7415a06f97f47f1ad45af8d6d89f557f6b00cee613f9a508e` | Requerido para portable |
| Zig Linux x64 | toolchain recuperado | `b3d5e9eec6159a1eac821c38cbadde5bae3b174d31c71232f134218dbd62170d` | Requerido para PE nativo |
| llama.cpp Windows x64 | `b10091` | archivo de origen `b2d991bdd37258bb51309f50e9fb7a52a16fe662ba71b2cbbbbb9303b47b5dee` | Runtime local |
| Installer v3 | `4.0.0-alpha.7` | `b4de51585eaa00e12093e71ffb3b426c8ecbb41a905194d4f37146a76d9e3e0e` | Artefacto de entrega |

`resources/local-ai/manifest.json` conserva modelos, revisiones, tamaños,
licencias y hashes. Los modelos no se incluyen en GitHub ni se activan por el
solo hecho de descargarse.

Antes de usar un binario restaurado, verifica el hash, la licencia y que su
procedencia corresponda al checkpoint. Un cambio crea una revisión nueva y
revoca la evidencia anterior.

