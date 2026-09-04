# DORN Presentation - Test Verification Checklist

## Pre-deployment verification

### 1. Build & Installation
- [ ] `npm install` completado sin errores
- [ ] `npm run build` completado exitosamente
- [ ] `npm run lint` sin warnings críticos
- [ ] `npm run type-check` sin errores
- [ ] Archivo lockfile (`package-lock.json`) incluido

### 2. Visual Testing (5 resoluciones)

#### Desktop - 1920×1080 (Proyector)
- [ ] Portada legible desde distancia
- [ ] Títulos no truncados
- [ ] Botones visibles sin scroll
- [ ] Navegación superior clara
- [ ] Indicador de progreso correcto

#### Desktop - 1366×768 (Notebook)
- [ ] Títulos no cortados
- [ ] CTAs accesibles
- [ ] Controles no superpuestos
- [ ] Texto legible (sin zoom)

#### Tablet - 1024×768
- [ ] Layout responsive correcto
- [ ] Botones táctiles de 44×44 px mínimo
- [ ] Menú móvil funciona
- [ ] Scroll smooth sin saltos

#### Mobile - 390×844
- [ ] Portada centrada
- [ ] Texto escalado apropiadamente
- [ ] Botones tocables
- [ ] Sin scroll horizontal
- [ ] Demostración interactiva funciona

#### Mobile - 360×800 (Pequeño)
- [ ] Toda la interfaz visible sin zoom
- [ ] Texto legible a tamaño natural
- [ ] Navegación accesible

### 3. Navegación

#### Teclado
- [ ] ↓ / Page Down: siguiente
- [ ] ↑ / Page Up: anterior
- [ ] Home: primera sección
- [ ] End: última sección
- [ ] F: pantalla completa
- [ ] Esc: cierra menú
- [ ] Tab: navega por botones

#### Mouse/Trackpad
- [ ] Scroll vertical navega
- [ ] Flechas inferior derecha funcionan
- [ ] Puntos laterales navegan
- [ ] Botones click-to-slide funcionan

#### Deep linking
- [ ] `#1` → Slide 1 (Portada)
- [ ] `#5` → Slide 5 (Demostración)
- [ ] `#10` → Slide 10 (Cierre)
- [ ] Actualizar URL actualiza posición
- [ ] Back button devuelve slide anterior

### 4. Funcionalidad interactiva (Slide 5)

#### Demostración de Nanoburbujas
- [ ] "Iniciar demo" funciona
- [ ] Estado visual cambia a "EN FUNCIONAMIENTO"
- [ ] Log registra inicio con timestamp
- [ ] "Detener" funciona
- [ ] Log registra parada
- [ ] Etiqueta `SIMULATED` siempre visible
- [ ] No abre red/Bluetooth/serial
- [ ] No hace llamadas API
- [ ] No accede a hardware

#### Botones secundarios
- [ ] "Abrir piloto móvil" abre `/machines/` en nueva tab
- [ ] "Construyamos el primer piloto" prepara mailto
- [ ] CTAs desactivados muestran "Contacto próximamente" (si no existe email)

### 5. Accesibilidad

#### Contraste
- [ ] Texto sobre fondos cumple WCAG AA
- [ ] Elementos interactivos diferenciables sin color
- [ ] No hay texto blanco sobre blanco
- [ ] No hay gris puro sobre gris puro

#### Foco visible
- [ ] Todos los botones muestran foco
- [ ] Outline dorado (dorn-accent) en :focus-visible
- [ ] Foco navigation con Tab predecible
- [ ] Foco orden lógico (LTR, top-bottom)

#### Semántica
- [ ] Estructura HTML semántica
- [ ] `<h1>`, `<h2>` en orden correcto
- [ ] `<button>` para acciones, `<a>` para navegación
- [ ] `aria-label` en botones solo-icono

#### Reducción de movimiento
- [ ] `prefers-reduced-motion: reduce` → sin animaciones
- [ ] Página sigue siendo legible
- [ ] Contenido no oculto por falta de animación
- [ ] `scroll-behavior: auto` con reducción de movimiento

