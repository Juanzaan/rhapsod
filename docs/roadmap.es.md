# Plan de trabajo

[English](roadmap.md)

La versión actual es 4.0.0. El comportamiento publicado se registra en [versiones](releases.es.md); los cambios pendientes corresponden a [notas sin publicar](releases/unreleased.es.md). Los perfiles 1.x, 2.x y 3.x se conservan como referencia histórica.

## Entregado

- Colas compartidas, listas guardadas y estado persistente.
- Panel local, asistente y herramientas de despliegue.
- Favoritos por usuario, fuente preferida, estadísticas y reproducción automática como DJ (pistas similares, clásicos del canal, descubrimientos).
- Búsqueda de radio, títulos en directo, directorios por instancia y detección de duplicados.
- Módulos de cola y controlador separados, URL preparadas, épocas de cancelación y esperas limitadas.
- Control de salida para ffmpeg y ffprobe, cuarentena de archivos de datos ilegibles y escrituras agrupadas.

### Entregado en 4.0.0 del plan de la ronda 3

Los números conservan el orden del plan aprobado en #124.

- **1.** Indicadores de reproducción por pista e informe en `scripts/log-stats.mjs` (#126).
- **2.** `GET /api/metrics` en formato de texto de Prometheus (#127).
- **3.** Reanudar un flujo que se detiene a mitad de canción (#128).
- **4.** Reutilizar URL preparadas solo mientras duren toda la pista (#129).
- **7.** Evaluación de búsqueda sin conexión con un piso contra regresiones (#130, #131).
- **8.** Evaluación de la reproducción automática (#132).
- **9.** Un catálogo único para los textos del chat (#133).
- **10.** `!help <comando>` y la indicación de la categoría siguiente (#135).
- **11.** Votación opcional para saltar, `RHAPSOD_VOTE_SKIP` (#136, con #125 del carril A).
- **12.** Registro de comandos basado en tablas (#137).
- **13.** `npm run smoke`, ejecutado por las pruebas (#140).
- **14.** `src/main.ts` dividido en módulos con pruebas dentro de `src/bootstrap/` (#142 a #149).
- **19.** `scripts/deploy.sh` con vuelta atrás automática (#138, carril A).

## Trabajo planificado

Cada punto se entrega en su propio PR con una prueba de regresión, documentación bilingüe y notas sin publicar.

- **5. Ajuste del cambio sin pausa.** Con las pausas medidas en el punto 1, ajustar cuándo se precarga la pista siguiente y conservar el flujo precargado ante saltos de posición y ediciones de la cola que no cambian la pista siguiente. El objetivo y el alcance dependen de los datos de producción de `scripts/log-stats.mjs`; se omite si la pausa ya es menor a 200 ms en p90. Riesgo: medio.
- **6. Revisión del volumen.** Informar la dispersión del volumen medido por sesión a partir del perfilador de volumen y ajustar el objetivo por defecto o el camino alternativo solo si la diferencia es audible. Riesgo: bajo.
- **15. Scripts del panel como archivos reales.** Hecho: todos los scripts de las páginas (ambiente, árbol del servidor, tablero, Comandos, Servidor, Ajustes, asistente de configuración) están en `src/panel/scripts/`, revisados con ESLint y `tsc -p tsconfig.panel.json` y todavía incluidos en línea por la CSP. Al moverlos aparecieron los errores del asistente corregidos en #156.
- **16. Servidor TeamSpeak simulado (carril A).** Un servidor con guion o datos grabados para ejercitar el adaptador de TeamSpeak y la inicialización sin un servidor real. Corresponde a `src/adapters/ts3/`; lo toma la sesión del carril A.

### Propuestos por el carril A (abiertos a veto)

- **18. Aplicación de escritorio para Windows.** `tools/desktop` (C#, WinForms y WebView2): gestor del túnel SSH, panel integrado, estado en la bandeja del sistema, reinicio y actualización seguros. Inicia sesión con tokens del panel de corta duración emitidos por SSH en lugar de una contraseña guardada en el programa. El soporte de tokens cambia la autenticación del panel después de que se integre el punto 2.
- **20. Refuerzo de CI.** `systemd-analyze verify` para las unidades, `shellcheck` para los scripts, un runner de Windows y acciones fijadas por SHA de commit.

### Solo propuesta: almacenamiento

17. **SQLite.** Recomendación: mantener por ahora los almacenes en JSON. Desde #104 y #113, los archivos ilegibles se ponen en cuarentena y las escrituras se agrupan, y el almacén más grande, el historial de escucha, tiene un límite de 50.000 entradas por usuario. `node:sqlite` sigue siendo experimental en Node 22, la versión mínima admitida. Volver a evaluarlo cuando un almacén necesite consultas que los archivos JSON no resuelven, o cuando el historial supere unos 20 MB. Una migración importaría cada archivo JSON una vez al iniciar en una sola base, conservaría el JSON como respaldo y saldría como versión mayor.

## Funciones abiertas

- [Adaptador TeamSpeak 6 (#12)](https://github.com/Juanzaan/rhapsod/issues/12): implementar y verificar voz y chat mediante el contrato existente.
- [Anuncios de bienvenida (#21)](https://github.com/Juanzaan/rhapsod/issues/21): definir entradas al canal y audio opcional sin interrumpir la música.

No hay una fecha de publicación comprometida. Las incidencias deben definir criterios de aceptación antes de implementar.

## Prioridades de mantenimiento

- Mantener coherencia entre requisitos, archivos de bloqueo, instalador y contenedores.
- Probar reconexión y permisos de voz con servidores TeamSpeak reales además de pruebas simuladas.
- Validar cambios de proveedores mediante solicitudes limitadas y errores visibles.
- Mantener documentación equivalente en inglés y español y notas revisadas por versión.

## Restricciones

Spotify proporciona solo metadatos. No se elude DRM. El panel permanece autenticado y local. La personalización debe respetar propiedad de cola, control del usuario y comportamiento predecible al detener.
