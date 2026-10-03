[English](unreleased.md)

## Resumen

La aplicación de bandeja de Windows ya no deja la ventana del panel en blanco cuando el túnel pasa solo los encabezados de cada respuesta.

## Cambios

- Aplicación de Windows: la ventana del panel se abre después de una respuesta de estado completa. Dos respuestas seguidas cortadas después de los encabezados pasan la aplicación a un relevo con `ssh -W`, con un aviso que recomienda el cliente OpenSSH de Windows. Visto con el `ssh.exe` de Git para Windows.

## Actualización

No se requieren acciones además de los pasos de actualización de v4.1.0.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`.
