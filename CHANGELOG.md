# Changelog

Todos los cambios notables de DORN CODE se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y este proyecto sigue [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

### Added
- Registro de cambios (`CHANGELOG.md`) para documentar la evolución del proyecto.
- `DORN.md`: guía de proyecto y convenciones de trabajo (para colaboradores y asistentes de IA).

### Added
- `DORN.md`: sección "Principios de diseño: criterio y sentido común de los agentes", con requisitos de comportamiento para que los agentes de DORN CODE no ejecuten acciones costosas, irreversibles o no solicitadas sin confirmación explícita del usuario.
- `templates/`: base de plantillas reutilizables para agentes (task brief, agent handoff, entrada de changelog, descripción de PR) para reducir el consumo de tokens en tareas repetitivas. Documentado en `DORN.md`.
- `DORN.md`: sección "Compatibilidad universal de IAs", estableciendo como requisito central que DORN CODE se integre con cualquier IA del equipo del usuario (CLIs, APIs, modelos locales) y las haga trabajar en conjunto, no de forma aislada.
- `DORN.md`: sección "Medidor de gasto/uso unificado", exigiendo una vista agregada y siempre visible del consumo/costo de todas las IAs que orquesta DORN CODE, con límites configurables que disparan confirmación explícita.

### Changed
- Nombre del proyecto de "DORN AI" a "DORN CODE" en README.md, DORN.md y CHANGELOG.md.
- `LICENSE` reemplazada: de Apache 2.0 (open-source) a copyright propietario ("todos los derechos reservados", DORN). README.md y DORN.md actualizados para reflejar que el software no es de código abierto.

## [0.0.0] - 2026-09-23
### Added
- Commit inicial del repositorio: `README.md`, `LICENSE` y `.gitignore`.

[Unreleased]: https://github.com/JoakoVRD-Designer/DORN-AI/compare/main...HEAD
[0.0.0]: https://github.com/JoakoVRD-Designer/DORN-AI/releases/tag/v0.0.0
