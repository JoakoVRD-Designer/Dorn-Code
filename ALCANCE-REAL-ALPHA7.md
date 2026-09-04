# DORN AI 3.0.0-alpha.7 — alcance real

Alpha.7 incorpora aplicaciones base para diseño y edición audiovisual, amplía
la orientación de modelos y APIs y reduce a tres los puntos sin una base
comprobable dentro de la matriz de 152 requisitos.

## Implementado en esta etapa

- Catálogo unificado con buscador, tipo, tarea y compatibilidad.
- Cinco modelos DORN Local con descarga directa fijada por versión, tamaño y
  SHA-256.
- Guías para OpenAI, Gemini, Claude, Grok, DeepSeek, Mistral, Cohere, Groq,
  OpenRouter, Hugging Face, Ollama y LM Studio.
- Carga de modelos reales desde la cuenta o servidor después de configurar la
  conexión, en vez de prometer una lista estática.
- DORN Design separado con documento `dorn-design/1`, lienzo SVG, capas,
  herramientas básicas, inspector, historial y exportación.
- DORN Editor separado con documento `dorn-editor/1`, importación local,
  previsualización, pistas, cortes, puntos de entrada/salida, volumen y
  subtítulos.
- Ventanas aisladas con `contextIsolation`, sandbox, navegación bloqueada y
  rutas de lectura/escritura aprobadas por el usuario.
- Envío de documentos estructurados desde Design y Editor a DORN AI.
- Esquema y plantilla de SDK de plugins de Installer Studio.

## Límites expresos

- DORN Editor todavía no codifica el video final. FFmpeg debe incorporarse como
  motor versionado, con licencia, validación de formatos y pruebas de salida.
- DORN Design no incluye todavía máscaras, filtros, tipografía administrada,
  edición de nodos ni generación de imágenes integrada.
- El envío a DORN AI prepara contexto; todavía no convierte automáticamente una
  respuesta en operaciones editables dentro de Design o Editor.
- El SDK de Installer Studio aún no tiene un host aislado ejecutable.
- Los modelos locales no se incrustan todos en el ZIP: suman muchos gigabytes.
  Cada usuario elige cuáles descargar y DORN los conserva separados de la app.
- APIs, cuotas, modelos y regiones dependen de cada proveedor y de la cuenta del
  usuario.
- La ejecución visual del EXE, reproducción multimedia, splash, audio e
  instalador NSIS deben probarse finalmente en Windows 11 x64.

## Pendiente completo en la matriz

- Emulación de Android.
- Segunda versión industrial de Installer Studio.
- Tercera versión con servicios de publicación e infraestructura.

Una base parcial no equivale a una función industrial final. La matriz y las
pruebas conservan esa distinción para poder continuar el proyecto sin fingir
integraciones ni resultados.
