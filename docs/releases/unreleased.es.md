[English](unreleased.md)

## Resumen

Un link de YouTube empieza antes: el título y la duración salen del mismo pedido que busca el audio, sin lanzar antes un proceso de yt-dlp.

## Cambios

- `!play <link de YouTube>` lee el título, la duración y la URL del audio con un solo pedido al reproductor de Innertube. Las transmisiones en vivo, los videos que no se pueden reproducir y las respuestas sin una URL de audio simple siguen por yt-dlp. La línea de log `Track metadata resolved` con `winner: "innertube-android-vr"` indica el camino rápido.
- Cuando el cliente ANDROID_VR responde sin una URL de audio simple o con un error, el bot le pregunta al cliente VISIONOS antes de lanzar yt-dlp. Un tiempo de espera vencido no pasa al siguiente cliente, así que la espera antes de yt-dlp sigue en 5 s. El log muestra `winner: "innertube-visionos"` cuando gana el segundo cliente. Los clientes de TV y web móvil no se usan: sus URLs necesitan el JavaScript del reproductor de YouTube para decodificarse.
- La imagen Docker ya no lleva los paquetes de desarrollo del build (TypeScript, esbuild, ESLint, Vitest y otros, unos 75 MB sin comprimir): `npm prune` corre ahora en la etapa de build, antes de copiar `node_modules` a la imagen final.

## Actualización

No se requieren acciones además de los pasos de actualización de v4.1.0.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`.
