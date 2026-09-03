#!/usr/bin/env bash
# Rhapsod one-command installer for any mainstream Linux VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh | sudo bash
#
# Supported: Ubuntu 20.04+, Debian 11+, RHEL / Oracle Linux / Rocky / Alma 9+
# on x86_64. Installs: Node 22, yt-dlp (binary + daemon package), static
# FFmpeg, Cloudflare WARP (proxy mode, fallback egress for YouTube 403s),
# the bgutil POT provider, the bot itself, systemd units, and a weekly
# yt-dlp updater. Ends by printing the panel password and next steps.
#
# Optional environment overrides:
#   RHAPSOD_REF        git ref to install (default: latest stable tag)
#   RHAPSOD_APP_DIR    install dir (default: /home/rhapsod/rhapsod)
#   RHAPSOD_USER       service user (default: rhapsod)
#   RHAPSOD_SKIP_WARP  set to 1 to skip Cloudflare WARP
set -Eeuo pipefail

REPOSITORY="https://github.com/Juanzaan/rhapsod.git"
POT_REPOSITORY="https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git"
NODE_VERSION="v22.23.2"
REF="${RHAPSOD_REF:-}"
APP_USER="${RHAPSOD_USER:-rhapsod}"
APP_DIR="${RHAPSOD_APP_DIR:-/home/$APP_USER/rhapsod}"
POT_DIR="/home/$APP_USER/bgutil-ytdlp-pot-provider"
DAEMON_DEPS="/home/$APP_USER/ytdlp-deps"
POT_PORT="4416"
WARP_PROXY="socks5h://127.0.0.1:40000"
SKIP_WARP="${RHAPSOD_SKIP_WARP:-0}"

log() { printf '=== RHAPSOD: %s ===\n' "$1"; }
warn() { printf '=== RHAPSOD WARNING: %s ===\n' "$1" >&2; }
fail() { printf '=== RHAPSOD ERROR: %s ===\n' "$1" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || fail "run as root (e.g. sudo bash install.sh)"
[[ "$(uname -m)" == "x86_64" ]] || fail "only x86_64 is supported (static FFmpeg + WARP client)"

# --- Distro detection -------------------------------------------------------
# shellcheck disable=SC1091
source /etc/os-release
DISTRO_FAMILY=""
case "${ID:-}" in
  ubuntu|debian|linuxmint|pop) DISTRO_FAMILY="debian" ;;
  rhel|ol|rocky|almalinux|centos|fedora) DISTRO_FAMILY="rhel" ;;
  *)
    case "${ID_LIKE:-}" in
      *debian*) DISTRO_FAMILY="debian" ;;
      *rhel*|*fedora*) DISTRO_FAMILY="rhel" ;;
      *) fail "unsupported distro: ${ID:-unknown} (need Ubuntu/Debian or RHEL 9+)" ;;
    esac
    ;;
esac
log "Detected distro family: $DISTRO_FAMILY (${ID:-?} ${VERSION_ID:-?})"

install_base_debian() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y curl git python3 python3-pip tar xz-utils ca-certificates \
    gnupg lsb-release openssl
}

install_base_rhel() {
  dnf install -y curl git python3 python3-pip tar xz ca-certificates \
    gnupg2 openssl
  # EPEL is required by the WARP package (tray/captive-portal deps).
  if [[ "$SKIP_WARP" != "1" ]]; then
    dnf install -y oracle-epel-release-el9 2>/dev/null \
      || dnf install -y epel-release 2>/dev/null \
      || warn "could not enable EPEL; WARP install may fail"
    dnf config-manager --enable ol9_developer_EPEL 2>/dev/null || true
  fi
}

if [[ "$DISTRO_FAMILY" == "debian" ]]; then
  log "Installing base packages (apt)"
  install_base_debian
else
  log "Installing base packages (dnf)"
  install_base_rhel
fi

# --- Node.js 22 (distro-agnostic tarball) ------------------------------------
if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js $NODE_VERSION"
  NODE_ARCHIVE="/tmp/node-${NODE_VERSION}-linux-x64.tar.xz"
  curl -fL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" \
    -o "$NODE_ARCHIVE"
  tar -xJf "$NODE_ARCHIVE" -C /usr/local --strip-components=1
  rm -f "$NODE_ARCHIVE"
fi
node --version
npm --version

# --- yt-dlp standalone binary -------------------------------------------------
log "Installing yt-dlp binary"
curl -fL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o /tmp/yt-dlp
install -m 0755 /tmp/yt-dlp /usr/local/bin/yt-dlp
rm -f /tmp/yt-dlp
/usr/local/bin/yt-dlp --version

