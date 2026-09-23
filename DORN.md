# DORN.md

Guía de proyecto para DORN CODE: qué es, cómo está organizado y las
convenciones que deben seguir tanto colaboradores humanos como asistentes de
IA (Claude Code u otros) que trabajen en este repositorio.

## Qué es DORN CODE

DORN CODE es una plataforma propietaria de orquestación multi-agente que
unifica modelos de IA locales y proveedores en la nube en un único espacio de
trabajo inteligente para ingeniería, programación, investigación y
productividad. El software es de código cerrado; todos los derechos están
reservados por DORN (ver `LICENSE`).

Un requisito central: DORN CODE debe ser compatible con cualquier IA
existente en el equipo del usuario —CLIs, APIs, modelos locales— y hacer
que trabajen en conjunto, no de forma aislada. Ver "Compatibilidad
universal de IAs" más abajo.

> Estado actual: el repositorio está en etapa inicial. Todavía no hay código
> de aplicación; este documento define las bases (propósito, convenciones,
> registro de cambios) antes de que empiece a crecer la base de código.
> Actualiza esta sección a medida que se defina la arquitectura real
> (stack, estructura de carpetas, módulos de agentes, integraciones de
> proveedores, etc.).

## Estructura del repositorio

| Archivo/carpeta | Propósito |
|---|---|
| `README.md` | Descripción breve del proyecto (una línea + enlace a este documento y al changelog). |
| `DORN.md` | Este archivo: guía de proyecto y convenciones de trabajo. |
| `CHANGELOG.md` | Registro histórico de cambios notables, formato Keep a Changelog. |
| `LICENSE` | Aviso de copyright propietario ("todos los derechos reservados"), no una licencia open-source. |
| `templates/` | Plantillas reutilizables para tareas repetitivas de agentes (ver más abajo). |
| `.gitignore` | Ignora artefactos de build/dependencias típicos de un stack Node/JS. |

## Convenciones de trabajo

### Registro de cambios (CHANGELOG.md)

