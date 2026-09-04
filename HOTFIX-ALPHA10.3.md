# DORN AI 3.0.0-alpha.10.3 — recuperación e integración de v0.4

Esta compilación parte de alpha 10.2 y recupera formalmente la experiencia de
inicio de DORN v0.4.

## Identidad del producto

- DORN Lite queda reservado para una aplicación independiente futura.
- El nivel local de 0.6B se llama DORN Compact.
- El nivel local de 1.7B se llama DORN Core.
- Ningún menú de DORN AI presenta DORN Lite como si fuera un modelo o una
  edición incluida.

Cambios principales:

- animación DORN prioritaria durante siete segundos;
- firma sonora original verificada;
- recursos correctos al ejecutar el proyecto editable;
- DORN Local disponible también desde `npm start`;
- preferencias reales para activar o desactivar animación y sonido;
- indicador de inicio minimalista;
- versión de compilación visible;
- registro de reproducción, bloqueo o ausencia del sonido;
- Electron fijado exactamente en 37.2.6;
- instalador protegido contra truncamiento mediante cuatro fragmentos;
- comprobación obligatoria de 205.883.904 bytes antes de iniciar DORN;
- nuevas pruebas de regresión.

El ejecutable de v0.4 fue utilizado únicamente como fuente de análisis. DORN
3.0 conserva su runtime oficial y su arquitectura modular.
