# Aplicación de escritorio (Windows)

[English](desktop.md)

`tools/desktop` contiene Rhapsod Dashboard, una aplicación pequeña para la bandeja de Windows. Mantiene abierto el túnel SSH hacia el servidor del bot, lo reconecta si se corta, muestra qué está reproduciendo el bot y abre el panel en una ventana propia. El servidor, la ruta de la clave y los puertos se guardan en `%APPDATA%\Rhapsod\dashboard.conf`; la contraseña del panel se guarda en el Administrador de credenciales de Windows, cifrada para el usuario actual. El ejecutable no incluye ningún dato.

## Compilar

La aplicación usa .NET Framework 4, incluido en todas las versiones de Windows admitidas, por lo que no hace falta un SDK:

```powershell
powershell -ExecutionPolicy Bypass -File tools\desktop\build.ps1
```

El ejecutable queda en `tools\desktop\bin\RhapsodDashboard.exe`. La integración continua compila el mismo archivo en cada solicitud de cambios, ejecuta su autoprueba y lo conserva como el artefacto `rhapsod-dashboard`.

## Primer uso

Ejecutar `RhapsodDashboard.exe`. Una ventana de configuración solicita:

- el destino SSH, por ejemplo `rhapsod@203.0.113.10`;
- la clave privada que acepta el servidor del bot, por ejemplo `%USERPROFILE%\.ssh\id_ed25519`;
- el usuario y la contraseña del panel;
- el puerto local y el puerto del panel en el servidor (8080 por defecto).

Después de guardar, la aplicación queda en el área de notificación y abre el panel cuando el túnel está listo. Los usos siguientes arrancan directamente.

## Icono de la bandeja

El color del icono indica el estado: verde mientras suena una pista, gris conectado y sin reproducir, ámbar mientras conecta o cuando el bot no está conectado a TeamSpeak, rojo con el túnel caído. Al pasar el cursor se ve la pista actual.

- Doble clic o **Abrir panel** abre el panel en una ventana de aplicación de Edge, Chrome o Brave (el primero instalado), con un perfil separado para que el acceso al panel no se mezcle con el navegador habitual. Sin un navegador Chromium, se abre en el navegador predeterminado.
- Abrir el panel copia la contraseña al portapapeles y la quita a los 30 segundos si sigue ahí. La copia va marcada para que Windows no la guarde en el historial del portapapeles (Win+V) ni la sincronice en la nube. **Copiar contraseña** la vuelve a copiar.
- **Reconectar** reinicia el túnel; **Configuración…** edita los datos y reconecta; **Salir** cierra el túnel y la aplicación.

Si el túnel se corta, la aplicación avisa y reintenta a los 5, 10, 20 y 40 segundos, y después cada 60. ssh se ejecuta en un trabajo de Windows que termina con la aplicación, así que salir siempre cierra el túnel. Abrir la aplicación de nuevo mientras está en marcha muestra el panel en lugar de una segunda copia.

Si el puerto local ya está abierto, la aplicación lo reutiliza solo cuando responde como el panel (una solicitud de autenticación Basic). Otro programa en ese puerto deja la aplicación sin conexión con un aviso; elegir otro puerto en **Configuración…**.

## Opciones

- `--setup` abre la ventana de configuración antes de arrancar.
- `--forget` borra la contraseña guardada para el servidor configurado.
- `--self-test ARCHIVO` ejecuta las comprobaciones de la integración continua y escribe un informe en `ARCHIVO`.

La aplicación usa el cliente OpenSSH de Windows si está instalado; si no, el `ssh.exe` de Git para Windows o el primero que encuentre en `PATH`. ssh corre sin preguntas, así que la clave no debe tener frase de contraseña o tiene que estar cargada en el agente OpenSSH de Windows (`ssh-add`); el `ssh.exe` de Git para Windows no lee ese agente. Para un puerto SSH distinto de 22, agregar una entrada `Host` con `Port` en `%USERPROFILE%\.ssh\config` y usar ese nombre como destino SSH.

## Reemplazar un lanzador anterior

Los lanzadores anteriores a esta aplicación incluían la contraseña del panel dentro del ejecutable. Borrarlos, definir una nueva `RHAPSOD_PANEL_PASSWORD` en el servidor, reiniciar el bot en reposo y escribir la nueva contraseña en **Configuración…**.
