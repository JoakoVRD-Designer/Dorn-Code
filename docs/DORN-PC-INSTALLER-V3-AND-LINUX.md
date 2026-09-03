# DORN PC · Installer v3 y DORN Linux

Fecha del checkpoint: 2026-09-03  
Producto: DORN AI 4.0.0-alpha.7 para Windows 11 x64  
Estado global: `PARTIAL`

## Resultado de esta unidad

Installer v3 corrige la ruta que podía dejar el instalador sin finalizar. El
extractor y los agentes de preparación/verificación ya no esperan para siempre:
cada proceso crítico tiene un tiempo máximo, termina de forma controlada y deja
un diagnóstico en `%LOCALAPPDATA%\DORN AI\Installer\installer-v3.log`.

Una instalación que ya fue verificada se declara lista antes de eliminar el
respaldo temporal. Si esa limpieza tarda o falla, se registra para revisión pero
no convierte una instalación válida en una pantalla bloqueada.

## DORN Linux

DORN Linux usa WSL 2 y Ubuntu dentro de Windows. No reemplaza Windows, no crea
dual boot y no reparte el disco. Installer v3 ofrece una casilla independiente:

`Preparar DORN Linux (WSL 2 + Ubuntu; puede pedir reinicio)`

La instalación principal de DORN termina antes de iniciar esa preparación. La
solicitud elevada de Windows ocurre por separado; rechazarla, cancelarla o tener
que reiniciar no invalida DORN AI.

Dentro de `Configuración > Herramientas > DORN Linux`, la aplicación muestra:

- estado observado de WSL 2;
- distribuciones realmente detectadas;
- modo de almacenamiento actual;
- inventario real de Node.js, npm, Python, pip, Git, GCC, Make, CMake, Rust,
  Go y Java;
- orientación de preparación cuando falta WSL 2 o Ubuntu.

La interfaz no recibe la ruta local de `wsl.exe`, no expone `spawn`, no entrega
un shell genérico y no permite `sudo` ni `eval`. La ejecución implementada en
esta etapa se limita a Node.js dentro de una Work Unit ligada al proyecto,
mediante el mismo núcleo de políticas, aislamiento y registro de DORN.

## Uso recomendado

1. Cierra DORN AI si está abierto.
2. Ejecuta `DORN_AI_Installer_v3_4.0.0-alpha.7_x64.exe`.
3. Conserva DORN AI seleccionado; elige los productos opcionales deseados.
4. Deja marcada DORN Linux si quieres preparar WSL 2 y Ubuntu.
5. Cuando DORN confirme que la aplicación está instalada, acepta la ventana de
   Windows para Linux si deseas continuar.
6. Si Windows pide reinicio, reinicia y abre Ubuntu una vez para completar su
   usuario inicial.
7. Abre DORN y entra a `Configuración > DORN Linux > Comprobar entorno`.
8. Usa `Revisar lenguajes` para saber qué herramientas existen realmente.

## Límites honestos de este checkpoint

- El `.exe` fue compilado como PE32+ x64 y su payload fue extraído y verificado
  localmente, pero todavía no fue ejecutado de extremo a extremo en un equipo
  Windows 11 real.
- La solicitud UAC, el reinicio y el primer arranque de Ubuntu siguen marcados
  `NEEDS_WINDOWS_RETEST`.
- DORN puede observar múltiples lenguajes, pero la ejecución Linux pública de
  esta unidad está acotada a Node.js. Python, Rust, Go, Java y C/C++ requieren
  adapters posteriores antes de habilitar ejecución.
- No hay firma Authenticode todavía; Windows puede mostrar SmartScreen.
- No se declara DORN terminado mientras existan estos pendientes.

## Recuperación

Installer v2 permanece preservado como checkpoint anterior. Installer v3 crea
respaldo antes de sustituir una instalación DORN exacta y registra fallos sin
ocultar el estado real. Los proyectos del usuario no forman parte del payload y
no deben eliminarse al reparar la aplicación.

