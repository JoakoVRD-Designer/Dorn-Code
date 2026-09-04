# Content Source Documentation

Trazabilidad de cada afirmación importante en la presentación de DORN con su fuente en el contrato de verdad.

**Documento source:** `resources/pilot/catolica-2026-09-08.json`

## Mapeo de afirmaciones

### Portada (Slide 1)
- **"Inteligencia que crea. Tecnología que devuelve vida."**
  - Source: `project.tagline`
  - Type: Directo

- **"Una plataforma de IA que transforma proyectos digitales y se extiende hacia máquinas reales mediante control local verificable."**
  - Source: `event.description` (implied)
  - Type: Síntesis de propósito

### Problema (Slide 2)
- **"A veces no muere la máquina. Muere su control."**
  - Source: `problem.title`
  - Type: Directo

- **"Una placa dañada u obsoleta puede detener un equipo que todavía conserva valor mecánico y productivo."**
  - Source: `problem.description`
  - Type: Directo

### Solución (Slide 3)
- **"No reemplazar la máquina. Recuperar su control."**
  - Source: `project.missionStatement`
  - Type: Directo

- **Componentes del DORN Machine Retrofit Kit**
  - Source: `product.includes[]`
  - Type: Directo

### Ecosistema (Slide 4)
- **"DORN AI → Aplicación PC/Móvil → ESP32-S3 → Control Autorizado → Máquina"**
  - Source: `pilot.flow`
  - Type: Directo

- **"La IA no escribe libremente sobre el relé"**
  - Source: `pilot.safetyNote`
  - Type: Directo

- **Ciclo de bomba: 15 min ON / 22 min OFF**
  - Source: `pilot.logic.onDuration`, `pilot.logic.offDuration`
  - Type: Directo

### Hardware (Slide 6)
- **ESP32-P4: "Solo exhibición - Pantalla defectuosa de fábrica"**
  - Source: `product.components[0]` (status: DISPLAY_ONLY)
  - Type: Directo

- **ESP32-S3: "Controlador de respaldo - Requiere prueba previa"**
  - Source: `product.components[1]` (status: REQUIRES_PRETEST)
  - Type: Directo

- **Ambos componentes requieren prueba/validación**
  - Source: `product.components[*].note`
  - Type: Directo

### Modelo de negocio (Slide 8)
- **Tres pilares: Kit físico + Instalación + Servicio continuo**
  - Source: `revenue.model[]`
  - Type: Directo

- **6 meses de servicio incluidos**
  - Source: `revenue.model[2]` (implied)
  - Type: Síntesis

- **Cliente inicial: Pymes, propietarios, técnicos, organizaciones**
  - Source: `customers.initial[]`
  - Type: Directo

### Estado del proyecto (Slide 9)
- **Demostrable:**
  - "DORN AI para PC en desarrollo interno"
  - "DORN Machine PC con simulador"
  - "DORN Machines Mobile como PWA"
  - "Narrativa, flujo y contrato de integración"
  - Source: `status.proven[]`
  - Type: Directo

- **Pendiente:**
  - "Prueba previa del firmware S3"
  - "Integración real PC/móvil ↔ S3"
  - "Validación del relé, protecciones, parada manual y bomba"
  - "APK nativo firmado"
  - "Precio y primer piloto comercial"
  - Source: `status.pending[]`
  - Type: Directo

- **Estado general: "PARTIAL · PILOTO EN VALIDACIÓN"**
  - Source: `status.overall`
  - Type: Directo

## Prohibiciones explícitas

Estas afirmaciones están **BLOQUEADAS** y no aparecen en la presentación:

```
prohibitions:
  - hardware: No afirmar que P4 funciona, que pantalla puede encenderse, que S3 controla sin prueba
  - product: No afirmar compra disponible, precio validado, clientes reales o ahorro medido
  - capabilities: No afirmar compatibilidad universal, control IA directo, APK nativo, comandos reales
  - evidence: No afirmar pruebas no documentadas
```

## Actualizaciones permitidas

Estos campos pueden actualizarse sin cambiar la estructura:

1. **Fechas y ubicación:** `event.date`, `event.location`
2. **Contacto:** `contact.email`, `contact.form`, `contact.url`
3. **Ciclos de demostración:** `pilot.logic.onDuration`, `pilot.logic.offDuration`
4. **Descripción de estado:** `status.overall`, `status.proven[]`, `status.pending[]`
5. **Modelo de ingresos:** `revenue.model[]`, `revenue.pricing`

## Verificación

✓ Cada slide se construye leyendo directamente de `config.presentation`
✓ No hay valores hardcodeados que contradiguen el JSON
✓ Todas las secciones restringen afirmaciones bloqueadas
✓ El estado real del hardware está claramente visible
✓ Las simulaciones están etiquetadas como tales
✓ No hay promesas no validadas

---

**Fecha de documento:** 4 de septiembre de 2026
**Responsable:** DORN Team
