# SDK de plugins de DORN Installer Studio

Este contrato permite preparar extensiones para inspeccionar proyectos, validar
manifiestos, transformar una copia del manifiesto y participar en fases de
compilación o publicación.

## Estado real en alpha.7

- El esquema, los permisos, los hooks y una plantilla ejecutable están definidos.
- El manifiesto puede validarse en pruebas y versionarse junto al plugin.
- El host de ejecución específico de Installer Studio todavía está pendiente.
- Ningún plugin de este SDK se carga automáticamente en alpha.7.

Esta separación es intencional: no se debe ejecutar código de terceros hasta
tener aislamiento por proceso, límites de tiempo y memoria, hash del paquete,
registro de operaciones, autorización explícita de cada permiso y recuperación
ante fallos.

## Estructura prevista

```text
mi-plugin/
├── dorn-installer-plugin.json
└── index.js
```

Ejemplo de manifiesto:

```json
{
  "schemaVersion": 1,
  "id": "cl.dorn.example.metadata",
  "name": "Metadata Validator",
  "version": "0.1.0",
  "publisher": "DORN",
  "description": "Comprueba metadatos antes de construir.",
  "entry": "index.js",
  "engine": {
    "dornInstaller": ">=3.0.0-alpha.7"
  },
  "hooks": ["validate-project", "transform-manifest"],
  "permissions": ["project:read", "manifest:read", "manifest:transform"]
}
```

## Reglas de seguridad

1. Un plugin declara sólo los hooks y permisos que realmente utiliza.
2. `project:write-generated` nunca autoriza reemplazar archivos fuente.
3. `network:https` requiere además una lista `networkHosts`.
4. `publish:external` exige confirmación para cada destino y compilación.
5. Las credenciales no forman parte del manifiesto ni de la entrada del hook.
6. Toda transformación recibe una copia JSON y devuelve una copia validable.
7. Un fallo debe detener el hook sin dañar el proyecto ni el artefacto anterior.

## Firma de hooks

La plantilla de `plugin-template.js` documenta la interfaz propuesta. El objeto
`context` incluirá únicamente capacidades autorizadas. No debe asumirse acceso
a Node.js, Electron, al sistema completo ni a variables de entorno.
