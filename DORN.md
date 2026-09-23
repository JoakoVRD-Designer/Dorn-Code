# DORN.md

Guía de proyecto para DORN CODE: qué es, cómo está organizado y las
convenciones que deben seguir tanto colaboradores humanos como asistentes de
IA (Claude Code u otros) que trabajen en este repositorio.

## Qué es DORN CODE

DORN CODE es una plataforma de orquestación multi-agente de código abierto que
unifica modelos de IA locales y proveedores en la nube en un único espacio de
trabajo inteligente para ingeniería, programación, investigación y
productividad.

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
| `LICENSE` | Licencia del proyecto. |
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

## Próximos pasos sugeridos

- Definir el stack técnico (lenguaje(s), framework(s), gestor de paquetes).
- Definir la estructura de agentes/orquestación (cómo se registran modelos
  locales y proveedores en la nube).
- Añadir instrucciones de setup/desarrollo local en cuanto exista código
  ejecutable.
