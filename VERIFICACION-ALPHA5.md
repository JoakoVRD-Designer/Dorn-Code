# Verificación — DORN AI 4.0.0-alpha.5

La compilación se considera entregable sólo después de ejecutar:

1. comprobación sintáctica de todos los módulos nuevos;
2. pruebas de regresión del proyecto;
3. pruebas de autenticación DORN AI ↔ DORN Admin;
4. pruebas de clasificación multimedia y comprimidos;
5. validación del runtime oficial Electron para Windows x64;
6. inspección PE y contenido del instalador nativo;
7. verificación de integridad y tamaño de portable, editable e instalador.

La prueba UAC automatizada valida la lógica, persistencia, revocación y construcción del proceso elevado. La aparición visual del cuadro UAC debe confirmarse en un equipo Windows 11 porque Linux no puede emular el escritorio seguro de Windows.