# --- Python daemon packages ---------------------------------------------------
log "Installing yt-dlp daemon packages"
PIP_INSTALL=(python3 -m pip install --target "$DAEMON_DEPS" --upgrade)
if ! "${PIP_INSTALL[@]}" "yt-dlp[default]" "bgutil-ytdlp-pot-provider" 2>/dev/null; then
  warn "plain pip install failed, retrying with --break-system-packages"
  "${PIP_INSTALL[@]}" --break-system-packages \
    "yt-dlp[default]" "bgutil-ytdlp-pot-provider" \
    || warn "daemon Python packages failed; the bot will use slower spawn mode"
fi

# --- Static FFmpeg ------------------------------------------------------------
log "Installing static FFmpeg"
FFMPEG_ARCHIVE="/tmp/ffmpeg-release-amd64-static.tar.xz"
curl -fL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  -o "$FFMPEG_ARCHIVE"
tar -xJf "$FFMPEG_ARCHIVE" -C /tmp
FFMPEG_DIR="$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*-amd64-static' -print -quit)"
install -m 0755 "$FFMPEG_DIR/ffmpeg" /usr/local/bin/ffmpeg
install -m 0755 "$FFMPEG_DIR/ffprobe" /usr/local/bin/ffprobe
rm -rf "$FFMPEG_ARCHIVE" "$FFMPEG_DIR"
/usr/local/bin/ffmpeg -version 2>&1 | head -1

# --- Service user ---------------------------------------------------------------
log "Creating $APP_USER user"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$APP_USER"
fi

# --- Cloudflare WARP (proxy mode: never touches routing/SSH) -------------------
install_warp_debian() {
  curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
    | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" \
    | tee /etc/apt/sources.list.d/cloudflare-client.list
  apt-get update
  apt-get install -y cloudflare-warp
}

install_warp_rhel() {
  rpm --import https://pkg.cloudflareclient.com/pubkey.gpg
  curl -fsSl https://pkg.cloudflareclient.com/cloudflare-warp-ascii.repo \
    | tee /etc/yum.repos.d/cloudflare-warp.repo
  dnf install -y cloudflare-warp
}

if [[ "$SKIP_WARP" == "1" ]]; then
  warn "skipping WARP (RHAPSOD_SKIP_WARP=1); 403 fallback will be disabled"
else
  log "Installing Cloudflare WARP"
  if [[ "$DISTRO_FAMILY" == "debian" ]]; then
    install_warp_debian
  else
    install_warp_rhel
  fi
  # Order matters: proxy mode BEFORE connect, so routing/SSH stay direct.
  systemctl start warp-svc
  warp-cli --accept-tos mode proxy
  warp-cli --accept-tos registration new
  warp-cli --accept-tos connect
  warp-cli --accept-tos status
  if curl -s -m 20 --proxy socks5h://127.0.0.1:40000 https://ifconfig.me >/dev/null; then
    log "WARP proxy verified on 127.0.0.1:40000"
  else
    warn "WARP proxy check failed; continuing without it"
    SKIP_WARP=1
  fi
  systemctl enable warp-svc
fi

# --- bgutil POT provider ----------------------------------------------------------
log "Installing bgutil POT provider"
if [[ ! -d "$POT_DIR/.git" ]]; then
  sudo -u "$APP_USER" git clone --depth 1 "$POT_REPOSITORY" "$POT_DIR"
fi
(
  cd "$POT_DIR/server"
  sudo -u "$APP_USER" npm ci
  sudo -u "$APP_USER" npx tsc
) || warn "POT provider build failed; YouTube may ask for login without it"

# --- Bot code ---------------------------------------------------------------------
if [[ -z "$REF" ]]; then
  log "Resolving latest stable tag"
  REF="$(git ls-remote --tags --sort=-v:refname "$REPOSITORY" \
    | grep -oE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 | sed 's|refs/tags/||')"
  [[ -n "$REF" ]] || fail "could not resolve latest tag; set RHAPSOD_REF explicitly"
fi
log "Installing Rhapsod $REF"
if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git clone --depth 1 --branch "$REF" "$REPOSITORY" "$APP_DIR"
fi
sudo -u "$APP_USER" git -C "$APP_DIR" fetch --tags origin
sudo -u "$APP_USER" git -C "$APP_DIR" checkout --detach "$REF"
sudo -u "$APP_USER" npm --prefix "$APP_DIR" ci
sudo -u "$APP_USER" npm --prefix "$APP_DIR" run build

