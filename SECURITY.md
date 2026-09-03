# Seguridad de DORN AI

## Reportar una vulnerabilidad

No publiques claves, tokens, archivos personales ni detalles explotables en un
issue público. Usa la opción privada **Security > Report a vulnerability** del
repositorio cuando esté habilitada.

Incluye únicamente:

- versión y sistema operativo;
- componente afectado;
- pasos mínimos para reproducir;
- impacto observado;
- evidencia sin datos personales ni credenciales.

## Credenciales

DORN no debe contener claves de OpenAI, Gemini, GitHub, Supabase ni de ningún
otro proveedor dentro del repositorio, del renderer o del instalador. Usa
variables de entorno o el almacén seguro del sistema operativo. Revoca una
credencial inmediatamente si fue publicada por error.

## Acciones de herramientas

Las operaciones que escriben archivos, ejecutan procesos o controlan hardware
deben mantener alcance explícito, permisos mínimos, registro y posibilidad de
cancelación. Un modelo de IA no equivale por sí solo a autorización.

## Estado actual

`4.0.0-alpha.7` es una versión de desarrollo `PARTIAL`, no una release estable.
El instalador aún requiere validación completa en Windows 11 x64, UAC, WSL y
SmartScreen antes de presentarse como versión pública final.
