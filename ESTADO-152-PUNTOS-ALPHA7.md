# DORN AI 3.0.0-alpha.7 — estado de los 152 puntos

Este informe se genera directamente desde `dorn-v3-requirements.json`. Un estado `partial-*` significa que existe una base comprobable, pero no cubre todo el alcance del Word.

## Resumen

- partial-alpha.3: 106
- partial-alpha.4: 12
- partial-alpha.6: 10
- partial-alpha.7: 7
- partial-existing: 14
- pending: 3
- Total: 152

## Matriz completa

N.º | Requisito | Módulo | Estado | Evidencia o límite
--- | --- | --- | --- | ---
1 | IDENTIDAD CENTRAL DE DORN | core | partial-existing | 
2 | OBJETIVO GENERAL DEL PRODUCTO | core | partial-existing | 
3 | PRINCIPIOS OBLIGATORIOS | core | partial-alpha.3 | Control local, aprobación, límites y recuperación.
4 | SISTEMA DE SUBAGENTES | agents | partial-alpha.3 | Coordinador, especialistas, crítico y supervisor con ejecución real.
5 | CONTROL DE AGENTES | agents | partial-alpha.3 | Límites de agentes, iteraciones, tiempo y tokens según modo.
6 | MODOS DE FUNCIONAMIENTO | agents | partial-alpha.3 | Siete modos persistentes por proyecto y política de privacidad.
7 | PROVEEDORES DE IA | providers-accounts | partial-existing | 
8 | INICIO DE SESIÓN Y CUENTA | providers-accounts | partial-alpha.4 | Perfil local persistente y comandos de cuenta; Google OAuth queda bloqueado hasta incorporar credenciales oficiales de la aplicación.
9 | MEMORIA | memory-chat-render | partial-alpha.3 | Memoria personal, de proyecto, semántica y grafo; exportación y eliminación.
10 | ORGANIZACIÓN DE CHATS | memory-chat-render | partial-existing | 
11 | INTERFAZ DE CHAT | memory-chat-render | partial-existing | 
12 | TEXTOS EDITABLES | memory-chat-render | partial-alpha.3 | Borradores separados y persistentes por conversación.
13 | RENDERIZADO DE CONTENIDO | memory-chat-render | partial-alpha.3 | Markdown GFM, tablas, KaTeX, Mermaid, resaltado y sanitización local.
14 | SISTEMA DE ARCHIVOS | files-plugins | partial-alpha.3 | Acciones confinadas al proyecto, vista previa, aprobación e historial.
15 | SISTEMA DE PLUGINS | files-plugins | partial-alpha.3 | Plugins con manifiesto, permisos, hash, aislamiento y ciclo de vida.
16 | DORN 3D STUDIO | studio-3d | partial-alpha.3 | Inspector Studio 3D y creación paramétrica disponibles desde texto.
17 | ACTIVACIÓN AUTOMÁTICA DEL MODO 3D | studio-3d | partial-alpha.3 | El router textual detecta archivos 3D y activa el inspector bajo demanda.
18 | ARQUITECTURA DEL SISTEMA 3D | studio-3d | partial-alpha.3 | Geometry Engine separado y registro de adaptadores opcionales.
19 | MOTORES PARA EL MÓDULO 3D | studio-3d | partial-alpha.3 | Three.js local para visualización y DORN Bridge para motores externos autorizados.
20 | FORMATOS 3D | studio-3d | partial-alpha.3 | Lectura real de OBJ, STL, PLY, glTF y GLB; otros formatos mediante Bridge.
21 | INTERFAZ DEL DORN 3D STUDIO | studio-3d | partial-alpha.3 | Ventana Studio 3D separada y abierta únicamente desde una instrucción textual.
22 | HERRAMIENTAS DEL VISOR 3D | studio-3d | partial-alpha.3 | Giro, desplazamiento, zoom, encuadre, selección, rejilla, malla e inspector.
23 | ANÁLISIS AUTOMÁTICO DE MODELOS 3D | studio-3d | partial-alpha.3 | Conteos geométricos, límites, superficie STL, escena y advertencias.
24 | MODOS DE ANÁLISIS 3D | studio-3d | partial-alpha.3 | Análisis textual real y extensible por adaptadores.
25 | MEJORAS PROPUESTAS POR IA EN 3D | studio-3d | partial-alpha.3 | Recomendaciones justificadas por conteos, dimensiones, unidades, materiales y complejidad.
26 | EDICIÓN 3D ASISTIDA POR IA | studio-3d | partial-alpha.3 | Edición OBJ no destructiva para centrar, escalar y trasladar mediante copia aprobada.
27 | CREACIÓN DE MODELOS 3D DESDE TEXTO | studio-3d | partial-alpha.3 | Generación paramétrica OBJ con piezas y lista de materiales.
28 | PROYECTOS 3D | studio-3d | partial-alpha.3 | Resultados 3D versionables dentro de la carpeta del proyecto.
29 | GENERACIÓN DE IMÁGENES | image-developer | partial-alpha.4 | Pasarela real para APIs de imagen compatibles, respuesta Base64/HTTPS, límite de 25 MB, SHA-256 y guardado binario mediante vista previa y aprobación.
30 | PROGRAMACIÓN | image-developer | partial-alpha.3 | Creación de archivos y programas con validación ejecutable.
31 | TERMINAL Y PERMISOS | image-developer | partial-alpha.3 | Terminal aprobada, cancelación, límites y bloqueo destructivo.
32 | IA LOCAL PERMANENTE | local-experience | partial-existing | 
33 | VOZ | local-experience | partial-alpha.4 | Síntesis real mediante System.Speech de Windows y control de detención; reconocimiento y palabra de activación requieren un adaptador autorizado.
34 | PERSONALIDAD | local-experience | partial-existing | 
35 | ESPACIOS DE TRABAJO | local-experience | partial-existing | 
36 | INTERFAZ PERSONALIZABLE | local-experience | partial-alpha.6 | out/renderer/vendor/dorn-control-center.js; out/renderer/vendor/dorn-control-center.css; Cinco temas, densidad, contraste y movimiento reducido; falta paleta totalmente libre y paneles desacoplables.
37 | BOTÓN PRODUCTOS | local-experience | partial-alpha.4 | Registro de productos y comando textual /productos integrados sin alterar el diseño principal; el botón visual queda para una fuente React mantenible.
38 | GAMERS | local-experience | partial-alpha.6 | out/main/dorn-suite/preference-engine.js; Perfil opt-in para enseñanza, scripts y desarrollo legítimo; no implementa evasión de inactividad ni anti-cheat.
39 | COLABORACIÓN | ecosystem-operations | partial-alpha.4 | Sala local o LAN con token Bearer, mensajes JSON persistentes, límites de tamaño e inicio/detención explícitos.
40 | SINCRONIZACIÓN Y SERVIDOR | ecosystem-operations | partial-alpha.4 | Servidor local/LAN bajo demanda y respaldos verificables; la sincronización pública requiere infraestructura, dominio y autenticación oficiales.
41 | ACTUALIZACIONES | ecosystem-operations | partial-existing | 
42 | TELEMETRÍA | ecosystem-operations | partial-alpha.4 | Telemetría desactivada por defecto, opt-in y limitada a contadores locales; no existe transmisión externa en esta compilación.
43 | SEGURIDAD | ecosystem-operations | partial-alpha.3 | Confinamiento, secretos fuera de procesos, permisos y hashes.
44 | LOGO E IDENTIDAD | ecosystem-operations | partial-existing | 
45 | REDES SOCIALES | ecosystem-operations | partial-alpha.4 | Comando /redes con el enlace de Discord indicado en el documento maestro.
46 | SISTEMA DE ERRORES | ecosystem-operations | partial-alpha.3 | Errores estructurados, causas, acciones, reintentos y auditoría.
47 | RENDIMIENTO | ecosystem-operations | partial-existing | 
48 | EMULACIÓN DE ANDROID | ecosystem-operations | pending | 
49 | CONSOLA Y AUTOMATIZACIÓN | ecosystem-operations | partial-alpha.3 | Automatización mediante acciones y comandos aprobados.
50 | OBJETIVOS DE ENTREGA | delivery | partial-existing | 
51 | REQUISITOS DE IMPLEMENTACIÓN | delivery | partial-existing | 
52 | RESULTADO ESPERADO | delivery | partial-existing | 
53 | DORN COMO ECOSISTEMA DE APLICACIONES | suite-management | partial-alpha.3 | Núcleo modular con agentes, memoria, plugins, Bridge, Doctor e Installer Engine.
54 | INSTALADOR MODULAR DE DORN | suite-management | partial-alpha.3 | Manifiestos con componentes, perfiles y dependencias.
55 | DORN INSTALLATION MANAGER | suite-management | partial-alpha.3 | Registro verificable de instalaciones, reparación, desinstalación y análisis.
56 | DESINSTALACIÓN Y ELIMINACIÓN DE DATOS | suite-management | partial-alpha.3 | Desinstalación conserva archivos modificados y datos del usuario por defecto.
57 | CUENTA DE GOOGLE Y RECUPERACIÓN | suite-management | partial-alpha.4 | Perfil local y recuperación mediante .dornbackup opcionalmente cifrado con AES-256-GCM; Google OAuth requiere cliente y redirección oficiales.
58 | DATOS QUE NO DEBEN SINCRONIZARSE DIRECTAMENTE | suite-management | partial-alpha.4 | El respaldo integrado excluye archivos y rutas con claves, tokens, secretos y credenciales; no sincroniza modelos ni archivos personales.
59 | ASISTENTE DE CONFIGURACIÓN DE APIs | suite-management | partial-alpha.3 | Guías locales por proveedor, URLs oficiales y diagnóstico de errores.
60 | CONFIGURACIÓN AUTOMÁTICA DE PROVEEDORES | suite-management | partial-alpha.3 | Presets rápidos y conexiones compatibles con OpenAI.
61 | DORN DEBE ENSEÑAR SIN DEPENDER DE SOPORTE EXTERNO | suite-management | partial-alpha.3 | Centro de ayuda local consultable desde el chat.
62 | SISTEMA DE DIAGNÓSTICO AUTOMÁTICO | suite-management | partial-alpha.3 | DORN Doctor revisa sistema, memoria, almacenamiento, motores y herramientas.
63 | PERFIL DE MODELOS Y ENSEÑANZA DE CAPACIDADES | suite-management | partial-alpha.3 | Perfiles inferidos y editables de capacidades de modelos.
64 | SISTEMA DE PLUGINS TIPO BLENDER | extensions-bridge | partial-alpha.3 | Motor de plugins extensible con instalación administrada.
65 | TIPOS DE PLUGINS | extensions-bridge | partial-alpha.3 | Capacidades declaradas y comandos como base de tipos de extensión.
66 | API PARA PLUGINS | extensions-bridge | partial-alpha.3 | API defineDornPlugin, comandos y contexto restringido.
67 | SEGURIDAD DE PLUGINS | extensions-bridge | partial-alpha.3 | Worker aislado, permisos, hash, límites y bloqueo de process/require.
68 | MARKETPLACE DE PLUGINS | extensions-bridge | partial-alpha.6 | out/renderer/vendor/dorn-control-center.js; Instalación local con inspección, hash, permisos, activación y estado; catálogo/servidor remoto pendiente.
69 | COMUNICACIÓN ENTRE APLICACIONES DORN | extensions-bridge | partial-alpha.3 | DORN Bridge ejecuta adaptadores declarados con copias aisladas y artefactos verificados.
70 | PROYECTOS COMPARTIDOS ENTRE APLICACIONES | extensions-bridge | partial-alpha.3 | Los motores consumen el proyecto común sin entregar rutas completas a procesos externos.
71 | DORN DESIGN — ARQUITECTURA | design | partial-alpha.7 | out/design/index.html; out/design/app.js; Aplicación separada, documento dorn-design/1, historial local y guardado mediante rutas autorizadas.
72 | DORN DESIGN — HERRAMIENTAS BASE | design | partial-alpha.7 | out/design/app.js; Lienzo SVG, capas, selección, posición/tamaño, color, texto, rectángulo, elipse, duplicado y exportación SVG/PNG.
73 | DORN DESIGN — IA | design | partial-alpha.7 | out/main/index.js; out/preload/product.js; Un proyecto puede enviar su documento estructurado al compositor de DORN AI; ejecución automática de operaciones visuales aún pendiente.
74 | DORN EDITOR — ARQUITECTURA | editor | partial-alpha.7 | out/editor/index.html; out/editor/app.js; Aplicación audiovisual separada con proyecto dorn-editor/1 y referencias no destructivas a medios autorizados.
75 | DORN EDITOR — HERRAMIENTAS BASE | editor | partial-alpha.7 | out/editor/app.js; Importación y previsualización local de audio/video, pistas, división, orden, entrada/salida, volumen y subtítulos; render final pendiente.
76 | DORN EDITOR — IA | editor | partial-alpha.7 | out/main/index.js; out/renderer/vendor/dorn-control-center.js; La secuencia estructurada puede enviarse a DORN AI sin exponer bytes de medios; agente de edición y codificación final pendientes.
77 | IDENTIDAD VISUAL DE LA SUITE | suite-runtime | partial-alpha.3 | Studio 3D comparte identidad visual DORN con una variante reconocible y discreta.
78 | CONSUMO Y PROCESOS | suite-runtime | partial-alpha.3 | Módulos pesados opcionales y motores activados bajo demanda.
79 | DESINSTALACIÓN DE COMPONENTES | suite-runtime | partial-alpha.3 | Componentes y datos del usuario se administran por separado.
80 | REPARACIÓN DE INSTALACIÓN | suite-runtime | partial-alpha.3 | Verificación por archivo y reparación desde el paquete original.
81 | PRIORIZACIÓN DE DESARROLLO | suite-runtime | partial-alpha.3 | Se prioriza núcleo, trabajo real y Studio 3D básico antes de Design y Editor.
82 | REGLA GENERAL DE IMPLEMENTACIÓN | suite-runtime | partial-alpha.3 | Cada módulo activo tiene ejecución, límites, resultados y pruebas.
83 | SISTEMA DE DISTRIBUCIÓN MODULAR | distribution | partial-alpha.3 | Motor de distribución modular basado en manifiestos.
84 | DISTRIBUCIÓN EN VARIOS ARCHIVOS ZIP | distribution | partial-alpha.3 | División de paquetes en fragmentos numerados.
85 | FORMATO DE PAQUETE MULTIPARTE | distribution | partial-alpha.3 | Formato dorn-multipart/1 con índice, tamaño y SHA-256 por parte.
86 | DESCARGA AUTOMÁTICA DE FRAGMENTOS | distribution | partial-alpha.3 | Descarga HTTPS y reconstrucción disponibles como primitivas del motor.
87 | DESCARGAS REANUDABLES | distribution | partial-alpha.3 | Descarga reanudable mediante HTTP Range y archivo parcial.
88 | RECONSTRUCCIÓN DE PAQUETES | distribution | partial-alpha.3 | Reconstrucción en streaming con verificación final.
89 | EXTRACCIÓN CONJUNTA | distribution | partial-alpha.3 | Extracción conjunta desde el paquete reconstruido.
90 | CARPETA DE DISTRIBUCIÓN | distribution | partial-alpha.3 | Carpeta de distribución con manifiesto multipartes.
91 | PAQUETES POR COMPONENTE | distribution | partial-alpha.3 | Paquetes y componentes declarados de forma independiente.
92 | DORN INSTALLER STUDIO | installer-studio | partial-alpha.3 | Fundación funcional de DORN Installer Studio activa como motor.
93 | OBJETIVOS DE DORN INSTALLER STUDIO | installer-studio | partial-alpha.3 | Empaquetado, instalación, verificación, reparación y desinstalación reales.
94 | MODOS DE INSTALADOR | installer-studio | partial-alpha.3 | Perfiles mínimos/personalizados y configuración avanzada por manifiesto o CLI.
95 | INTERFAZ DE DORN INSTALLER STUDIO | installer-studio | partial-alpha.6 | out/renderer/vendor/dorn-control-center.js; Panel visual integrado para editar y exportar un manifiesto.
96 | DISEÑADOR VISUAL DE INSTALADORES | installer-studio | partial-alpha.6 | out/renderer/vendor/dorn-control-center.js; Editor sincronizado de identidad, componentes, pantallas, tema y JSON.
97 | PANTALLAS DEL INSTALADOR | installer-studio | partial-alpha.6 | out/renderer/vendor/dorn-control-center.js; Lista editable de pantallas; editor drag-and-drop pendiente.
98 | SISTEMA DE TEMAS PARA INSTALADORES | installer-studio | partial-alpha.6 | out/renderer/vendor/dorn-control-center.js; Selección y persistencia de tema en el manifiesto; editor completo de tokens pendiente.
99 | DISEÑO RESPONSIVO | installer-studio | partial-alpha.6 | out/renderer/vendor/dorn-control-center.css; Vista previa y formulario adaptables a una columna bajo 720 px.
100 | PROYECTO DE INSTALADOR | installer-studio | partial-alpha.3 | Proyecto dorn-installer.json generado desde lenguaje natural.
101 | DETECCIÓN AUTOMÁTICA DE ARCHIVOS | installer-studio | partial-alpha.3 | Escaneo automático de archivos, tamaños, hashes y extensiones.
102 | REGLAS DE INCLUSIÓN Y EXCLUSIÓN | installer-studio | partial-alpha.3 | Reglas include/exclude con bloqueos de rutas inseguras y enlaces.
103 | COMPONENTES SELECCIONABLES | installer-studio | partial-alpha.3 | Componentes seleccionables mediante patrones.
104 | PERFILES DE INSTALACIÓN | installer-studio | partial-alpha.3 | Perfiles de componentes validados.
105 | DEPENDENCIAS | installer-studio | partial-alpha.3 | Dependencias obligatorias y opcionales declaradas en manifiesto.
106 | INSTALACIÓN POR USUARIO O POR EQUIPO | installer-studio | partial-alpha.3 | Alcance por usuario o equipo declarado y validado.
107 | ACCIONES DE INSTALACIÓN | installer-studio | partial-alpha.3 | Acción transaccional de instalación de archivos.
108 | TRANSACCIONES Y REVERSIÓN | installer-studio | partial-alpha.3 | Copia previa y reversión automática ante fallos.
109 | DESINSTALADOR GENERADO | installer-studio | partial-alpha.3 | Desinstalador basado en el registro exacto de archivos.
110 | REGISTRO DE ARCHIVOS INSTALADOS | installer-studio | partial-alpha.3 | Registro persistente de producto, versión, destino, componentes y hashes.
111 | SISTEMA DE ACTUALIZACIÓN DIFERENCIAL | installer-studio | partial-alpha.3 | Comparación exacta de archivos añadidos, eliminados, modificados e iguales.
112 | PARCHES | installer-studio | partial-alpha.4 | Formato dorn-patch/1, comparación de versiones, payload diferencial y reconstrucción reproducible con validación SHA-256.
113 | PUBLICACIÓN | installer-studio | partial-alpha.3 | Compilación reproducible a .dornpkg.
114 | SERVIDORES ALTERNATIVOS | installer-studio | partial-alpha.3 | Descarga HTTPS configurable como base de servidores alternativos.
115 | PRUEBAS DEL INSTALADOR | installer-studio | partial-alpha.3 | Pruebas automatizadas de paquete, instalación, reparación y multipartes.
116 | ASISTENTE DE IA PARA CREAR INSTALADORES | installer-studio | partial-alpha.3 | El chat genera una configuración inicial de instalador para el proyecto.
117 | EDITOR DE CONFIGURACIÓN | installer-studio | partial-alpha.3 | Configuración JSON legible, editable y validada.
118 | PLUGINS PARA DORN INSTALLER STUDIO | installer-studio | partial-alpha.7 | sdk/installer-plugins/dorn-installer-plugin.schema.json; sdk/installer-plugins/README.md; Contrato de hooks y permisos específico; el host aislado de ejecución permanece pendiente.
119 | AUTOMATIZACIÓN Y LÍNEA DE COMANDOS | installer-studio | partial-alpha.3 | CLI dorn-installer con análisis, build, instalación, reparación, partes y limpieza.
120 | INTEGRACIÓN CON PIPELINES | installer-studio | partial-alpha.3 | La CLI entrega JSON, códigos de salida y rutas explícitas para pipelines.
121 | CONTROL DE VERSIONES | installer-studio | partial-alpha.3 | Versiones semánticas validadas y comparación de compilaciones.
122 | COMPATIBILIDAD ENTRE VERSIONES | installer-studio | partial-alpha.3 | Comprobación de plataforma, arquitectura y versión mínima de DORN Core.
123 | RESPALDO ANTES DE ACTUALIZAR | installer-studio | partial-alpha.3 | Respaldo de archivos existentes antes de reemplazarlos.
124 | PAQUETES DE IDIOMA | installer-studio | partial-alpha.3 | Paquetes de idioma representables como componentes.
125 | PAQUETES DE RECURSOS | installer-studio | partial-alpha.3 | Paquetes de recursos representables como componentes.
126 | MODELOS DE IA COMO PAQUETES | installer-studio | partial-alpha.3 | Modelos representables como componentes opcionales.
127 | LIMPIEZA DE ARCHIVOS TEMPORALES | installer-studio | partial-alpha.3 | Limpieza segura de trabajos temporales por antigüedad.
128 | ADMINISTRACIÓN DE ALMACENAMIENTO | installer-studio | partial-alpha.3 | Análisis de peso total y distribución por extensión.
129 | UBICACIONES PERSONALIZABLES | installer-studio | partial-alpha.3 | Destino de instalación seleccionable.
130 | MOVIMIENTO DE COMPONENTES | installer-studio | partial-alpha.3 | Movimiento transaccional con verificación y reversión del destino.
131 | INSTALACIÓN DESDE ARCHIVOS LOCALES | installer-studio | partial-alpha.3 | Construcción e instalación desde archivos locales.
132 | FORMATO DORN PACKAGE | installer-studio | partial-alpha.3 | Formato dorn-package/1 dentro de .dornpkg.
133 | FORMATO DORN BUNDLE | installer-studio | partial-alpha.4 | Formato dorn-bundle/1 para agrupar dos o más .dornpkg, con hashes por paquete y extracción verificada.
134 | FIRMA DIGITAL | installer-studio | partial-alpha.3 | Firma Ed25519 opcional y verificación con clave pública.
135 | INTEGRIDAD | installer-studio | partial-alpha.3 | SHA-256 por archivo, paquete y fragmento.
136 | REGISTROS DE INSTALACIÓN | installer-studio | partial-alpha.3 | Registro de instalación y auditoría estructurada.
137 | RECUPERACIÓN ANTE FALLOS | installer-studio | partial-alpha.3 | Transacción, reversión y reparación verificable.
138 | INSTALADOR CON IDENTIDAD DORN | installer-studio | partial-alpha.6 | out/renderer/vendor/dorn-control-center.js; Vista previa Graphite con palabra DORN y experiencia modular.
139 | EXPERIENCIA DEL USUARIO | installer-studio | partial-alpha.6 | out/renderer/vendor/dorn-control-center.js; Editor simple, estados y exportación; flujo instalable final pendiente.
140 | MODO AVANZADO DEL INSTALADOR | installer-studio | partial-alpha.3 | Manifiesto y CLI como modo avanzado sin saturar la interfaz principal.
141 | MODO SIMPLE | installer-studio | partial-alpha.3 | Perfil mínimo mediante componentes requeridos.
142 | DORN INSTALLER STUDIO COMO PRODUCTO OPCIONAL | installer-studio | partial-alpha.3 | Installer Studio se mantiene como módulo opcional sobre un motor común.
143 | ESPACIO DE TRABAJO DE INSTALADORES | installer-studio | partial-alpha.3 | Espacio textual para crear y analizar proyectos de instalador.
144 | COMPARACIÓN DE COMPILACIONES | installer-studio | partial-alpha.3 | Comparación de dos manifiestos.
145 | ANALIZADOR DE PESO | installer-studio | partial-alpha.3 | Analizador de archivos, extensiones y peso.
146 | DEDUPLICACIÓN ENTRE PRODUCTOS | installer-studio | partial-alpha.3 | Detección de contenido duplicado y bytes recuperables.
147 | AISLAMIENTO DE COMPONENTES | installer-studio | partial-alpha.3 | Selección aislada de componentes sin mezclar sus registros.
148 | DECISIÓN SOBRE LOS ZIP | installer-studio | partial-alpha.3 | Partes ZIP numeradas con reconstrucción y verificación.
149 | PRIMERA VERSIÓN DE DORN INSTALLER STUDIO | installer-studio | partial-alpha.3 | Base de la primera versión: proyecto, escaneo, paquete, transacción y registro.
150 | SEGUNDA VERSIÓN | installer-studio | pending | 
151 | TERCERA VERSIÓN | installer-studio | pending | 
152 | RESULTADO FINAL ESPERADO | installer-studio | partial-alpha.3 | Núcleo verificable que puede ampliar las etapas restantes sin reescribir la aplicación.

