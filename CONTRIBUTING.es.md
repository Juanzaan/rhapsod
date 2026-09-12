# Colaboración

[English](CONTRIBUTING.md)

1. Abrir una incidencia para cambios de comportamiento o trabajo sustancial.
2. Crear una rama enfocada desde `main`.
3. Añadir o actualizar pruebas junto con la implementación.
4. Ejecutar `npm run check` localmente.
5. Abrir un pull request con la plantilla del repositorio.

Usar Node.js >=22.19.0 e instalar con `npm ci`. Ejecutar `npm run test:coverage`
para cambios de ejecución. Mantener archivos equivalentes en inglés y español
en `docs/` y README, con enlaces de idioma al principio.

Actualizar ambas notas pendientes para cambios visibles. Seguir
[la guía de versiones](docs/releases.es.md) al preparar un PR de publicación.

Usar Conventional Commits, por ejemplo `feat(ts3): connect voice client` o
`fix(queue): reject duplicate track identifiers`.

No incluir `.env`, credenciales, archivos multimedia, compilaciones ni
directorios de dependencias en commits.
