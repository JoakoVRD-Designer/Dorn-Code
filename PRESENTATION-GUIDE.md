# DORN Presentation Guide - Universidad Católica 2026

## Quick Start

### Instalación
```bash
cd website
npm install
npm run build
npm run preview
```

Abre en el navegador: http://localhost:4173

### Modo presentación fullscreen
1. Presiona **F** para activar pantalla completa
2. Usa **flechas** para navegar entre secciones
3. Presiona **Esc** para salir de pantalla completa

---

## Antes del evento

### Preparación técnica (1 semana antes)

- [ ] **Descargar el repositorio en el computador de presentación**
  ```bash
  git clone https://github.com/JoakoVRD-Designer/DORN-AI.git
  cd DORN-AI/website
  npm install
  npm run build
  ```

- [ ] **Descargar video de portada (si se usa)**
  - Si se confirma permiso legal
  - Guardar en: `public/media/dorn-hero.mp4`
  - Si no se usa, la portada tiene fondo CSS limpio

- [ ] **Probar en proyector**
  - Conectar a la pantalla del auditorio
  - Verificar legibilidad desde 5+ metros de distancia
  - Ajustar brillo/contraste del proyector
  - Probar fullscreen mode

- [ ] **Verificar conectividad**
  - Si es offline: Todo funciona sin Internet
  - Si es online: Google Fonts se cargan automáticamente (fallback disponible)
  - Mobile app route `/machines/` requiere HTTPS si es online

---

## Durante la presentación

### Navegación

**Teclado (recomendado):**
- `↓` o `Page Down`: Siguiente sección
- `↑` o `Page Up`: Sección anterior
- `Home`: Ir a portada
- `End`: Ir a cierre
- `F`: Pantalla completa

**Mouse:**
- Scroll vertical: Navega
- Flechas inferiores derechas: Anterior/Siguiente
- Puntos laterales: Click directo a sección

**Móvil:**
- Scroll táctil vertical
- Botones de navegación
- Menu hamburguesa para ir a sección específica

### Flujo de presentación recomendado

1. **Slide 1 (Portada)** - 30 seg
   - Título y CTAs visibles
   - Audience ve marca DORN clara

2. **Slide 2 (Problema)** - 1 min
   - Establecer contexto: máquinas detenidas
   - Mostrar punto de falla

3. **Slide 3 (Solución)** - 1 min
   - Componentes del kit
   - Frase central: "Recuperar control"

4. **Slide 4 (Ecosistema)** - 1.5 min
   - Flujo: DORN AI → PC/Móvil → S3 → Máquina
   - Énfasis en control local

5. **Slide 5 (Demo)** - 2 min **INTERACTIVA**
   - Click en "Iniciar demo"
   - Mostrar bomba funcionando
   - Click en "Detener"
   - Demostración completamente local

6. **Slide 6 (Hardware)** - 1.5 min
   - P4: "Solo exhibición" (defecto de fábrica)
   - S3: "Requiere prueba previa"
   - Modo seguro: Siempre disponible
   - **Esto es honestidad del proyecto, no deficiencia**

7. **Slide 7 (Producto)** - 1 min
   - Interfaces: AI + Machine + Mobile
   - Clasificación de datos: REAL / SIMULATED / DEMO

8. **Slide 8 (Negocio)** - 1 min
   - Tres pilares: Kit + Instalación + Servicio
   - 6 meses incluidos
   - Cliente inicial: Pymes

9. **Slide 9 (Estado)** - 1.5 min
   - Verde (Demostrable): Lo que funciona
   - Rojo (Pendiente): Lo que falta
   - Matriz honesta del proyecto

10. **Slide 10 (Cierre)** - 1 min
    - Llamada a acción: "Primer piloto"
    - Enlace a PWA móvil

**Tiempo total: 12-14 minutos (+ Q&A)**

---

## Detalles importantes de la presentación

### Honestidad radical

- **P4 display:** No inventes que funciona. Está defectuoso de fábrica.
- **S3:** Requiere prueba previa documentada. Ese es el estado real.
- **Demostración:** Es 100% simulada. No abre hardware real.
- **Precio:** No mencionarlo hasta tener un número validado.
- **Clientes:** No afirmar clientes reales sin firmas.

