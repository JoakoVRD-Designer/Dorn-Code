# Plugins DORN

Un plugin contiene `dorn-plugin.json` y un archivo de entrada JavaScript. Se instala desactivado y solicita permisos explícitos.

La primera API activa permite registrar comandos:

```js
defineDornPlugin({
  activate(context) {
    context.commands.register("example.inspect", async (input) => ({
      message: `Analizado: ${input.name}`
    }));
  }
});
```

El worker no expone `process`, `require`, red ni sistema de archivos. Las futuras APIs de formato, panel, herramienta y agente se añadirán sin entregar acceso irrestricto al equipo.
