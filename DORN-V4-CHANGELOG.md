# DORN AI 4.0.0-alpha.3

## Alpha 3

- Comando `proyecto` con autocompletado tipo Discord, selección visible y vinculación interna estricta al ID y la ruta autorizada.
- Gestor de proyectos para crear, conectar, renombrar y quitar carpetas sin borrar los archivos originales.
- DORN AI, Windows y los productos quedaron separados conceptualmente; Windows es la plataforma de esta compilación, no parte de la marca.
- Corrección del error `Object has been destroyed`: los identificadores de ventanas se capturan antes de cerrarlas y los eventos tardíos no derriban la aplicación vigente.
- Procesos y accesos directos independientes para Design, Editor, Education y Machine, conservando apariencia y preferencias comunes.
- Iconos PNG e ICO multirresolución propios para AI, Design, Editor, Education, Machine y Studio 3D.
- Único panel grande de Configuración; las llamadas del menú antiguo se redirigen al Centro DORN.
- Fondos PNG, JPG, GIF, WebP, AVIF, BMP o ICO validados por firma, copiados a almacenamiento privado y limitados a 48 MB.
- Cinco efectos de apertura más el efecto predeterminado: desvanecer, escalar, deslizar, resorte y cinematográfico.
- Dictado, transcripción WAV a texto, diagnóstico de voz y modo manos libres mediante los motores locales de Windows.
- Tutor de DORN Education corregido para recibir el texto reconocido y poder leer, escuchar y transcribir.
- Router por grupos para repartir varias claves equivalentes y cambiar ante cuota o errores temporales sin reactivar el modo automático.
- Conectores automáticos añadidos para Together AI, Fireworks, Cerebras, Perplexity, NVIDIA NIM y Z.AI/GLM, además de los proveedores existentes.
- Catálogo mundial conservado como referencia; una ficha sólo se vuelve configurable cuando existe un método verificable.
- El nombre elegido con `proyecto` funciona como una orden interna: la conversación conserva ID, ruta real, permisos y protocolo de herramientas sin enviar esa información como un mensaje visible.
- Instalador gráfico propio compilado como PE32+ x64, con verificación SHA-256 del payload, selección de accesos, ruta configurable y desinstalador nativo.
- Maqueta SVG/PNG del instalador sincronizada con la interfaz real y código C editable para seguir cambiando su diseño.

## Corrección del editable

- El empaquetado ya no elimina por accidente las carpetas `dist` internas de
  las dependencias.
- El editable vuelve a incluir el runtime completo de Electron y los archivos
  compilados necesarios para desarrollar y recompilar sin reinstalar piezas.
- El nuevo comando `npm run pack:editable` valida el runtime y `app.asar`
  antes de generar el ZIP.

## Alpha 2

- Router Automático persistente y recalculado con cada proveedor disponible.
- El modelo local integrado no se considera disponible hasta terminar su descarga; si no existe una IA lista, DORN pide entrar a Configuración y agregarla.
- Aprobación compacta mediante «Sí», «No» y menú de tres puntos para autorizar el resto del plan; no requiere escribir frases ni consume tokens.
- CMD, PowerShell y terminal muestran la misma confirmación pequeña antes de ejecutar.
- Generación de imágenes mediante conexión dedicada, vista previa en el chat y guardado aprobado dentro de `DORN-Images` cuando existe un proyecto.
- Dictado por micrófono, lectura de respuestas y conversación de voz mediante el motor local de Windows.
- Veinte paletas profesionales compartidas por DORN AI, productos e inicio, además del editor HEX personalizado y fondos con imagen local.
- La sección se llama «Personalización» y permite elegir PNG, JPG o WebP, controlar ajuste, intensidad y desenfoque, o volver a la paleta sin perder el archivo guardado.
- Acceso discreto al servidor oficial de Discord en el pie del menú, abierto fuera de DORN mediante una ruta fija y validada.
- Menú de tres puntos siempre accesible en las conversaciones.
- Gamers se limita a ayuda para jugadores; creación de juegos, scripts, pruebas y publicación permanecen en Desarrollador.
- Catálogo A-Z corregido, enlaces web oficiales y asistente de instalación/configuración por ficha.
- Creación de carpetas de proyecto con nombre seguro antes de generar archivos.
- DORN Education con diagnóstico adaptativo, cursos y corrector de ocho clavijeros PAES 2026.
- DORN Machine restringido a futuros productos físicos oficiales y firmados por DORN.
- Identidades visuales independientes para AI, Design, Education, Machine y Editor.
- Instalador selectivo: DORN AI obligatorio y productos opcionales.
- Inicio prioritario de siete segundos y procesos independientes por acceso directo.
- Enciclopedia Mundial integrada como índice navegable de 984 referencias únicas en 43 secciones.
- Distinción visible entre modelos descargables, conectores configurables y referencias que todavía requieren validación oficial.
- Conexiones migradas al Centro DORN grande; el acceso antiguo ya no abre una segunda ventana de configuración.
- Fichas con imágenes de empresa disponibles y avatares DORN deterministas para el resto del catálogo.

