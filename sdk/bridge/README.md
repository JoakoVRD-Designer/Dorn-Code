# Adaptadores DORN Bridge

Un adaptador conecta DORN con una aplicación autorizada sin incorporar código propietario al núcleo.

## Contrato

DORN ejecuta el programa configurado con tres rutas:

```text
adaptador.exe <request.json> <response.json>
```

También puede usar `{workspace}` como argumento. El manifiesto decide el orden exacto.

La solicitud usa `dorn-bridge/1`:

```json
{
  "schema": "dorn-bridge/1",
  "jobId": "uuid",
  "operation": "inspect-3d",
  "input": {
    "file": {
      "name": "pieza.obj",
      "path": "copia-aislada/input/pieza.obj",
      "sizeBytes": 1200,
      "sha256": "..."
    }
  },
  "outputDirectory": "copia-aislada/output"
}
```

El adaptador debe escribir:

```json
{
  "schema": "dorn-bridge/1",
  "jobId": "el mismo uuid",
  "status": "completed",
  "message": "Modelo inspeccionado",
  "metrics": {},
  "artifacts": [
    {
      "relativePath": "output/reporte.json",
      "mediaType": "application/json"
    }
  ]
}
```

DORN comprueba que cada artefacto permanezca dentro del trabajo, sea un archivo regular y no supere los límites establecidos. Luego calcula tamaño y SHA-256.

## Cinema 4D y otras aplicaciones

El adaptador puede usar código propio, un plugin autorizado o el SDK oficial de la aplicación. No debe incluir código interno, recursos ni binarios propietarios sin licencia. Para integrarlo se necesitan:

- código fuente o binario autorizado del adaptador;
- versión de la aplicación y del SDK;
- operaciones que soporta;
- formatos de entrada y salida;
- licencia y dependencias;
- instrucciones oficiales de instalación o ejecución.
