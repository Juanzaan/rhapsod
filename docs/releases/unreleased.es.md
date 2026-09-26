[English](unreleased.md)

## Resumen

Agrega una aplicación de bandeja para Windows que abre el panel.

## Cambios

- Agregar un lanzador del panel para Windows (`tools/desktop`): abre el túnel SSH y el navegador, guarda la conexión en `%APPDATA%` y la contraseña del panel en el Administrador de credenciales de Windows, y no incluye servidor ni contraseña en el ejecutable. La integración continua lo compila en Windows.
- Convertir el lanzador de Windows en una aplicación de bandeja: reconecta sola el túnel SSH, muestra en el icono qué se está reproduciendo, abre el panel en una ventana propia con un perfil separado, ejecuta una sola copia y edita su configuración en una ventana. La integración continua ejecuta su autoprueba.

## Actualización

No se requieren acciones además de los pasos de actualización de v4.0.0.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`.
