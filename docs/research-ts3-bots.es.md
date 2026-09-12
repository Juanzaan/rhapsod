# Investigación de bots musicales TS3

[English](research-ts3-bots.md)

Referencia de ideas de diseño observadas en proyectos TeamSpeak 3. La revisión original corresponde al 2026-08-18; las anotaciones de implementación reflejan Rhapsod actual.

## Proyectos revisados

| Proyecto                                                 | Lenguaje      | Licencia | Observaciones                                                             |
| -------------------------------------------------------- | ------------- | -------- | ------------------------------------------------------------------------- |
| [TS3AudioBot](https://github.com/Splamy/TS3AudioBot)     | C#            | OSL-3.0  | Resolución de recursos, listas, historial, permisos y diagnóstico.        |
| [ts3-musicbot](https://github.com/Bettehem/ts3-musicbot) | Kotlin        | GPL-3.0  | Separación de proveedores, reproductor y cola.                            |
| [TS3-Music-Bot](https://github.com/xDroni/TS3-Music-Bot) | Node.js       | MIT      | Comandos, búsqueda, listas y cabeceras de extracción.                     |
| [TS3MusicBot](https://github.com/HVCsano/TS3MusicBot)    | Kotlin/Docker | GPL-3.0  | Despliegue en contenedor ligado a Arch/AUR y reproductores de escritorio. |

## Aplicación en Rhapsod

- Limitar cola y expansión de listas mediante configuración y límites por usuario.
- Separar pista actual, cola pendiente y proceso de audio mediante controlador y épocas de validez.
- Probar cola antes de ampliar historial, repetición o mezcla.
- Definir permisos: administradores pueden modificar pistas ajenas; `!stop` y `!clear` son compartidos.
- Mantener proveedores detrás de contratos; Spotify aporta metadatos para buscar audio autorizado.
- Resolver URL temporales cerca de reproducir, con caché, caducidad y cancelación.
- Tratar procesos FFmpeg terminados, tuberías rotas y entradas detenidas como errores con recuperación limitada.
- Conservar identidad TeamSpeak y supervisar mediante systemd.

## Trabajo aplazado

Bandcamp requiere políticas y pruebas específicas. Los adaptadores de metadatos Spotify y SoundCloud ya existen. Un sistema general de complementos, integración con reproductores de escritorio o lenguaje extenso de comandos añadiría complejidad antes de validar su necesidad.

## Licencias

Rhapsod utiliza MIT. Reutilizar código compatible requiere conservar avisos de autoría y licencia. Tratar implementaciones GPL-3.0 y OSL-3.0 como referencia salvo revisión expresa de la estrategia de licencia. Preferir implementar comportamientos documentados públicamente a copiar código.
