# Panel

[English](dashboard.md)

Abrir el panel autenticado en `http://127.0.0.1:8080/`. Para un servidor remoto, usar el túnel SSH de [despliegue](deployment.es.md). El panel reúne reproducción, cola, sonido, radio, usuarios del servidor, chat y diagnóstico.

## Reproducción y descubrimiento

Buscar por título, artista o enlace compatible. Seleccionar la casilla de próxima pista para insertar antes de la cola pendiente. Si falla una solicitud, el texto se conserva para repetirla. Anterior, pausa, salto, parada y volumen controlan la sesión compartida.

Pulsar la barra de progreso para cambiar de posición. Con el foco en la barra, las flechas avanzan o retroceden cinco segundos; Inicio y Fin seleccionan los extremos. Las transmisiones sin duración conocida no admiten búsqueda de posición. El disco giratorio indica reproducción y es decorativo, no un espectro de audio ni una portada.

La tarjeta de descubrimiento permite buscar radio y activar o desactivar la reproducción automática. Listas y estadísticas utilizan el contexto de comandos del bot; no representan la biblioteca personal de un usuario TeamSpeak. Letras e historial se muestran en la tarjeta de salida.

## Fondo y movimiento

Elegir Aurora, Atardecer u Océano, o desactivar el fondo. Los degradados animados se generan localmente con CSS; no descargan imágenes externas, GIF ni solicitudes de seguimiento.

El botón de movimiento pausa las animaciones. Las preferencias se guardan en este navegador, separadas de la configuración del bot. La reducción de movimiento del sistema tiene prioridad; las pestañas ocultas pausan la animación. Sin almacenamiento del navegador, los controles siguen funcionando durante la visita actual.

## Ajustes, comandos y asistente

Las demás páginas utilizan los mismos colores, tipografía y tarjetas adaptables. Los ajustes se agrupan por servicio, con valores de solo lectura identificados y secretos ocultos conservados. La barra de guardado permanece disponible al desplazarse. Los comandos admiten búsqueda por nombre, alias o descripción, incluido `!` al principio; los argumentos requeridos se muestran completos. El asistente ofrece configuración guiada y acceso a la consola.

## Servidor y canales vacíos

La página del servidor muestra cantidades de canales y usuarios visibles, búsqueda, expansión y contracción y movimiento de canal accesible por teclado. La búsqueda conserva canales superiores como contexto. Los canales cuyo padre no está disponible aparecen en la raíz.

Los clientes de voz no pueden ejecutar `channellist` (el servidor responde `command not found`), por lo que Rhapsod descubre el árbol consultando `channelinfo` por identificador de canal. Esa consulta responde para cada canal visible, incluidos los vacíos; por eso el panel muestra las mismas salas que un cliente normal. Las contraseñas o rangos solo limitan entrar, no ver la lista. El análisis completo se ejecuta en segundo plano al iniciar, al reconectar y cada diez minutos; la sincronización de cada minuto solo actualiza canales con usuarios visibles, y las entradas o movimientos resuelven canales nuevos de inmediato.

Una vista limitada significa que el análisis aún no termina o que todas las consultas fallaron; el árbol muestra solo canales con usuarios visibles. El análisis no requiere permisos especiales. Actualizar la vista vuelve a leer el estado disponible. Los canales eliminados desaparecen en el siguiente análisis completo; los renombrados se actualizan allí también.

## Verificación de páginas

Cambiar el ambiente y recargar para comprobar persistencia. Pausar el movimiento y modificar la preferencia de reducción de movimiento del sistema. Confirmar que la animación permanece detenida. En pantallas estrechas, las tarjetas se apilan y los controles siguen accesibles.

Comparar canal, cola y conexión con TeamSpeak. La prueba de YouTube es manual; un indicador sin probar no significa éxito. Las solicitudes del panel afectan a todos los oyentes.
