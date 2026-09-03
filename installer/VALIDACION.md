# Validación del instalador v4 alpha 4

El instalador principal se compila desde C como aplicación gráfica PE32+ x64.
El constructor añade un ZIP comprimido con el portable completo y termina el
archivo con un tráiler binario `DORNZIP3`: desplazamiento, tamaño y SHA-256 del
payload. El propio instalador vuelve a calcular SHA-256 con BCrypt antes de
invocar la extracción local de Windows. Si falta un byte o el hash no coincide,
no copia archivos.

`scripts/verify-native-installer.cjs` realiza una segunda comprobación externa:
extrae el ZIP del EXE, prueba su estructura, valida el runtime Electron oficial,
compara siete archivos críticos byte por byte con el portable y revisa el
desinstalador incluido.

La publicación debe comprobar:

- `DORN AI.exe` como PE32+ x64 con las 14 secciones completas;
- tamaño oficial de Electron 37.2.6: 205.883.904 bytes;
- coincidencia SHA-256 del payload declarado dentro del instalador;
- coincidencia byte por byte de `app.asar`, splash, sonido y manifiesto;
- presencia del runtime local, DORN Design, Education, Machine, documentación y diagnóstico;
- instalador y desinstalador como PE32+ x64 completos;
- subsistema Windows GUI y metadatos de versión 4.0.0-alpha.4;
- ejecución de `npm run verify` sobre el contenido de `app.asar`;
- smoke del proceso principal con SQLite, Suite Core y ventanas aisladas.

Los tamaños y hashes de cada publicación se escriben fuera del paquete en
`DORN_AI_Windows_4.0.0-alpha.4_SHA256SUMS.txt`. Esto evita que un documento
incluido en el propio `app.asar` cree una dependencia circular al calcular el
hash final.

Pendiente fuera de este entorno: ejecutar visualmente el flujo completo en un
escritorio Windows 11 x64, comprobar la salida de audio física y firmar el
instalador con un certificado oficial del editor.

El constructor NSIS segmentado continúa disponible como alternativa editable,
pero no forma parte de la verificación binaria de esta publicación.