#### Móvil
- [ ] Botones ≥44×44 px
- [ ] Sin truncamiento de input
- [ ] Zoom legible sin pinch
- [ ] Scroll táctil natural

### 6. Contenido & Restricciones

#### Honestidad del hardware
- [ ] ✗ P4 NO se muestra como operativo
- [ ] ✓ P4 claramente marcado "Solo exhibición"
- [ ] ✗ P4 pantalla NO se muestra encendida
- [ ] ✓ S3 marcado "Requiere prueba previa"
- [ ] ✓ Modo seguro disponible sin hardware

#### Restricciones de negocio
- [ ] ✗ No afirma precio
- [ ] ✗ No afirma clientes reales
- [ ] ✗ No afirma disponibilidad para compra
- [ ] ✗ No afirma ahorro medido
- [ ] ✓ Slide 9: honestamente marca "Pendiente"

#### Demostración
- [ ] ✓ Nanoburbujas siempre etiquetada `SIMULATED`
- [ ] ✓ Log local, no interfaz real
- [ ] ✓ Reconocible como demostración

#### Fuente única de verdad
- [ ] Todos los textos derivan de `resources/pilot/catolica-2026-09-08.json`
- [ ] ✗ No hay textos contradictorios con JSON
- [ ] ✓ Ciclos (15/22) coinciden con config
- [ ] ✓ Componentes listados coinciden

### 7. Offline & Performance

#### Offline
- [ ] Desconectar Internet
- [ ] Portada sigue visible
- [ ] Navegación funciona
- [ ] Demostración funciona
- [ ] Fuentes se cargan desde fallback local si es necesario

#### Performance
- [ ] Google Fonts carga sin bloquear (media="print")
- [ ] Fallback Inter disponible
- [ ] Bundle < 100 KB (gzipped)
- [ ] LCP < 2s en conexión 4G simulada
- [ ] Lighthouse Score ≥90 (Performance)

#### PWA (si está implementada)
- [ ] Service worker se registra
- [ ] Manifest válido
- [ ] Instalar en pantalla de inicio funciona
- [ ] Funciona offline completamente

### 8. Navegación por secciones

- [ ] Slide 1: Portada con CTAs
- [ ] Slide 2: Problema
- [ ] Slide 3: Solución
- [ ] Slide 4: Ecosistema
- [ ] Slide 5: Demostración interactiva
- [ ] Slide 6: Hardware sin maquillaje
- [ ] Slide 7: Producto y experiencia
- [ ] Slide 8: Modelo de negocio
- [ ] Slide 9: Estado real
- [ ] Slide 10: Cierre con CTAs

### 9. Configuración & Deployment

- [ ] Archivo `.env` (si existe) en `.gitignore`
- [ ] `package-lock.json` versionado
- [ ] Build reproducible (mismo hash cada vez)
- [ ] Documentación README completa
- [ ] CONTENT-SOURCE.md actualizado

### 10. Cross-browser (si es posible)

- [ ] Chrome/Edge: funciona
- [ ] Firefox: funciona
- [ ] Safari: funciona
- [ ] Scroll smooth funciona en todos
- [ ] Fullscreen API funciona
- [ ] Focus visible funciona

---

## Test Execution Log

### Date: [AAAA-MM-DD]
**Tester:** [Nombre]
**Resolution:** [1920×1080 / 1366×768 / 1024×768 / 390×844 / 360×800]

**Results:**
- [ ] Todos los checks pasaron
- [ ] Issues encontrados (listar abajo)

**Issues (si existen):**
```
1. [Prioridad] Descripción
```

**Sign-off:**
- [ ] Listo para presentación
- [ ] Bloqueadores encontrados

---

## Final Checklist

- [ ] Todas las 5 resoluciones testeadas
- [ ] Navegación funciona (teclado, mouse, móvil, deep links)
- [ ] Accesibilidad verificada (contraste, foco, semántica)
- [ ] Contenido honesto (hardware, restricciones, estado)
- [ ] Funcionalidad interactiva sin error
- [ ] Offline funciona
- [ ] Performance aceptable
- [ ] Documentación completa
- [ ] Listo para deployment

**Aprobado para producción:** [ ] Sí / [ ] No