## Alpha 1

Edición interna de transición hacia DORN 5.0. Esta versión conserva la base
técnica recuperada de DORN 0.4 y la arquitectura de DORN 3, pero reorganiza la
experiencia para que DORN AI funcione como el centro de una familia de
aplicaciones independientes.

## Interfaz y navegación

- Se recuperó el menú lateral robusto de Configuración.
- El catálogo y las recomendaciones de IA están conectados desde
  **Modelos y APIs**.
- La tarjeta fija de “DORN Core” fue retirada del lateral para dar prioridad a
  conversaciones y proyectos.
- El panel de contexto derecho ahora es opcional y recuerda si el usuario lo
  dejó abierto o cerrado.
- Al iniciar se recupera la conversación más reciente; solo se crea una nueva
  cuando no existe ninguna.
- Chats y carpetas conectadas pueden eliminarse desde controles visibles. Quitar
  una carpeta de DORN nunca borra la carpeta original del disco.
- “Installer Studio” se eliminó del producto.
- Plugins muestra únicamente que el sistema está planificado para DORN 5.0.
- Scripts pasó a **Desarrollador**, con vista previa, carpeta de trabajo,
  selección de terminal y confirmación antes de ejecutar.

## Color e identidad

- La paleta seleccionada se aplica a la aplicación, Configuración, catálogo,
  compositor, panel lateral y animación de inicio.
- Las paletas personalizadas derivan superficies oscuras legibles a partir del
  color elegido para evitar fondos completamente saturados.
- La animación muestra la palabra **DORN** y adopta el color del producto.
- Design, Education y Machine tienen una variante visual propia del inicio.

## Modelos y APIs

- Catálogo ampliado con proveedores principales de nube, rutas compatibles con
  OpenAI y servidores locales.
- Búsqueda por proveedor, uso y compatibilidad.
- Fichas con tipo de conexión, orientación de implementación, documentación y
  acción para revisar o configurar.
- Se mantienen separados los conceptos de modelo descargable y API: una ficha
  de nube no se presenta como descarga local.
- La recomendación local continúa analizando RAM y capacidad del equipo.

El catálogo es una guía curada y ampliable, no una afirmación falsa de contener
“todas las IA del mundo”. Los proveedores, modelos, precios, licencias y rutas
pueden cambiar y deben actualizarse desde sus fuentes oficiales.

## Archivos y conversaciones

- Huella SHA-256 para impedir que la misma imagen se adjunte dos veces en una
  conversación.
- Previsualización pequeña de imágenes en el compositor y en mensajes.
- Transferencias de Design limitadas y validadas como imágenes PNG; ya no se
  pega el documento JSON completo dentro del chat.
- Eliminación explícita de conversaciones y desconexión de carpetas.

## DORN Design

- Herramientas de selección, pincel, línea e importación de imagen.
- Control de grosor de trazo.
- Exportación de la vista a PNG para enviarla visualmente a DORN AI.
- Design se puede abrir desde Productos o mediante un acceso directo propio.

## DORN Education

- Aplicación independiente conectada al mismo núcleo.
- Flujo **aprender → practicar → rendir → revisar**.
- Banco inicial de preguntas originales estilo PAES M1 con respuestas A–E.
- Resultados explicados, progreso local y envío del resumen a DORN AI para
  continuar como tutor.
- No incluye ni afirma incluir material oficial de DEMRE.

## DORN Machine

- Aplicación independiente para registrar y organizar dispositivos físicos.
- Tipos de conexión, estado, simulación y plan de integración.
- Toda acción física real exige un conector autorizado, límites, parada de
  emergencia y confirmación. La interfaz no simula que controla hardware cuando
  no existe un SDK o adaptador conectado.

## Instalación y productos

- Un runtime compartido evita duplicar cientos de megabytes.
- Accesos directos independientes abren DORN AI, Design, Education y Machine
  con experiencias de inicio distintas.
- El portable se ensambla únicamente con Electron 37.2.6 oficial win32-x64
  bloqueado por tamaño y SHA-256.
- El instalador reconstruye el ejecutable desde fragmentos verificables y
  detiene la instalación si el tamaño final no coincide.

## Pendiente

- DORN Studio3D completo comienza como desarrollo principal para DORN 5.0.
- Más herramientas profesionales de pintura y edición no destructiva en Design.
- Conectores físicos reales y SDK autorizados para Machine.
- Sincronización de cuenta/servidor.
- Firma digital de código.
- Validación visual y de audio final en un equipo Windows 11 x64 físico.
- Prueba real de cada proveedor de imágenes con una clave, cuota y modelo habilitado por su empresa.
- Revisión periódica del catálogo de proveedores y modelos.
