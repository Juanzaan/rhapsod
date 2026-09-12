# Rhapsod

[English](README.md)

Bot musical autohospedado para TeamSpeak 3 con cola compartida, reproducción automática adaptable, radio y panel local de administración. El soporte de TeamSpeak 6 está previsto.

[![CI](https://github.com/Juanzaan/rhapsod/actions/workflows/ci.yml/badge.svg)](https://github.com/Juanzaan/rhapsod/actions/workflows/ci.yml) [![Versión](https://img.shields.io/github/v/release/Juanzaan/rhapsod)](https://github.com/Juanzaan/rhapsod/releases) [![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933)](https://nodejs.org)

## Reproducción

- Videos, listas y búsquedas musicales de YouTube; pistas y listas de SoundCloud.
- Metadatos de Spotify vinculados a audio de YouTube. Enlaces de Apple Music y Amazon Music resueltos a alternativas disponibles mediante SongLink.
- Archivos y emisoras públicas HTTPS, con búsqueda de estaciones y títulos en directo.
- Listas guardadas, favoritos por usuario, fuente preferida y estadísticas de escucha.
- Audio Opus estéreo, normalización de volumen, transiciones preparadas y efectos FFmpeg.

Spotify nunca proporciona la reproducción. Los archivos locales no están admitidos. El contenido bloqueado o protegido por DRM se informa sin eludir restricciones.

## Requisitos

- **Node.js >=22.19.0** y npm. CI comprueba la versión mínima, Node 22 actual y Node 24.
- `yt-dlp`, FFmpeg y `ffprobe`; las rutas se pueden configurar en `.env`.
- Un servidor TeamSpeak 3 accesible por UDP y permisos para entrar, hablar y usar el chat del canal.

La línea activa es **3.x**. Los perfiles 1.x y 2.x son históricos; consultar [GitHub Releases](https://github.com/Juanzaan/rhapsod/releases) para elegir una versión publicada. `main` puede contener cambios pendientes de publicación.

## Instalación

Para un VPS Linux compatible, seguir la [guía de instalación](docs/install.es.md). El instalador crea servicios systemd e inicia el asistente local.

Para una instalación manual:

```bash
git clone https://github.com/Juanzaan/rhapsod.git
cd rhapsod
npm ci
cp .env.example .env
```

Configurar `RHAPSOD_TS3_HOST` en `.env`, compilar e iniciar:

```bash
npm run build
npm start
```

Para configurar primero desde el navegador, establecer `RHAPSOD_TS3_AUTO_CONNECT=false`, `RHAPSOD_PANEL_ENABLED=true` y una contraseña única en `RHAPSOD_PANEL_PASSWORD`. Mantener `RHAPSOD_PANEL_HOST=127.0.0.1`. Para un servidor remoto:

```bash
ssh -N -L 8080:127.0.0.1:8080 user@host
```

Abrir `http://127.0.0.1:8080/setup`. La referencia completa está en [`.env.example`](.env.example); la validación y los valores predeterminados están en [`src/config.ts`](src/config.ts).

## Uso

```text
!play artista canción
!queue
!skip
!fav
!autoplay on
!radio jazz
!help
```

Las respuestas del chat están en español. La mayoría de los comandos son compartidos; saltar o eliminar pistas ajenas requiere un administrador incluido en `RHAPSOD_ADMIN_UIDS`. Las pistas automáticas son compartidas. Consultar [comandos](docs/commands.es.md) para alias, permisos y límites.

## Operación y actualización

Conservar `RHAPSOD_DATA_DIR`: contiene identidad TeamSpeak, cola, listas, preferencias e historial. Respaldarlo junto con el archivo de entorno antes de actualizar. Consultar `/api/state` y esperar a `playerState: "idle"` antes de reiniciar.

Consultar [despliegue](docs/deployment.es.md) para systemd, Docker, copias de seguridad, actualizaciones por etiqueta y reversión. Los cambios de comportamiento se indican en el [archivo de versiones](docs/releases.es.md) y el [registro de cambios](CHANGELOG.md).

## Desarrollo

```bash
npm ci
npm run check
npm run test:coverage
```

`npm run check` ejecuta formato, análisis estático, validación de scripts y documentación, tipos, pruebas y compilación. `npm run dev` inicia el modo de desarrollo con configuración local.

## Documentación

- [Instalación](docs/install.es.md) y [despliegue](docs/deployment.es.md)
- [Comandos](docs/commands.es.md) y [arquitectura](docs/architecture.es.md)
- [Panel y fondos animados](docs/dashboard.es.md)
- [Versiones y publicación](docs/releases.es.md)
- [Plan de trabajo](docs/roadmap.es.md) e [investigación](docs/research-ts3-bots.es.md)
- [Enrutamiento opcional de voz](docs/warp-voice-egress.es.md)
- [Colaboración](CONTRIBUTING.md) y [política de seguridad](SECURITY.md)

Informar problemas mediante la [plantilla](https://github.com/Juanzaan/rhapsod/issues/new?template=bug_report.yml), con la versión de `package.json`, registros sin secretos y pasos de reproducción.

## Licencia

[MIT](LICENSE). TeamSpeak es una marca de TeamSpeak Systems GmbH. Rhapsod no está afiliado ni respaldado por TeamSpeak.
