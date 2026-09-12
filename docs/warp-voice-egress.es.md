# Enrutamiento opcional de voz mediante WARP

[English](warp-voice-egress.md)

Normalmente TeamSpeak ve la IP pública del servidor del bot. Una ruta WireGuard WARP limitada al destino TeamSpeak cambia la dirección visible. Es independiente de `RHAPSOD_WARP_PROXY`, alternativa opcional para extracción HTTP.

## Configuración

Usar un perfil WireGuard autorizado o generarlo mediante [wgcf](https://github.com/ViRb3/wgcf). Instalar `wireguard-tools` con el gestor de paquetes. Antes de cambiar rutas, esperar al reposo según [despliegue](deployment.es.md).

Identificar el destino real de TeamSpeak, incluido SRV, mediante la conexión UDP en `sudo ss -unp`. Copiar el perfil a `/etc/wireguard/rhapsod-ts.conf` con modo `0600`. Limitar `AllowedIPs` a la dirección del servidor, por ejemplo `203.0.113.10/32`; conservar DNS del sistema y usar `PersistentKeepalive = 25` en la sección del par.

```bash
sudo wg-quick up rhapsod-ts
sudo wg show rhapsod-ts
ip route get <VOICE_IP>
ip route get 1.1.1.1
```

El destino de voz debe utilizar `rhapsod-ts`; el resto del tráfico debe conservar la interfaz normal. Confirmar intercambio WireGuard reciente y reconexión TeamSpeak antes de activar el inicio automático:

```bash
sudo systemctl enable wg-quick@rhapsod-ts
```

Si hace falta ordenar el inicio, añadir `After=wg-quick@rhapsod-ts.service` a la unidad del bot. Sin una dependencia obligatoria o regla de firewall, un fallo del túnel puede devolver el tráfico a la ruta directa; esta configuración no garantiza bloqueo del tráfico ante fallos.

## Verificación y reversión

Comprobar la IP visible en TeamSpeak, conexión en el panel y métricas en `!stats`. Revisar la ruta si cambia el destino del servidor. Algunos servidores rechazan direcciones VPN.

Para eliminar la ruta:

```bash
sudo systemctl disable --now wg-quick@rhapsod-ts
```

Confirmar la ruta directa y reconectar durante una ventana de reposo.