# --- Runtime files ------------------------------------------------------------------
log "Preparing runtime files"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR/data"
install -o "$APP_USER" -g "$APP_USER" -m 0600 /dev/null "$APP_DIR/.env"
install -o "$APP_USER" -g "$APP_USER" -m 0600 /dev/null "/home/$APP_USER/youtube-cookies.txt"
PANEL_PASSWORD="$(openssl rand -hex 12)"
sudo -u "$APP_USER" tee "$APP_DIR/.env" >/dev/null <<ENV
RHAPSOD_TS3_HOST=
RHAPSOD_DATA_DIR=./data
RHAPSOD_YTDLP_PATH=/usr/local/bin/yt-dlp
RHAPSOD_YTDLP_COOKIES_PATH=/home/$APP_USER/youtube-cookies.txt
RHAPSOD_YTDLP_DAEMON_URL=http://127.0.0.1:8765
RHAPSOD_YTDLP_EXTRACTOR_ARGS=youtube:po_token_uri=http://127.0.0.1:$POT_PORT/get_pot
RHAPSOD_FFMPEG_PATH=/usr/local/bin/ffmpeg
RHAPSOD_FFPROBE_PATH=/usr/local/bin/ffprobe
RHAPSOD_PANEL_ENABLED=true
RHAPSOD_PANEL_PORT=8080
RHAPSOD_PANEL_USER=admin
RHAPSOD_PANEL_PASSWORD=$PANEL_PASSWORD
ENV
if [[ "$SKIP_WARP" != "1" ]]; then
  echo "RHAPSOD_WARP_PROXY=$WARP_PROXY" | sudo -u "$APP_USER" tee -a "$APP_DIR/.env" >/dev/null
fi
chmod 0600 "$APP_DIR/.env"

# --- systemd units --------------------------------------------------------------------
log "Installing systemd units"
POT_EXEC="ExecStart=/usr/bin/node $POT_DIR/server/build/main.js --port $POT_PORT"
cat > /etc/systemd/system/bgutil-pot-provider.service <<UNIT
[Unit]
Description=Rhapsod YouTube POT provider
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$POT_DIR/server
$POT_EXEC
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT

DAEMON_ENV_WARP=""
if [[ "$SKIP_WARP" != "1" ]]; then
  DAEMON_ENV_WARP="Environment=RHAPSOD_WARP_PROXY=$WARP_PROXY"
fi
cat > /etc/systemd/system/rhapsod-ytdlp-daemon.service <<UNIT
[Unit]
Description=Rhapsod yt-dlp audio resolution daemon
After=network-online.target bgutil-pot-provider.service
Wants=network-online.target
Requires=bgutil-pot-provider.service

[Service]
Type=simple
User=$APP_USER
ExecStart=/usr/bin/python3 $APP_DIR/scripts/yt-dlp-daemon.py
Environment=PYTHONPATH=$DAEMON_DEPS
Environment=RHAPSOD_YTDLP_COOKIES_PATH=/home/$APP_USER/youtube-cookies.txt
$DAEMON_ENV_WARP
Restart=on-failure
RestartSec=5
RuntimeMaxSec=86400
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
MemoryHigh=512M
MemoryMax=768M
MemorySwapMax=0
TasksMax=64

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/rhapsod.service <<UNIT
[Unit]
Description=Rhapsod TeamSpeak music bot
After=network-online.target rhapsod-ytdlp-daemon.service
Wants=network-online.target
Requires=rhapsod-ytdlp-daemon.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
MemoryMax=2G
MemorySwapMax=2G

[Install]
WantedBy=multi-user.target
UNIT

# --- Weekly yt-dlp updater (SinusBot-style rolling updates) ------------------------------
cat > /etc/cron.weekly/rhapsod-ytdlp-update <<CRON
#!/bin/bash
# Refresh yt-dlp (binary + daemon package) so YouTube extractor fixes land weekly.
set -euo pipefail
curl -fL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /tmp/yt-dlp
install -m 0755 /tmp/yt-dlp /usr/local/bin/yt-dlp
rm -f /tmp/yt-dlp
python3 -m pip install --target "$DAEMON_DEPS" --upgrade --quiet "yt-dlp[default]" || true
systemctl restart rhapsod-ytdlp-daemon || true
CRON
chmod 0755 /etc/cron.weekly/rhapsod-ytdlp-update

systemctl daemon-reload
systemctl enable bgutil-pot-provider rhapsod-ytdlp-daemon rhapsod
systemctl start bgutil-pot-provider rhapsod-ytdlp-daemon

log "Setup complete"
printf '%s\n' \
  "" \
  "Next steps (2 minutes):" \
  "  1. Open an SSH tunnel:  ssh -L 8080:127.0.0.1:8080 <user>@<this-host>" \
  "  2. Open http://127.0.0.1:8080/setup and follow the wizard." \
  "" \
  "Panel login:  admin / $PANEL_PASSWORD" \
  "WARP egress:  $([[ "$SKIP_WARP" == "1" ]] && echo disabled || echo "$WARP_PROXY")" \
  "YouTube cookies: paste them in the wizard (YouTube step) or replace" \
  "  /home/$APP_USER/youtube-cookies.txt and restart the daemon + bot."
