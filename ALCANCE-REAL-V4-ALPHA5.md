# Alcance real — DORN AI 4.0.0-alpha.5

Esta entrega amplía la base completa de Alpha 3; no sustituye la arquitectura ni elimina módulos existentes.

## Integrado

- Flujo de 7 segundos → comprobación de sesión → DORN AI o bienvenida.
- Registro en dos pasos, inicio de sesión por correo, sesión persistente cifrada y cierre de sesión.
- Flujo Google OAuth preparado mediante DORN Admin; requiere credenciales oficiales en el entorno del servidor.
- Presencia activa/ausente/desconectada, última actividad y reportes técnicos sin conversaciones ni archivos.
- Selección múltiple de adjuntos y clasificación extensible de imágenes, audio, video, comprimidos, ejecutables, documentos, código, 3D y CAD.
- Imágenes visibles, audio/video reproducible y galería indexada de resultados por proyecto.
- Perfil Desarrollador con confirmación interna, solicitud UAC real por acción elevada y permiso temporal “Sí a todas” limitado a la consola actual.
- Identidad visual común para DORN Design, Editor, Education, Machine y Studio 3D, con iconos por inicial en PNG/ICO.
- DORN Admin v1.0 como aplicación y servidor independientes, con usuarios, sesiones, presencia, errores, tablero, proyectos, infraestructura y un libro ERP base.

## Límites honestos

- Google no funciona hasta configurar `DORN_GOOGLE_CLIENT_ID`, `DORN_GOOGLE_CLIENT_SECRET` y el redirect URI oficial.
- El UAC sólo puede validarse de extremo a extremo en Windows; no existe ni se almacena un token UAC permanente.
- Los formatos propietarios se detectan y se abren con software instalado/licenciado; DORN no redistribuye Photoshop, SOLIDWORKS, AutoCAD u otras aplicaciones.
- El ERP de Admin es una base operativa inicial, no una contabilidad certificada ni un ERP completo listo para producción.
- Para despliegue público faltan dominio HTTPS, base de datos administrada, copias externas, rotación de secretos y auditoría de seguridad independiente.
