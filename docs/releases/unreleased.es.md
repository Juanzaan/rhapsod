[English](unreleased.md)

## Resumen

Agrega un lanzador del panel para Windows.

## Cambios

- Agregar un lanzador del panel para Windows (`tools/desktop`): abre el túnel SSH y el navegador, guarda la conexión en `%APPDATA%` y la contraseña del panel en el Administrador de credenciales de Windows, y no incluye servidor ni contraseña en el ejecutable. La integración continua lo compila en Windows.

## Actualización

No se requieren acciones además de los pasos de actualización de v4.0.0.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`.
