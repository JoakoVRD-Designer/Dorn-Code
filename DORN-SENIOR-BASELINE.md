# DORN AI 4.0 Senior Baseline

Esta rama de desarrollo toma `DORN AI 4.0.0-alpha.7` como base canónica de
producto e interfaz. DORN 4.9 se utiliza únicamente como fuente auditada de
capacidades internas, pruebas y correcciones recuperables.

## Contrato de preservación

- Conservar la experiencia visual completa de DORN 4.0.
- Conservar el menú principal y la organización accesible de capacidades.
- Conservar temas, paletas, color personalizado, imagen o GIF de fondo,
  intensidad, desenfoque y propagación global de apariencia.
- Conservar el lenguaje visual del instalador Bosque Vivo.
- Mostrar el splash de carga durante exactamente 7.000 ms en un inicio normal.
- Usar el símbolo oficial únicamente como icono externo de aplicación,
  ejecutable, accesos directos, instalador, bandeja y notificaciones.
- Mostrar dentro de DORN, incluido el splash, sólo la identidad tipográfica
  `DORN`; el símbolo externo no forma parte del contenido de la interfaz.
- Mantener la animación fluida: el trabajo pesado se difiere, pagina o ejecuta
  fuera del hilo de interfaz.
- No sustituir el frontend por el renderer de DORN 4.9.

## Regla para mejoras

Una mejora de 4.9 sólo se integra si aporta comportamiento real, conserva el
contrato visual, pasa pruebas y puede revertirse. Toda modificación a archivos
visuales protegidos debe registrarse en
`verification/ui-4.0-change-ledger.json` con hashes anterior/actual, motivo,
pruebas y rollback.

Los ZIP originales 4.0 y 4.9 permanecen fuera de esta copia de trabajo y no se
sobrescriben.

## Meta de cierre continuo

DORN permanece en desarrollo hasta satisfacer todo requisito vigente de los
PDF CURRENT y todo comportamiento 4.0 protegido por este contrato. Una unidad
sólo se cierra cuando cuenta con implementación, regresiones —incluidos intentos
hostiles— y Evidence vinculada a los mismos bytes. Una función existente no se
elimina sin causa técnica documentada, prueba de no regresión y ruta de rollback.

El producto global sólo puede declararse `COMPLETED` cuando no quedan requisitos
`PARTIAL`, `BLOCKED` o `NEEDS_RETEST`, el instalador ha sido probado de extremo a
extremo en Windows 11 y los entregables reconstruyen exactamente los bytes
verificados. Hasta entonces se continúa por unidades recuperables, se preservan
checkpoints y se informa el estado real sin convertir una promesa en evidencia.
