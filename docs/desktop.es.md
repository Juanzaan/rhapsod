# Lanzador de escritorio (Windows)

[English](desktop.md)

`tools/desktop` contiene un lanzador pequeño para Windows que abre el panel. Abre el túnel SSH hacia el servidor del bot, espera el puerto del panel, abre el navegador y copia la contraseña del panel al portapapeles. El servidor, la ruta de la clave y los puertos se guardan en `%APPDATA%\Rhapsod\dashboard.conf`; la contraseña del panel se guarda en el Administrador de credenciales de Windows, cifrada para el usuario actual. El ejecutable no incluye ningún dato.

## Compilar

El lanzador usa .NET Framework 4, incluido en todas las versiones de Windows admitidas, por lo que no hace falta un SDK:

```powershell
powershell -ExecutionPolicy Bypass -File tools\desktop\build.ps1
```

El ejecutable queda en `tools\desktop\bin\RhapsodDashboard.exe`. La integración continua compila el mismo archivo en cada solicitud de cambios y lo conserva como el artefacto `rhapsod-dashboard`.

## Primer uso

Ejecutar `RhapsodDashboard.exe`. Solicita:

- el destino SSH, por ejemplo `rhapsod@203.0.113.10`;
- la clave privada que acepta el servidor del bot, por ejemplo `%USERPROFILE%\.ssh\id_ed25519`;
- el usuario del panel, el puerto local y el puerto del panel en el servidor (8080 por defecto);
- la contraseña del panel, que se escribe oculta y se guarda en el Administrador de credenciales.

Los usos siguientes se conectan directamente. La ventana debe quedar abierta mientras se usa el panel; cerrarla, pulsar `Q` o `Ctrl+C` cierra el túnel, porque ssh se ejecuta en un trabajo de Windows que termina con el lanzador. La contraseña se quita del portapapeles a los 30 segundos si sigue ahí.

Si el puerto local ya está abierto, el lanzador lo reutiliza solo cuando responde como el panel (una solicitud de autenticación Basic). Otro programa en ese puerto detiene el lanzador antes de abrir el navegador o copiar la contraseña; elegir otro puerto con `--setup`.

## Opciones

- `--setup` vuelve a solicitar todos los datos y la contraseña.
- `--forget` borra la contraseña guardada para el servidor configurado.

El lanzador usa el cliente OpenSSH de Windows si está instalado; si no, el `ssh.exe` de Git para Windows o el primero que encuentre en `PATH`.

## Reemplazar un lanzador anterior

Los lanzadores anteriores a este incluían la contraseña del panel dentro del ejecutable. Borrarlos, definir una nueva `RHAPSOD_PANEL_PASSWORD` en el servidor, reiniciar el bot en reposo y ejecutar este lanzador con `--setup`.
