# DORN AI 4.0.0-alpha.7 · Installer v3

Estado: `PARTIAL`  
Plataforma objetivo: Windows 11 x64  
Fecha del checkpoint: 2026-09-03

## Artefactos verificados

| Artefacto | SHA-256 |
|---|---|
| `DORN_AI_Installer_v3_4.0.0-alpha.7_x64.exe` | `b4de51585eaa00e12093e71ffb3b426c8ecbb41a905194d4f37146a76d9e3e0e` |
| `DORN_PC_Installer_v3_Source_Delta_4.0.0-alpha.7.zip` | `4eb4caa637ef661e365e934188d95de354ef99394f230fd997a726a39c2de3df` |

El `.exe` no se guarda en Git porque supera el límite de 100 MB y dañaría la
escalabilidad del historial. Debe adjuntarse como activo de una GitHub Release
o almacenarse en el backend de descargas de DORN. El archivo sólo se considera
válido si coincide con el hash indicado.

## Evidencia

- 290/290 pruebas activas aprobadas.
- Dos builds del instalador idénticos byte por byte.
- Dos builds del delta editable idénticos byte por byte.
- PE32+ x64 validado para instalador y desinstalador.
- Payload y portable verificados contra sus manifiestos.

## Gates pendientes

- instalación y desinstalación completas en Windows 11 x64 físico;
- aceptación y rechazo de UAC;
- preparación y primer arranque de WSL 2 + Ubuntu;
- reparación de una instalación v2 detenida;
- SmartScreen y firma Authenticode de publicación.

Hasta cerrar esos gates no debe etiquetarse como release estable.
