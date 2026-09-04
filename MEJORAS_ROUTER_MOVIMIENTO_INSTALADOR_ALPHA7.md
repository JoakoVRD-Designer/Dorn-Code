# DORN AI 4.0.0-alpha.7 · Router, movimiento e instalador

## Decisiones separadas

El Router IA mantiene los modos de selección: Automático, Manual, Económico,
Privado, Rendimiento y Batería. Automático vuelve a evaluar la tarea y la lista
de conexiones en cada mensaje.

La cantidad de motores se configura aparte mediante exactamente dos opciones:

- Una IA por respuesta: una llamada normal; las claves equivalentes sólo se
  alternan como respaldo ante cuota o error temporal.
- Varias IAs por respuesta: de uno a cuatro motores distintos según la cantidad
  realmente configurada. La interfaz muestra el equipo, informa el máximo de
  llamadas y exige confirmación antes de enviar contenido.

El antiguo modo `team` migra a Automático + Varias IAs. El modo Privado filtra
el equipo a motores locales. DORN Guide permanece como respuesta local única en
emergencias.

## Modelos y APIs

El catálogo activo añade conexiones editables para SambaNova, DeepInfra,
Nebius Token Factory, AI/ML API, Novita AI, SiliconFlow, Moonshot/Kimi,
Cloudflare Workers AI, LiteLLM Gateway y Open WebUI Gateway. Las fichas incluyen
enlaces directos a clave, documentación y modelos cuando el proveedor los
publica. GitHub Models se retiró del catálogo activo porque su inferencia ya no
está disponible.

Los nombres de modelo incluidos en una guía son un punto de partida. Antes de
guardar se debe usar `Cargar modelos` para confirmar lo habilitado en la cuenta,
región o servidor actual.

## Personalización

Los efectos de apertura ahora comparten una curva consistente y la vista previa
se reinicia correctamente cada vez. La intensidad acepta Muy suave, Suave,
Equilibrado, Dinámico y Agresivo. Movimiento reducido y la preferencia del
sistema operativo siguen teniendo prioridad absoluta.

## Instalador

El instalador nativo incorpora una ilustración propia de bosque tecnológico y
luces animadas dibujadas mediante GDI. No usa un GIF externo. Conserva el
tráiler `DORNZIP3`, la validación SHA-256 del payload, la selección de productos,
la instalación por usuario y el desinstalador.

## Autenticación futura

Los archivos de registro e inicio de sesión continúan incluidos, pero las
banderas `accountAuthentication` y `accountControls` permanecen desactivadas en
esta versión. No se muestran durante el uso normal.
