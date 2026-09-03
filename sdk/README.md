# DORN SDK · 3.0 alpha

Este SDK documenta los dos puntos de extensión activos de DORN AI:

- `plugins/`: comandos que se ejecutan dentro del worker restringido de DORN.
- `bridge/`: adaptadores para aplicaciones externas como motores 3D, CAD o render.
- `installer-plugins/`: contrato de hooks y permisos para DORN Installer Studio.

Un plugin no recibe `process` ni `require`. Un adaptador Bridge sí es un programa externo y conserva los permisos de la cuenta de Windows; por eso DORN exige revisión de ejecutable, hash y capacidades antes de habilitarlo.

Los paquetes se instalan desactivados y necesitan aprobación explícita.

El directorio `bridge/` incluye además el contrato CAD neutral, su esquema de
operaciones y una matriz honesta de dependencias para Open CASCADE, Assimp,
Cinema 4D, SolidWorks y Fusion 360.
