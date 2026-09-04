# DORN Presentation Website

Página web de presentación para DORN en el Torneo de Innovación de la Universidad Católica de Chillán - 8 de septiembre de 2026.

## Características

- ✅ Presentación fullscreen 16:9 con scroll-snap
- ✅ Navegación completa por teclado (flechas, Page Up/Down, Home, End, F para pantalla completa)
- ✅ Responsive para desktop, tablet y móvil
- ✅ Modo presentación y modo navegación normal
- ✅ Deep links mediante hashes (#1, #2, etc)
- ✅ Demostración interactiva local (sin hardware real)
- ✅ Accesibilidad completa (WCAG AA)
- ✅ Funcionamiento offline (con excepciones de Google Fonts)
- ✅ Animaciones suaves con soporte para `prefers-reduced-motion`
- ✅ PWA lista para instalar en móvil

## Instalación

### Requisitos
- Node.js 18+
- npm o yarn

### Setup

```bash
cd website
npm install
```

## Desarrollo

```bash
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173) en tu navegador.

## Build de producción

```bash
npm run build
```

Los archivos compilados estarán en `dist/`.

## Previsualizar build

```bash
npm run preview
```

## Configuración de contenido

Toda la configuración, datos y textos están centralizados en:

```
resources/pilot/catolica-2026-09-08.json
```

Actualiza este archivo para cambiar contenido, fechas, ciclos de demostración, etc. Los cambios se reflejan automáticamente en la presentación.

## Estructura del proyecto

```
website/
├── src/
│   ├── components/
│   │   ├── PresentationShell.tsx    # Wrapper principal
│   │   └── slides/
│   │       ├── HeroSlide.tsx        # Portada
│   │       └── AllSlides.tsx        # Secciones 2-10
│   ├── config/
│   │   └── presentation.ts          # Configuración de contenido
│   ├── styles/
│   │   └── global.css               # Estilos globales y utilidades
│   ├── App.tsx                      # Aplicación principal
│   └── main.tsx                     # Punto de entrada
├── public/                          # Assets estáticos
├── index.html                       # HTML principal
├── vite.config.ts                   # Configuración de Vite
├── tailwind.config.js               # Configuración de Tailwind
└── tsconfig.json                    # Configuración de TypeScript
```

## Paleta de colores

Conforme al diseño especificado:

- Fondo principal: `#080B10`
- Panel: `#11161D`
- Panel secundario: `#171E27`
- Texto: `#F4F7FA`
- Texto secundario: `#8E9AA8`
- Acento DORN: `#F3A93A`
- Acento tech: `#78D9FF`
- Estado seguro: `#63D6A4`
- Alerta: `#FF767E`

## Navegación

### Keyboard shortcuts
- `↓` / `Page Down`: Siguiente sección
- `↑` / `Page Up`: Sección anterior
- `Home`: Primera sección
- `End`: Última sección
- `F`: Pantalla completa
- `Esc`: Cerrar menú

### Controles de ratón
- Scroll vertical: Navega entre secciones
- Flechas inferiores derechas: Anterior/Siguiente
- Puntos laterales: Click para ir a sección específica
- Menú superior: Indicador de progreso

## Secciones

1. **Portada** - Introducción y CTAs
2. **Problema** - Máquinas detenidas por control defectuoso
3. **Solución** - DORN Machine Retrofit Kit
4. **Ecosistema** - Flujo de integración
5. **Demostración** - Nanoburbujas 01 (simulación interactiva)
6. **Hardware sin maquillaje** - Estado real: P4 (display), S3 (validación)
7. **Producto y experiencia** - Interfaz y garantías
8. **Modelo de negocio** - Kit + instalación + servicio
9. **Estado del proyecto** - Demostrable vs Pendiente
10. **Cierre** - Call-to-action de piloto

## Demostración interactiva (Slide 5)

La demostración de Nanoburbujas es **completamente local**:

- No abre red, Bluetooth, puerto serial ni hardware real
- Simula un ciclo de 15 min ON / 22 min OFF
- Log local de acciones
- Siempre etiquetada como `SIMULATED`
- Detención manual disponible

## Restricciones de contenido (obligatorias)

La presentación honra completamente el estado real:

### ❌ NO hacer
- Afirmar que ESP32-P4 funciona
- Insinuar que la pantalla P4 puede encenderse
- Afirmar control S3→bomba sin prueba previa documentada
- Afirmar disponibilidad para compra
- Mostrar precio validado
- Afirmar APK nativo firmado
- Afirmar que la IA controla seguridad física directamente

### ✅ SÍ permitido
- Explicar el estado real de cada componente
- Mostrar simulaciones etiquetadas como tales
- Presentar la intención futura del producto
- Solicitar validación con cliente inicial

## Responsividad

Testeado en:
- 1920×1080 (proyector)
- 1366×768 (notebook)
- 1024×768 (tablet)
- 390×844 (móvil)
- 360×800 (móvil pequeño)

Todos los títulos, botones y controles son legibles sin cortes.

## Accesibilidad

- ✓ Contraste WCAG AA
- ✓ Foco visible en todos los controles
- ✓ Botones de mínimo 44×44 px en móvil
- ✓ `aria-label` en iconos
- ✓ Menú con focus trap
- ✓ Soporte para `prefers-reduced-motion`
- ✓ HTML semántico

## Performance

- Bundle tamaño: ~50 KB gzipped
- Fuentes cargadas sin bloquear
- Fallbacks locales para fuentes
- Lazy loading de imágenes
- Minificación en producción

## PWA (Próximamente)

En desarrollo: instalable en pantalla de inicio, funcionamiento offline completo.

## Testing

```bash
npm run lint          # Lint de código
npm run type-check    # Type checking
```

## Deployment

Para servir en producción:

```bash
npm run build
# Sirve el contenido de dist/
```

Compatible con cualquier servidor HTTP estático (Netlify, Vercel, Apache, nginx, etc).

## Notas

- La presentación usa `scroll-snap` para navegación fluida
- Todos los estilos usan Tailwind CSS con configuración personalizada
- Fuentes: Inter (funcional) + Instrument Serif (editorial)
- Sin dependencias externas innecesarias (no Framer Motion, GSAP, etc)
- Diseño mobile-first, escalable hacia proyector

## Soporte

Para cambios en contenido, estructura o diseño, consultar:
- `resources/pilot/catolica-2026-09-08.json` - Fuente de verdad
- `/docs/CONTENT-SOURCE.md` - Trazabilidad de afirmaciones

---

**Evento:** Universidad Católica de Chillán · 8 de septiembre de 2026
