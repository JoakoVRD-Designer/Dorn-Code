# DORN AI 3.0.0-alpha.8 — alcance real

Alpha.8 convierte funciones de conversación que antes sólo existían en el
backend o en el documento maestro en controles visibles y comprobables. La
prioridad de esta etapa es que el historial sea utilizable, reversible y
exportable; no agrega integraciones propietarias ficticias.

## Implementado en esta etapa

- Buscador local por título y vista previa de la conversación.
- Menú por conversación para renombrar, anclar, desanclar, archivar,
  restaurar, duplicar y eliminar.
- Pantalla de archivados separada del historial activo.
- Confirmación nativa antes de eliminar; esa acción no modifica los archivos
  de un proyecto conectado.
- Exportación de conversaciones a Markdown y a JSON versionado
  `dorn-conversation/1`.
- Acciones de respuesta: copiar, regenerar, síntesis de voz, compartir,
  guardar en Markdown y copiar una representación estructurada.
- Valoración local útil/incorrecta, persistida en SQLite.
- Edición y regeneración no destructivas mediante ramas. La conversación
  original permanece intacta.
- Migración de la base local a esquema 4, compatible con historiales creados
  por versiones anteriores.
- APIs nuevas expuestas únicamente mediante el preload aislado; el renderer no
  recibe acceso directo a Node.js, SQLite ni el sistema de archivos.

## Comportamiento de las ramas

Al editar un mensaje del usuario, DORN copia a una nueva conversación sólo el
historial anterior a ese mensaje y coloca el texto en el compositor. Al
regenerar una respuesta, hace lo mismo y vuelve a enrutar el mensaje. Si está
activo el modo manual, presenta la recomendación y espera confirmación antes de
contactar una IA.

## Límites expresos

- La búsqueda actual es local y literal; todavía no es búsqueda semántica.
- Una rama muestra su relación con el original, pero aún no existe una vista
  gráfica para comparar y fusionar ramas.
- Compartir usa el diálogo del sistema cuando está disponible y, en caso
  contrario, copia el contenido. No existe todavía un enlace público porque
  requeriría servidor, autenticación y políticas de privacidad.
- La valoración queda local. No se envía a proveedores ni entrena modelos.
- La lectura usa las voces instaladas en Windows; el reconocimiento de entrada
  y una palabra de activación siguen pendientes de un adaptador autorizado.
- El frontend recuperado sigue siendo un bundle React compilado: es editable,
  pero debe reconstruirse en fuentes TypeScript/TSX antes de una versión
  pública mantenible.
- La ejecución visual completa, los diálogos nativos y la síntesis de voz deben
  validarse finalmente en un equipo Windows 11 x64.

## Pendiente completo en la matriz

- Emulación de Android.
- Segunda versión industrial de Installer Studio.
- Tercera versión con servicios de publicación e infraestructura.

Las 31 pruebas automatizadas comprueban contratos, migración declarada,
aislamiento, rutas de IPC y presencia funcional de los controles. No sustituyen
las pruebas visuales y de instalación en Windows.
