# Voice egress via Cloudflare WARP (hides the VPS IP from TeamSpeak)

The bot opens outbound connections to the TeamSpeak server, so the server
sees the VPS public IP. To hide it, TeamSpeak-bound traffic goes through a
Cloudflare WARP WireGuard tunnel while everything else (SSH, panel,
YouTube) keeps using the direct route.

This is independent from `RHAPSOD_WARP_PROXY` (warp-cli SOCKS proxy used
only as a fallback for YouTube 403s).

## How it works

- `wgcf` (WARP over WireGuard, no warp-cli needed) with `AllowedIPs`
  scoped to the voice server IP only, e.g. `203.0.113.10/32`.
- Only packets **to that IP** enter the tunnel. A `wg-quick down` (or any
  tunnel failure) just returns traffic to the direct route on the next
  reconnect — graceful degradation, no hard dependency.
- `rhapsod.service` orders `After=wg-quick@rhapsod-ts.service` (no
  `Requires=`), so boot brings the tunnel up first when present.

## Set up on a new machine

```bash
# 1. Tools + account (anonymous free WARP account)
sudo dnf install -y wireguard-tools           # or apt install wireguard
curl -fsSL -o /tmp/wgcf \
  https://github.com/ViRb3/wgcf/releases/download/v2.2.32/wgcf_2.2.32_linux_amd64
chmod +x /tmp/wgcf
mkdir -p ~/wgcf && cd ~/wgcf
/tmp/wgcf register --accept-tos
/tmp/wgcf generate

# 2. Find the REAL voice destination (the TS3 client follows SRV records;
#    plain DNS A may point at a CDN front). With the bot connected:
sudo ss -unp | awk '$4 ~ /:10569$/ {print $4}'   # adjust the voice port
# 3. Scope a copy of the profile to that IP only
sudo mkdir -p /etc/wireguard
sudo cp wgcf-profile.conf /etc/wireguard/rhapsod-ts.conf
sudo chmod 600 /etc/wireguard/rhapsod-ts.conf
sudo sed -i "s|^AllowedIPs.*|AllowedIPs = <VOICE_IP>/32|" /etc/wireguard/rhapsod-ts.conf
sudo sed -i '/^DNS = /d' /etc/wireguard/rhapsod-ts.conf          # keep system DNS
printf '\nPersistentKeepalive = 25\n' | sudo tee -a /etc/wireguard/rhapsod-ts.conf

# 4. Bring up, verify, persist
sudo wg-quick up rhapsod-ts
sudo wg show rhapsod-ts                 # expect a recent handshake
ip route get <VOICE_IP>                 # must show dev rhapsod-ts
ip route get 1.1.1.1                    # must stay on the main interface
sudo systemctl enable wg-quick@rhapsod-ts
```

Expect exactly one brief reconnect of the bot when the route appears
(existing flows switch source IP). Afterwards confirm in the panel that it
is back in its channel, and test a fresh connection (panel
`/api/test-connection` or the wizard step) which now also traverses the
tunnel.

## Caveats

- Some TeamSpeak hosts block known VPN/proxy ranges. If the bot cannot
  connect through the tunnel (probe times out while direct TCP works),
  this setup is not viable there — roll back.
- The SRV target can change. If the bot ever reconnects direct, re-check
  the live flow (`ss -unp`) and update `AllowedIPs`.
- Voice quality depends on the tunnel path; watch `underruns` /
  `rebufferEvents` in `!stats` after enabling.

## Rollback (one command, traffic goes direct on next reconnect)

```bash
sudo systemctl disable --now wg-quick@rhapsod-ts
```
