# Alcance real de DORN AI 3.0.0-alpha.10

## Resultado de esta etapa

Alpha.10 completa el pendiente más directo de alpha.9: una misma preferencia
visual se aplica a DORN AI, DORN Design, DORN Editor y DORN Studio3D.

La implementación incluye:

- archivo local `dorn-appearance.json` con esquema validado;
- escritura temporal y reemplazo atómico para evitar ajustes incompletos;
- saneamiento de temas, modos y colores antes de persistirlos;
- migración de la preferencia visual guardada por alpha.9;
- difusión en vivo a todas las ventanas abiertas;
- preloads aislados, sin exponer Node.js a las interfaces;
- colores, contraste, densidad y movimiento reducido en Design y Editor;
- fondo WebGL, rejilla, iluminación de borde y selección temática en Studio3D.

## Arquitectura de DORN Studio3D

Studio3D continúa como una aplicación separada pero integrada a la suite.
Comparte identidad, proyectos, apariencia, permisos y contexto con DORN AI, y
su motor sólo se carga cuando la persona abre el producto.

La meta futura puede acercarse a un entorno profesional de modelado, materiales,
animación y render, pero no se copiará código, iconografía ni motores
propietarios de Cinema 4D, SolidWorks, Fusion 360 o Blender. Los formatos
propietarios dependerán de SDK, instalación y licencia oficiales.

## Límites que permanecen

- No se realizó una ejecución visual del EXE en un escritorio Windows 11 desde
  este entorno.
- Las preferencias visuales son locales al computador; no existe sincronización
  mediante cuenta o servidor.
- El frontend principal recuperado continúa siendo JavaScript/CSS compilado de
  React. La reconstrucción mantenible en TypeScript/TSX sigue pendiente.
- Studio3D todavía es un inspector/visor inicial, no un sustituto industrial de
  una aplicación DCC o CAD.
- La matriz conserva 152 puntos: 149 con base parcial y 3 completamente
  pendientes. `Partial` no significa producto final.

DORN 5.0 continúa siendo la edición pública planificada. Alpha.10 es una
compilación interna de desarrollo.
