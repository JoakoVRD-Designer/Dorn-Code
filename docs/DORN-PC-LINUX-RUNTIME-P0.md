# DORN PC — Linux Runtime P0

Estado: `PARTIAL / P0_NEEDS_WINDOWS_RETEST`

## Contrato de producto

DORN AI continúa siendo una sola aplicación principal. Windows 11 es el anfitrión y WSL 2 es el primer Linux administrado. Linux no reemplaza la interfaz DORN ni crea otro producto: aporta el entorno de ejecución para herramientas, agentes y compilaciones.

Cada ejecución Linux pertenece a un proyecto DORN y a una Work Unit aislada. DORN conserva el objetivo, el alcance de archivos, la distribución seleccionada, el hash de `wsl.exe`, el estado de ejecución y la recuperación después de un cierre inesperado. Un agente nunca es propietario durable del proyecto.

## Targets

| Target | Estado | Uso |
|---|---|---|
| `LOCAL_WINDOWS` | Existente | Herramientas nativas verificadas |
| `LOCAL_WSL` | P0 implementado; falta retest Windows | Linux local administrado |
| `UBUNTU_QEMU` | Planificado | Aislamiento reforzado |
| `SSH_REMOTE` | Planificado | Linux remoto autorizado |
| `REMOTE_DORN_NODE` | Planificado | Nodo DORN controlado |
| `CONTAINER` | Planificado | Entorno reproducible por proyecto |
| `CLOUD_WORKER` | Planificado | Trabajo remoto con política y cuota |

Los estados planificados no aparecen como disponibles ni ejecutables.

## Seguridad P0

- Inspección de WSL mediante `wsl.exe --list --verbose`, sin `shell`.
- Sólo distribuciones WSL 2 seleccionadas explícitamente.
- Huella SHA-256 del ejecutable antes de preparar y antes de ejecutar.
- Forma de comando fija: `wsl.exe --distribution <distro> --exec node <argumentos acotados>`.
- Bloqueo de `eval`, preload, loaders, URL, rutas externas, `sudo`, intérpretes y comandos concatenados.
- Entorno reducido; las credenciales no entran en argumentos, estado durable ni salida.
- Ejecución obligatoria dentro de Work Unit.
- `RUNNING` se recupera como `INTERRUPTED`; nunca como completado.
- P0 no instala WSL, distribuciones, paquetes ni agentes.
- P0 no afirma aislamiento de red ni control completo del árbol WSL. Ambos requieren retest y endurecimiento en Windows.

## Almacenamiento

P0 utiliza compatibilidad con el Worktree ubicado en el sistema de archivos Windows. Esto permite validar el contrato primero, pero no es la modalidad final de máximo rendimiento. P1 moverá las Work Units Linux intensivas a ext4 dentro de WSL, con sincronización por manifiesto y hashes hacia el proyecto DORN.

## Gate de aceptación en Windows

1. Detectar `wsl.exe` real y conservar su hash.
2. Enumerar una distribución WSL 2 sin iniciar instalaciones.
3. Crear una Work Unit sin modificar el proyecto principal.
4. Ejecutar un test Node sin shell y sin red solicitada.
5. Cancelar y comprobar que el árbol de procesos no sobreviva.
6. Reiniciar DORN durante una ejecución y recuperar `INTERRUPTED`.
7. Verificar que un cambio en `wsl.exe`, la distribución o los bytes obligue a revisar.
8. Medir rendimiento NTFS/WSL frente a ext4 antes de aprobar P1.