### Lo que SÍ puedes enfatizar

- Arquitectura de control local (la IA no tiene decisión final)
- Parada manual siempre disponible
- Prototipo en validación activa
- Demostración funcional
- Intención clara del producto
- Roadmap realista

### Si te pregunta: "¿Por qué el P4 está roto?"

**Respuesta correcta:**
> "La pantalla P4 tuvo un defecto de fábrica. Por eso la exhibimos como unidad de demostración y validamos la lógica en el S3. Es una prueba de que DORN funciona sin depender de un único componente, y que nuestro control local es resiliente."

---

## Dinámica de preguntas

### Preparate para:

**P: "¿Cuándo será disponible para compra?"**
> "Estamos validando el primer piloto. Una vez que completemos la integración real con S3 y validemos con un cliente inicial, podremos confirmar precio y disponibilidad."

**P: "¿Con qué máquinas es compatible?"**
> "Comenzamos con máquinas de 12V como la de nanoburbujas. Nuestro roadmap es validar familias específicas de equipos, no afirmar compatibilidad universal."

**P: "¿Qué pasa si falla la conexión a Internet?"**
> "El control local en S3 funciona independientemente. La IA ayuda a coordinar, pero el controlador local toma decisiones verificadas sin depender de conexión."

**P: "¿Esto es más caro que reemplazar la máquina?"**
> "Depende del equipo. Esperamos que sea 30-50% más barato que reemplazo completo, pero esos números todavía están en validación."

---

## Después del evento

### Feedback
- Toma notas de preguntas recurrentes
- Identifica secciones que necesitaron aclaraciones
- Ajusta timing si fue muy corto/largo

### Actualizaciones
Si hay cambios o validaciones:
1. Edita `resources/pilot/catolica-2026-09-08.json`
2. Los cambios se reflejan automáticamente
3. Rebuild: `npm run build`
4. Commit: `git add . && git commit -m "Update presentation after Católica event"`
5. Push: `git push`

---

## Troubleshooting

### "La fuente no se carga sin Internet"
✓ Configurado: Fallback local de Inter disponible. Sigue siendo legible.

### "El video de portada no juega"
✓ Configurado: Fondo CSS limpio. Video es opcional.

### "La demostración se congela"
✓ Recarga la página (Ctrl+R)
✓ Abre en tab incógnito si hay issues de cache

### "No veo los puntos de navegación lateral"
✓ Solo visible en pantallas ≥1024px (desktop)
✓ En móvil usa menú hamburguesa

### "Touchpad lento en scroll"
✓ Prueba con `scroll-behavior: auto` en Safari
✓ Los keyboards shortcuts funcionan en cualquier dispositivo

---

## Verificación final (día anterior)

- [ ] Computador cargado (batería 100%)
- [ ] Presentación abierta en navegador
- [ ] Fullscreen mode probado
- [ ] Demo interactiva funciona (click en "Iniciar")
- [ ] Botones de navegación responden
- [ ] Conexión proyector verificada
- [ ] Teclado accesible durante presentación
- [ ] Notas de presentador a mano
- [ ] URL del evento confirmada

---

## Recursos dentro del proyecto

- **Configuración:** `resources/pilot/catolica-2026-09-08.json`
- **Trazabilidad:** `docs/CONTENT-SOURCE.md`
- **Verificación:** `verification/test-checklist.md`
- **Documentación técnica:** `website/README.md`

---

## Contacto & Soporte

- Si hay bugs: Abre issue en GitHub
- Si hay cambios de contenido: Edita JSON, rebuildea
- Si necesitas mode offline: ✓ Ya está incluido
- Si necesitas agregar slides: Edita `website/src/components/slides/AllSlides.tsx`

---

**Que vaya bien. La presentación está lista. Tú tienes la expertise del proyecto.**

"No reemplazamos una máquina completa cuando todavía puede recuperarse."

¡Suerte en la Universidad Católica de Chillán! 🚀
