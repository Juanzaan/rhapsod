# Optional voice routing through WARP

[Español](warp-voice-egress.es.md)

A TeamSpeak server normally sees the bot host's public IP. A WireGuard WARP route scoped to the TeamSpeak destination changes the source address visible to that server. This is separate from `RHAPSOD_WARP_PROXY`, the optional HTTP extraction fallback.

## Configure

Use an existing authorized WireGuard profile or generate one with [wgcf](https://github.com/ViRb3/wgcf). Install `wireguard-tools` through the host package manager. Before changing routes, wait for idle playback as described in [deployment](deployment.md).

Find the actual TeamSpeak destination, including any SRV target, from the live UDP connection with `sudo ss -unp`. Copy the profile to `/etc/wireguard/rhapsod-ts.conf` with mode `0600`. Set `AllowedIPs` to only that server's address, such as `203.0.113.10/32`; retain system DNS and use `PersistentKeepalive = 25` in the peer section.

```bash
sudo wg-quick up rhapsod-ts
sudo wg show rhapsod-ts
ip route get <VOICE_IP>
ip route get 1.1.1.1
```

The voice destination should use `rhapsod-ts`; unrelated traffic should retain the normal interface. Confirm a recent WireGuard handshake and successful TeamSpeak reconnection before enabling boot startup:

```bash
sudo systemctl enable wg-quick@rhapsod-ts
```

If ordering is needed, add `After=wg-quick@rhapsod-ts.service` to the bot's systemd unit. Without a required dependency or firewall rule, tunnel failure may return traffic to the direct route; this configuration does not guarantee fail-closed routing.

## Verify and roll back

Check the visible source IP on the TeamSpeak server, connection state in the panel and audio metrics in `!stats`. Recheck the route when the server's destination changes. Some servers reject VPN ranges.

To remove the route:

```bash
sudo systemctl disable --now wg-quick@rhapsod-ts
```

Confirm the direct route and reconnect during an idle window.
