# Versiones

[English](releases.md)

[GitHub Releases](https://github.com/Juanzaan/rhapsod/releases) contiene las versiones publicadas. Los títulos utilizan `Rhapsod vX.Y.Z`. Cada cuerpo incluye resumen, cambios, actualización y verificación en inglés, seguidos de la misma información en español. Los enlaces apuntan a la etiqueta exacta y a la versión anterior.

## Archivo

| Versión                                   | Contenido                                                 |
| ----------------------------------------- | --------------------------------------------------------- |
| [Sin publicar](releases/unreleased.es.md) | Cambios pendientes                                        |
| [v3.0.0](releases/v3.0.0.es.md)           | Preferencias, reproducción automática, radio e instancias |
| [v2.4.1](releases/v2.4.1.es.md)           | Automatización de versiones                               |
| [v2.4.0](releases/v2.4.0.es.md)           | Transiciones, volumen y límite de resolución              |
| [v2.3.1](releases/v2.3.1.es.md)           | Fiabilidad del panel                                      |
| [v2.3.0](releases/v2.3.0.es.md)           | Panel e instalador                                        |
| [v2.2.0](releases/v2.2.0.es.md)           | Innertube y servicio persistente                          |
| [v2.1.0](releases/v2.1.0.es.md)           | Listas y efectos                                          |
| [v2.0.0](releases/v2.0.0.es.md)           | Perfil para servidores mayores                            |
| [v1.2.1](releases/v1.2.1.es.md)           | Última versión de bajos recursos                          |
| [v1.2.0](releases/v1.2.0.es.md)           | Reproducción y reconexión                                 |
| [v1.1.0](releases/v1.1.0.es.md)           | Audio y controles de cola                                 |
| [v1.0.0](releases/v1.0.0.es.md)           | Primera versión estable                                   |

Los resúmenes históricos describen su código etiquetado; las secciones de verificación son procedimientos, no afirmaciones de pruebas actuales de versiones antiguas. El detalle original permanece en [CHANGELOG.md](../CHANGELOG.md) y las diferencias enlazadas.

## Preparación de una versión

1. Actualizar `docs/releases/unreleased.md` y `docs/releases/unreleased.es.md` con los cambios, comportamiento visible y acciones operativas.
2. En el PR de release-please, copiar las notas revisadas a `docs/releases/vX.Y.Z.md` y `.es.md`, ajustar enlaces de idioma y añadir etiqueta y referencia anterior a `docs/releases/index.json`.
3. Actualizar el registro de cambios manual. Reiniciar ambos documentos pendientes con texto significativo sobre el siguiente ciclo.
4. Ejecutar `npm run check` y `npm run test:coverage`. Previsualizar con `npm run release:notes -- render vX.Y.Z`.
5. Integrar el PR tras superar CI. release-please gestiona versión, etiqueta y publicación; después el flujo sustituye el cuerpo generado por las notas bilingües revisadas.

El publicador rechaza etiquetas sin notas archivadas. Esto evita asignar notas de otra versión. Si falla la publicación de notas, completar el archivo y repetir la sincronización de la etiqueta existente.

## Corrección de notas publicadas

Editar ambos idiomas, validar y usar GitHub CLI autenticado:

```bash
npm run lint:docs
npm run release:notes -- render v3.0.0
npm run release:notes -- sync v3.0.0
```

La sincronización modifica solo título y cuerpo de una versión existente y los vuelve a leer para verificar. No crea etiquetas ni versiones. Repetirla no produce cambios si el contenido coincide. Mantener hechos históricos en su versión y enlazar explícitamente las correcciones posteriores.