## Pendientes que necesitan otra etapa

- **48. EMULACIÓN DE ANDROID:** requiere un motor de virtualización/emulación autorizado, imágenes de sistema, compatibilidad de hardware y pruebas en Windows.
- **150. SEGUNDA VERSIÓN:** depende de cerrar y probar la primera versión visual del Installer Studio.
- **151. TERCERA VERSIÓN:** depende de servicios, firma, publicación, pipelines y pruebas virtualizadas.

## Anotaciones manuales integradas en alpha.7

- Campo de mensaje ampliado a 320 px, con saltos y espacios preservados.
- KaTeX comprobado para fórmulas en línea y bloques como `i = \sqrt{-1}`.
- Preferencia para precargar DORN Local una vez al iniciar y reutilizar `llama-server`.
- Perfiles Directo, Mentor, Cercano, Aprendizaje, Ingeniería, Gamers y Desarrollador.
- Sugerencias de espacio sin mover conversaciones automáticamente.
- Guías de proveedores y acceso al formulario amplio de APIs existente.
- Panel de productos, gestor local de plugins y Designer inicial de Installer Studio.
- Catálogo unificado con cinco modelos locales verificables y doce guías de conexión local/API.
- DORN Design separado: documento versionado, lienzo SVG, capas, inspector y exportación.
- DORN Editor separado: proyecto audiovisual no destructivo, medios, pistas, cortes y subtítulos.
- Envío del documento de Design o la secuencia de Editor al compositor de DORN AI.
- SDK específico de plugins de Installer Studio; su host aislado todavía está pendiente.
- Contrato CAD/Bridge para Open CASCADE, Assimp y aplicaciones propietarias autorizadas.
- No se implementó evasión de inactividad de Roblox, anti-cheat ni acceso silencioso al sistema.
- Inicio de sesión Google, telemetría pública, marketplace remoto y servidores siguen dependiendo de infraestructura y credenciales oficiales.
