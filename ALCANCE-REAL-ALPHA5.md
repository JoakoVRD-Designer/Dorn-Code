# DORN AI 3.0.0-alpha.5 — alcance real

## Qué se terminó

Esta entrega convierte los siete perfiles existentes en controles visibles y
conecta dos comportamientos distintos del router:

- **Manual:** DORN recomienda un motor configurado, muestra alternativas y
  espera confirmación.
- **Automático:** DORN aplica la recomendación disponible y comienza el envío.

El Centro de control incorpora un asistente que recibe una necesidad en
lenguaje natural, la clasifica por tipo de trabajo y compara sólo proveedores
instalados o APIs que el usuario haya configurado. También incorpora cinco
temas, densidad, reducción de movimiento y contraste.

## Qué significa “DORN AI”

DORN AI no es un modelo fundacional nuevo en esta etapa. Es la capa de producto
que coordina:

1. DORN Core, para identidad, seguridad y configuración offline.
2. DORN Local, para modelos GGUF ejecutados mediante llama.cpp.
3. APIs externas configuradas por el usuario.
4. El router, que clasifica la tarea y recomienda una opción disponible.
5. Herramientas separadas y autorizadas para trabajar con archivos y proyectos.

La aplicación puede enseñar dónde se configura una API y recomendar capacidades,
pero no puede crear una clave, eliminar sus límites comerciales ni ofrecer como
gratuito un servicio de terceros.

## Dependencias industriales

| Componente | Estado alpha.5 | Requisito para hacerlo real |
|---|---|---|
| OBJ, STL, PLY ASCII, glTF, GLB | Base local existente | Pruebas con corpus amplio |
| STEP, IGES | No integrado | Open CASCADE compilado y firmado, o FreeCAD autorizado |
| DXF | No integrado | Importador validado y pruebas de entidades/capas |
| Assimp | No integrado | Binario o WASM oficial, licencia y pruebas de conversión |
| Cinema 4D | Contrato Bridge | Cinema 4D instalado, licencia y SDK oficial |
| SolidWorks | Contrato Bridge | SolidWorks instalado, licencia y API oficial |
| Fusion 360 | Contrato Bridge | Fusion instalado, cuenta y API oficial |
| Cuenta/sincronización | No integrada | Backend, dominio, TLS, OAuth y política de datos |

Un archivo de interfaz creado por DORN no reemplaza estas dependencias. La
función sólo se considera terminada cuando el motor real está incluido o
detectado, se ejecuta, produce un resultado verificable y pasa pruebas.

## DORN Lite

DORN Lite debe construirse como producto separado después de estabilizar el
router. Su objetivo será funcionar en computadores modestos y para personas que
no necesitan CAD industrial:

- chat, proyectos y memoria ligera;
- router local/API;
- DORN Core y un modelo local pequeño opcional;
- documentos, aprendizaje y automatizaciones básicas;
- sin Studio3D ni runtimes pesados instalados por defecto.

No está marcado como terminado en alpha.5.

## Validación

`npm run verify` comprueba la estructura, versión, persistencia de modos, ramas
Manual/Automático, carga del Centro de control, valores aceptados por el backend,
temas y reglas críticas de identidad. La prueba visual completa y el instalador
NSIS requieren una máquina Windows y los recursos de compilación originales.
