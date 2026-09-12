# Plan de trabajo

[English](roadmap.md)

La línea activa es 3.x. El comportamiento publicado se registra en [versiones](releases.es.md); los cambios pendientes corresponden a [notas sin publicar](releases/unreleased.es.md). Los perfiles 1.x y 2.x se conservan como referencia histórica.

## Entregado

- Colas compartidas, listas guardadas, efectos y estado persistente.
- Panel local, asistente y herramientas de despliegue.
- Favoritos por usuario, fuente preferida, estadísticas y reproducción automática adaptable.
- Búsqueda de radio, títulos en directo, directorios por instancia y detección de duplicados.
- Módulos de cola y controlador separados, URL preparadas, épocas de cancelación y esperas limitadas.

## Funciones abiertas

- [Adaptador TeamSpeak 6 (#12)](https://github.com/Juanzaan/rhapsod/issues/12): implementar y verificar voz y chat mediante el contrato existente.
- [Anuncios de bienvenida (#21)](https://github.com/Juanzaan/rhapsod/issues/21): definir entradas al canal y audio opcional sin interrumpir la música.

No hay una fecha de publicación comprometida. Las incidencias deben definir criterios de aceptación antes de implementar.

## Prioridades de mantenimiento

- Mantener coherencia entre requisitos, archivos de bloqueo, instalador y contenedores.
- Probar reconexión y permisos de voz con servidores TeamSpeak reales además de pruebas simuladas.
- Separar la inicialización en módulos comprobables cuando los cambios de comportamiento lo justifiquen.
- Validar cambios de proveedores mediante solicitudes limitadas y errores visibles.
- Mantener documentación equivalente en inglés y español y notas revisadas por versión.

## Restricciones

Spotify proporciona solo metadatos. No se elude DRM. El panel permanece autenticado y local. La personalización debe respetar propiedad de cola, control del usuario y comportamiento predecible al detener.
