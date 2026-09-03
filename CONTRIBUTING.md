# Contribuir a DORN AI

DORN se desarrolla mediante unidades pequeñas, verificables y recuperables.

## Flujo de trabajo

1. Crea una rama desde `main` con un nombre descriptivo.
2. Limita cada cambio a una capacidad o corrección concreta.
3. No agregues claves, modelos, runtimes, instaladores ni toolchains al historial.
4. Ejecuta las verificaciones de fuente antes de abrir un pull request.
5. Documenta límites, riesgos y pruebas pendientes sin presentarlos como hechos.

```bash
npm ci --ignore-scripts
node scripts/verify-recovery.cjs
npm run verify:runtime
node --test $(find tests -name '*.test.cjs' \
  ! -name 'alpha10.test.cjs' \
  ! -name 'installer-hardening.test.cjs' -print)
```

`alpha10.test.cjs` valida además el runtime PE de Windows, e
`installer-hardening.test.cjs` verifica el toolchain bloqueado. Ambos se
ejecutan en el gate de empaquetado que contiene los binarios verificados.

## Criterios mínimos

- Sin regresiones conocidas en las pruebas afectadas.
- Estados reales; no simular conexión, progreso, telemetría o éxito.
- Ningún secreto en frontend, logs o fixtures.
- Acciones destructivas o físicas con límites y recuperación.
- Dependencias nuevas con procedencia, licencia y versión fijada.
- Documentación coherente con el comportamiento implementado.

Los cambios de licencia, publicación, firma o compatibilidad se deciden de
forma explícita y no se infieren a partir de una contribución.
