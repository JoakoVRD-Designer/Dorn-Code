# Autenticación futura oculta de DORN AI 4.0.0-alpha.7

La interfaz de identidad permanece incluida en el proyecto, pero no forma parte
del flujo visible de esta versión. DORN AI carga directamente el espacio de
trabajo y no consulta el estado de sesión al abrirse.

## Estado interno

- `out/renderer/vendor/dorn-feature-flags.js` define
  `accountAuthentication: false` y `accountControls: false`.
- `out/renderer/vendor/dorn-auth.js` conserva las pantallas y la integración,
  pero las omite completamente mientras la bandera esté desactivada.
- No se crea la capa visual de autenticación, no se consulta DORN Admin y no se
  añade el control de cuenta a la barra lateral.
- El cliente, IPC, registro, inicio de sesión, verificación de seis dígitos,
  recuperación y cierre de sesión permanecen en los archivos para una versión
  futura.

## Modelo de identidad conservado

- Una cuenta DORN AI servirá para toda la suite.
- DORN Admin conservará una cuenta independiente, privada para el operador.
- El mismo correo podrá existir en ambos ámbitos con contraseñas diferentes.
- Los nombres visibles podrán repetirse.
- La contraseña admitirá sólo minúsculas y tendrá entre 8 y 256 caracteres.
- DORN AI no almacenará contraseñas; DORN Admin conservará únicamente hashes
  bcrypt.

Habilitar estas banderas será una decisión explícita de una versión posterior,
acompañada de pruebas del servidor, correo, migraciones y experiencia completa.