Todo cambio notable (feature, fix, breaking change, cambio de dependencias
importante) debe añadirse como entrada bajo `[Unreleased]` en
`CHANGELOG.md` en el mismo commit/PR que lo introduce, usando las categorías
de Keep a Changelog: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`. Cambios triviales (typos, formato, comentarios) no requieren
entrada.

### Commits

- Mensajes claros y descriptivos, en modo imperativo ("Add X", "Fix Y").
- Un commit por cambio lógico; evitar mezclar refactors con features.
- No usar `--no-verify` ni saltar hooks salvo pedido explícito.

### Ramas y PRs

- Desarrollar en ramas de feature, nunca directo sobre `main`.
- Cada PR debe dejar `CHANGELOG.md` actualizado si introduce un cambio
  notable.
- No crear PRs salvo que se pida explícitamente.

### Para asistentes de IA (Claude Code y similares)

- Antes de hacer cambios, revisar `CHANGELOG.md` para entender el historial
  reciente y evitar duplicar trabajo.
- Al terminar un cambio, añadir la entrada correspondiente en
  `CHANGELOG.md` bajo `[Unreleased]`.
- No inventar detalles de arquitectura, stack o funcionalidades que no
  existan todavía en el repo; si hace falta documentar una decisión nueva,
  agregarla aquí (`DORN.md`) explícitamente como tal.
- Mantener el código sin comentarios explicativos triviales; solo comentar
  lo que no sea obvio (motivo de una decisión no evidente).
- Preferir cambios mínimos y enfocados sobre refactors amplios no
  solicitados.

## Principios de diseño: criterio y sentido común de los agentes

Los agentes de DORN CODE pueden actuar con autonomía real: ejecutar
comandos, gastar dinero, enviar mensajes, modificar infraestructura. Por
eso el criterio y el sentido común no son un detalle de implementación
posterior, son un requisito de diseño desde el inicio.

**Motivación**: hay casos reportados de agentes de IA (p. ej. asistentes
tipo "Astra" sobre modelos de OpenAI) que ejecutaron acciones que el
usuario nunca pidió —incluyendo compras de miles de dólares— por
interpretar de más una instrucción ambigua. Un agente de DORN CODE no debe
poder causar ese tipo de daño.

### Requisitos de comportamiento

- Distinguir entre lo que el usuario pidió literalmente y lo que el agente
  "infiere" que sería útil; ante la duda, preguntar, no asumir ni actuar.
- Nunca ejecutar acciones irreversibles, costosas, o que afecten sistemas,
  cuentas o dinero de terceros sin confirmación explícita previa del
  usuario.
- Evaluar el "radio de impacto" de cada acción (local/reversible vs.
  compartido/irreversible/financiero) y pedir confirmación proporcional al
  riesgo, no un mismo nivel de fricción para todo.
- Explicar qué se va a hacer y por qué *antes* de ejecutar una acción de
  alto impacto, nunca después de haberla ejecutado.
- Ante un obstáculo, preferir el camino reversible; nunca usar atajos
  destructivos (borrar, forzar, gastar, publicar) para "resolver" algo más
  rápido.
- Tratar el silencio o la ambigüedad del usuario como falta de permiso,
  no como autorización implícita.

### Próximos pasos técnicos

- Definir niveles de permiso/confirmación por tipo de acción (lectura,
  escritura local, escritura compartida, acción financiera).
- Diseñar límites de gasto/alcance configurables por el usuario.
- Registrar y auditar toda acción de alto impacto ejecutada por un agente.

## Compatibilidad universal de IAs

DORN CODE debe poder integrar cualquier IA disponible en el equipo del
usuario, sin importar cómo se exponga, y hacer que colaboren entre sí en
una misma tarea —no ejecutarse aisladas unas de otras. Esto incluye, como
mínimo:

- **CLIs locales**: herramientas de IA instaladas en el sistema (ej.
  Claude Code, y cualquier otra CLI de IA que el usuario tenga).
- **APIs en la nube**: cualquier proveedor con API (Anthropic, OpenAI,
  Google, etc.), no uno solo.
- **Modelos locales**: modelos corriendo en el propio equipo (ej. vía
  Ollama, LM Studio u otros runtimes locales).
- **Cualquier otra IA presente en el sistema** que exponga alguna forma de
  invocación (CLI, API, SDK, socket local, etc.).

### Requisitos

- No acoplar el diseño a un único proveedor, protocolo o formato de
  integración; DORN CODE es el orquestador común, no un cliente de una
  sola IA.
- Detectar/registrar las IAs disponibles en el equipo (CLIs instaladas,
  credenciales de API configuradas, modelos locales activos) en vez de
  requerir configuración manual completa para cada una.
- Definir una interfaz/adaptador común para que cualquier IA (CLI, API,
  modelo local) se conecte de la misma forma a DORN CODE, traduciendo su
  protocolo nativo a esa interfaz.
- Permitir que agentes de distintos proveedores colaboren en una misma
  tarea (orquestación real), con un mecanismo para pasar contexto y
  resultados entre ellos.

### Próximos pasos técnicos

- Diseñar la capa de adaptadores (uno por tipo de integración: CLI, API
  REST, SDK, modelo local) y el contrato común que exponen a DORN CODE.
- Definir cómo se descubren y autentican/configuran las credenciales de
  cada proveedor de forma segura.
- Definir el protocolo de coordinación entre agentes de distintos orígenes
  (quién decide, cómo se pasan resultados, cómo se resuelven conflictos
  entre agentes).

## Plantillas para agentes (ahorro de tokens)

`templates/` contiene plantillas reutilizables para las tareas que un
agente repite seguido (definir una tarea, traspasar contexto entre
agentes, redactar una entrada de changelog, describir un PR). La idea es
que el agente complete campos fijos en vez de regenerar desde cero el
mismo tipo de contexto/formato en cada ejecución, lo que reduce el consumo
de tokens y mantiene la salida consistente.

- Antes de redactar libremente un texto que encaje en una tarea repetitiva
  (task brief, handoff, entrada de changelog, descripción de PR), revisar
  si ya existe una plantilla en `templates/` y usarla.
- Agregar una plantilla nueva solo cuando el patrón se repite (ver
  `templates/README.md` para el criterio y el formato).

## Aplicaciones futuras

### Gestión de maquinaria empresarial mediante agentes

Además de los casos de uso actuales (ingeniería, programación,
investigación, productividad), se contempla como proyecto futuro extender
DORN CODE al manejo de maquinaria empresarial/industrial mediante agentes:
agentes que monitoreen, operen o coordinen equipos y líneas de producción
de una empresa, bajo los mismos principios ya definidos en este documento
(criterio y sentido común de los agentes, confirmación explícita para
acciones de alto impacto, compatibilidad con las IAs y sistemas ya
presentes en el entorno del cliente).

Este es un dominio de aplicación a futuro, no un requisito del núcleo de
DORN CODE hoy. Antes de comenzar su implementación hay que definir:

- Qué tipo de maquinaria/equipos se busca soportar y cómo se integran
  (protocolos industriales, sensores, PLCs/SCADA u otros sistemas de
  control ya existentes en la empresa).
- Qué acciones puede tomar un agente de forma autónoma y cuáles requieren
  confirmación humana explícita, dado que aquí el "radio de impacto" de un
  error puede incluir riesgo físico/de seguridad, no solo económico.
- Requisitos de seguridad y cumplimiento normativo específicos del sector
  industrial (más estrictos que los de un entorno puramente de software).

## Próximos pasos sugeridos

- Definir el stack técnico (lenguaje(s), framework(s), gestor de paquetes).
- Definir la estructura de agentes/orquestación (cómo se registran modelos
  locales y proveedores en la nube).
- Añadir instrucciones de setup/desarrollo local en cuanto exista código
  ejecutable.
