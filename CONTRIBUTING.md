# Contribuir a DORN

## Flujo

1. Crea una rama desde `main`.
2. Define el alcance y conserva el comportamiento estable de DORN 4.0.
3. No añadas dependencias, MCP, Skills o binarios sin revisión de procedencia,
   licencia, permisos, hashes y rollback.
4. Ejecuta `npm ci --ignore-scripts` y `npm run verify:source`.
5. Registra cambios protegidos en el ledger correspondiente.
6. Abre un pull request con evidencia, riesgos y retest pendiente.

Los binarios fijados se restauran sólo para gates de empaquetado. No se aceptan
credenciales, archivos `.env`, datos personales, caches ni artefactos generados.

