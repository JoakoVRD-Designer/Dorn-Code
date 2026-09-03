# Contrato CAD de DORN Bridge

Este contrato prepara la integración de Open CASCADE, FreeCAD, Assimp y
aplicaciones CAD/DCC autorizadas. No incorpora esos motores ni afirma que sus
formatos estén disponibles.

## Separación obligatoria

- DORN crea un trabajo aislado y copia el archivo de entrada.
- El adaptador recibe únicamente la copia y una operación validada.
- El motor externo trabaja dentro del directorio del trabajo.
- El adaptador devuelve artefactos relativos, métricas y errores estructurados.
- DORN vuelve a verificar ruta, tamaño y SHA-256 antes de ofrecer el resultado.

## Open CASCADE

El adaptador real deberá compilarse desde una versión oficial y conservar su
licencia. Las operaciones iniciales son:

1. `health`: versión, módulos cargados y formatos habilitados.
2. `inspect-brep`: sólidos, shells, caras, aristas, vértices y unidades.
3. `tessellate`: triangulación controlada por tolerancia.
4. `convert-neutral`: STEP, IGES o BREP hacia otro formato permitido.
5. `repair-shape`: análisis y reparación sobre una copia.
6. `measure`: caja envolvente, área, volumen y centro de masa.

La función se considerará disponible sólo cuando exista un binario Windows x64
verificado, un manifiesto Bridge, las licencias correspondientes y pruebas con
archivos sanos, dañados, grandes y maliciosos.

## Aplicaciones propietarias

Cinema 4D, SolidWorks y Fusion 360 deben usar sus APIs oficiales. El adaptador
no puede redistribuir el motor, evadir activación ni copiar funciones internas.
Cada conector debe informar aplicación, versión, licencia, capacidades,
formatos y ubicación del ejecutable autorizado.
