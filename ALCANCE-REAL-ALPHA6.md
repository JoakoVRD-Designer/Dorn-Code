# DORN AI 3.0.0-alpha.6 — alcance real

Alpha.6 integra una parte amplia del texto final manual del documento maestro,
pero no convierte DORN en un producto industrial terminado. La matriz contiene
152 puntos: 142 poseen bases parciales de distintas etapas y 10 continúan
pendientes.

## Implementado en esta etapa

- Preferencias que realmente cambian las instrucciones del modelo.
- Precarga opcional y reutilización del proceso local.
- Sugerencias de organización por intención.
- Interfaz ampliada para productos, plugins y Installer Studio.
- Instalación local de plugins bajo revisión de permisos.
- Manifiestos visuales exportables de instalador.
- Campo de conversación más amplio.
- Fórmulas KaTeX reconocidas.
- Contratos técnicos CAD para conectar motores reales posteriormente.

## Pendiente

- Android.
- DORN Design y DORN Editor como ejecutables separados.
- SDK de plugins específico de Installer Studio.
- Segunda y tercera fase del Installer Studio.
- Infraestructura pública: OAuth, cuentas, sincronización, marketplace,
  telemetría y publicación.
- Motores y SDK externos.

## Regla de finalización

Una capacidad sólo pasa de parcial a terminada cuando:

1. existe código ejecutable o un motor detectado;
2. produce un resultado real y verificable;
3. tiene permisos, errores y recuperación definidos;
4. pasa pruebas automatizadas;
5. pasa una prueba visual o funcional en Windows cuando corresponda;
6. se incluye en el paquete y puede reproducirse desde el proyecto editable.

Un esquema, botón o contrato por sí solo no convierte una integración externa
en una función terminada.
