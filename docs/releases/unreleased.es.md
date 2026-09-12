[English](unreleased.md)

## Resumen

Correcciones de persistencia, actualización de dependencias, reparación del despliegue y documentación bilingüe uniforme de versiones.

## Cambios

- Rediseño del panel con distribución adaptable, fondos animados locales, preferencias de movimiento, controles de radio y reproducción automática y búsqueda de posición con teclado.
- Conservación de favoritos e historial sin cargar al cerrar; rechazo de posiciones de favoritos no válidas.
- Límite de pistas en memoria y caducidad del refuerzo de sesión tras inactividad.
- Actualización de dependencias compatibles, incluidas libopus-wasm, Hono, Zod y Vitest.
- Renovación visual del panel y prevención de respuestas antiguas, con reintento de carga de ajustes.
- Reparación de Python y del inicio del servicio en Docker; conservación de configuración y cookies al repetir el instalador.
- Notas históricas y futuras uniformes en inglés y español, con instrucciones de actualización y verificación.

## Actualización

Se requiere Node.js >=22.19.0. Respaldar configuración y datos, ejecutar `npm ci` y `npm run build`, y reiniciar cuando `/api/state` indique `playerState: "idle"`.

Docker Compose utiliza la red del host Linux para mantener panel y servicio en localhost. Revisar la guía de despliegue antes de recrear contenedores. Los formatos de datos existentes siguen siendo compatibles.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`. Probar un reinicio en reposo antes de usar favoritos o estadísticas y confirmar que se conservan. Comprobar reproducción, radio, ajustes del panel y alternativa del servicio en el despliegue de destino.
