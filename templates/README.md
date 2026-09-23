# Plantillas de DORN CODE

Plantillas reutilizables para tareas repetitivas de los agentes. En vez de
redactar contexto, instrucciones o formato desde cero en cada ejecución
(lo que consume tokens innecesariamente), un agente completa una plantilla
existente con los datos específicos de la tarea.

## Cómo usarlas

1. Elegir la plantilla que coincida con el tipo de tarea.
2. Copiar su contenido y reemplazar únicamente los campos entre `{{ }}`.
3. No repetir en el prompt información que la plantilla ya deja implícita
   (formato, secciones, tono): eso es justamente lo que ahorra tokens.

## Cómo agregar una plantilla nueva

Agregar una plantilla solo cuando una tarea se repite de forma reconocible
(no para casos únicos). Cada plantilla debe:

- Tener un propósito único y un nombre descriptivo (`kebab-case.md`).
- Marcar sus campos variables con `{{nombre_campo}}`.
- Incluir, al final, cuándo usarla y cuándo no.
- Quedar listada en la tabla de abajo, con una entrada nueva en
  `CHANGELOG.md`.

## Plantillas disponibles

| Plantilla | Uso |
|---|---|
| [`task-brief.md`](task-brief.md) | Definir una tarea para un agente de forma compacta (objetivo, contexto mínimo, restricciones, salida esperada). |
| [`agent-handoff.md`](agent-handoff.md) | Traspasar contexto entre agentes/sesiones sin reenviar el historial completo. |
| [`changelog-entry.md`](changelog-entry.md) | Redactar una entrada de `CHANGELOG.md` con el formato correcto. |
| [`pr-description.md`](pr-description.md) | Redactar la descripción de un pull request de forma consistente. |
