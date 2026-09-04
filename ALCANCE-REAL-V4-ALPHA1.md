# Alcance real — DORN AI 4.0.0-alpha.1

## Estado

DORN 4.0 alpha 1 es una compilación interna funcional. No es DORN 5.0 ni una
edición pública final. La entrega prioriza navegación, coherencia visual,
gestión de proyectos y conversaciones, catálogo de IA y bases separadas para
los productos de la futura suite.

## Funciona en esta entrega

- Inicio de DORN AI con animación, sonido configurable y palabra DORN.
- Temas globales con presets y color personalizado seguro.
- Chat, proyectos, historial, adjuntos con miniatura y detección de imágenes
  duplicadas.
- Eliminación de conversaciones y desconexión de carpetas sin borrar los
  originales.
- Panel derecho opcional con preferencia persistente.
- Configuración de proveedores API y servidor local.
- Catálogo curado de proveedores locales y conectados.
- Router manual/automático sobre motores realmente configurados.
- Ejecución de scripts desde Desarrollador con vista previa y confirmación.
- DORN Design con pincel, línea, imágenes y transferencia PNG.
- DORN Education con práctica original estilo PAES M1.
- DORN Machine como base segura de inventario e integración.
- Apertura directa de Design, Education y Machine mediante argumentos y
  accesos directos del instalador.

## No se presenta como terminado

- Studio3D profesional equivalente a una aplicación DCC/CAD.
- Control real de maquinaria sin SDK, hardware y protocolo autorizados.
- Catálogo literalmente exhaustivo de todas las IA existentes.
- Modelos comerciales gratuitos o locales cuando su licencia o proveedor no lo
  permite.
- Cuenta DORN, sincronización pública, marketplace y servidor de producción.
- Firma digital del editor.

## Seguridad

- Electron mantiene `contextIsolation`, sandbox, CSP y navegación externa
  restringida.
- Las claves se guardan mediante la protección disponible del sistema.
- DORN no concede acceso irrestricto al equipo por defecto.
- Los scripts enseñan su comando y carpeta antes de ejecutar.
- Las acciones físicas quedan en simulación hasta conectar un adaptador real.

## Validación de publicación

Antes de entregar una compilación deben ejecutarse:

```text
npm run verify
ELECTRON_RUN_AS_NODE=1 electron scripts/smoke-main-process.cjs
node scripts/verify-windows-runtime.cjs <portable>
```

También se verifica que `DORN AI.exe` sea PE32+ x64 completo, que el runtime
coincida con Electron 37.2.6 bloqueado y que `resources/app.asar` contenga la
v4 actual.

## Nota de producto

Design, Education y Machine se abren como aplicaciones independientes pero
comparten el runtime firmado, almacenamiento y puente de DORN. Esto sigue el
modelo de una suite: accesos separados sin duplicar innecesariamente el motor.
