#!/usr/bin/env bash
# Rhapsod one-command installer for any mainstream Linux VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh | sudo bash
#
# Supported: Ubuntu 20.04+, Debian 11+, RHEL / Oracle Linux / Rocky / Alma 9+
# on x86_64 or aarch64 (arm64). Installs: Node 22, yt-dlp (binary + daemon package), static
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
# Server checkout and pip plugin must match: they share a protocol version.
POT_VERSION="2.0.0"
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

# Downloads go to a private temp dir, never to fixed /tmp paths: as root, a
# predictable name in a world-writable directory can be pre-planted.
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Checks $1 against the entry for file name $2 in checksum list $3
# ("<hash>  <name>" lines); $4 is the tool (sha256sum or md5sum).
verify_checksum() {
  local file="$1" name="$2" sums="$3" tool="${4:-sha256sum}" expected
  expected="$(awk -v n="$name" '$2 == n || $2 == "*" n { print $1; exit }' "$sums")"
  [[ -n "$expected" ]] || fail "no published checksum for $name"
  echo "$expected  $file" | "$tool" -c --quiet - \
    || fail "checksum mismatch for $name; refusing to install it"
}

[[ "$(id -u)" == "0" ]] || fail "run as root (e.g. sudo bash install.sh)"
# Every downloaded artifact exists for both: Node.js tarballs, yt-dlp's
# standalone binary, the static FFmpeg build and the WARP packages.
case "$(uname -m)" in
  x86_64) NODE_ARCH="x64"; YTDLP_ASSET="yt-dlp_linux"; FFMPEG_ARCH="amd64" ;;
  aarch64|arm64) NODE_ARCH="arm64"; YTDLP_ASSET="yt-dlp_linux_aarch64"; FFMPEG_ARCH="arm64" ;;
  *) fail "unsupported architecture $(uname -m) (need x86_64 or aarch64)" ;;
esac

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
  NODE_NAME="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  curl -fL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_NAME}" \
    -o "$WORK_DIR/$NODE_NAME"
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" \
    -o "$WORK_DIR/node-SHASUMS256.txt"
  verify_checksum "$WORK_DIR/$NODE_NAME" "$NODE_NAME" "$WORK_DIR/node-SHASUMS256.txt"
  tar -xJf "$WORK_DIR/$NODE_NAME" -C /usr/local --strip-components=1
fi
node --version
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)' \
  || fail "Node.js >=22.19.0 is required; upgrade Node and rerun the installer"
npm --version
NODE_BIN="$(command -v node)"

# --- yt-dlp standalone binary -------------------------------------------------
log "Installing yt-dlp binary"
YTDLP_RELEASE="https://github.com/yt-dlp/yt-dlp/releases/latest/download"
curl -fL "$YTDLP_RELEASE/$YTDLP_ASSET" -o "$WORK_DIR/$YTDLP_ASSET"
curl -fsSL "$YTDLP_RELEASE/SHA2-256SUMS" -o "$WORK_DIR/yt-dlp-SHA2-256SUMS"
verify_checksum "$WORK_DIR/$YTDLP_ASSET" "$YTDLP_ASSET" "$WORK_DIR/yt-dlp-SHA2-256SUMS"
install -m 0755 "$WORK_DIR/$YTDLP_ASSET" /usr/local/bin/yt-dlp
/usr/local/bin/yt-dlp --version

# --- Python daemon packages ---------------------------------------------------
log "Installing yt-dlp daemon packages"
PIP_INSTALL=(python3 -m pip install --target "$DAEMON_DEPS" --upgrade)
if ! "${PIP_INSTALL[@]}" "yt-dlp[default]" "bgutil-ytdlp-pot-provider==$POT_VERSION" 2>/dev/null; then
  warn "plain pip install failed, retrying with --break-system-packages"
  "${PIP_INSTALL[@]}" --break-system-packages \
    "yt-dlp[default]" "bgutil-ytdlp-pot-provider==$POT_VERSION" \
    || warn "daemon Python packages failed; the bot will use slower spawn mode"
fi

# --- Static FFmpeg ------------------------------------------------------------
log "Installing static FFmpeg"
FFMPEG_NAME="ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz"
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/$FFMPEG_NAME"
curl -fL "$FFMPEG_URL" -o "$WORK_DIR/$FFMPEG_NAME"
# This mirror only publishes an MD5: it catches corrupt or swapped
# downloads, not a compromised host.
curl -fsSL "$FFMPEG_URL.md5" -o "$WORK_DIR/ffmpeg.md5"
verify_checksum "$WORK_DIR/$FFMPEG_NAME" "$FFMPEG_NAME" "$WORK_DIR/ffmpeg.md5" md5sum
mkdir "$WORK_DIR/ffmpeg"
tar -xJf "$WORK_DIR/$FFMPEG_NAME" -C "$WORK_DIR/ffmpeg" --strip-components=1
install -m 0755 "$WORK_DIR/ffmpeg/ffmpeg" /usr/local/bin/ffmpeg
install -m 0755 "$WORK_DIR/ffmpeg/ffprobe" /usr/local/bin/ffprobe
/usr/local/bin/ffmpeg -version 2>&1 | head -1

# --- Service user ---------------------------------------------------------------
log "Creating $APP_USER user"
if ! id "$APP_USER" >/dev/null 2>&1; then
  # A service account needs no login shell; the installer runs its commands
  # through sudo -u, which does not use it. Existing users are left as is.
  useradd --create-home --shell "$(command -v nologin || echo /usr/sbin/nologin)" "$APP_USER"
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
  # Re-runs (repair, update) find the previous registration still registered;
  # without clearing it, `registration new` fails and -e aborts the install.
  warp-cli --accept-tos registration delete >/dev/null 2>&1 || true
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
  sudo -u "$APP_USER" git clone --depth 1 --branch "$POT_VERSION" "$POT_REPOSITORY" "$POT_DIR"
else
  sudo -u "$APP_USER" git -C "$POT_DIR" fetch --depth 1 origin tag "$POT_VERSION"
  sudo -u "$APP_USER" git -C "$POT_DIR" checkout --detach "$POT_VERSION"
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
if [[ ! -e "/home/$APP_USER/youtube-cookies.txt" ]]; then
  install -o "$APP_USER" -g "$APP_USER" -m 0600 /dev/null "/home/$APP_USER/youtube-cookies.txt"
fi
PANEL_PASSWORD="(existing password preserved)"
if [[ ! -e "$APP_DIR/.env" ]]; then
  install -o "$APP_USER" -g "$APP_USER" -m 0600 /dev/null "$APP_DIR/.env"
  PANEL_PASSWORD="$(openssl rand -hex 12)"
  sudo -u "$APP_USER" tee "$APP_DIR/.env" >/dev/null <<ENV
# Placeholder until the wizard saves a real host; the bot boots panel-only
# (AUTO_CONNECT=false) so /setup is reachable out of the box. Completing the
# wizard's TeamSpeak step writes the real host and flips AUTO_CONNECT=true.
RHAPSOD_TS3_HOST=setup.invalid
RHAPSOD_TS3_AUTO_CONNECT=false
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
fi

# --- systemd units --------------------------------------------------------------------
log "Installing systemd units"
POT_EXEC="ExecStart=$NODE_BIN $POT_DIR/server/build/main.js --port $POT_PORT"
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
# read-only, not true: the daemon's script, PYTHONPATH deps and cookies all
# live under /home, and ProtectHome=true makes them invisible to it.
ProtectHome=read-only
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
# Wants, not Requires: with Requires, the weekly yt-dlp update restarting
# the daemon also restarted the bot mid-song. The bot falls back to spawning
# yt-dlp while the daemon is down.
Wants=rhapsod-ytdlp-daemon.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
# No EnvironmentFile here: the app loads .env itself (dotenv) from the
# working directory. On SELinux-enforcing distros (RHEL 9 family) PID 1
# (init_t) is denied reading files labeled user_home_t, so an
# EnvironmentFile under /home fails the whole unit with "Permission denied".
ExecStart=$NODE_BIN dist/main.js
Restart=on-failure
RestartSec=5
RestartPreventExitStatus=42
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
{
  printf '#!/bin/bash\nDAEMON_DEPS=%q\nYTDLP_ASSET=%q\n' "$DAEMON_DEPS" "$YTDLP_ASSET"
  cat <<'CRON'
# Refresh yt-dlp (binary + daemon package) so YouTube extractor fixes land weekly.
set -euo pipefail
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
RELEASE="https://github.com/yt-dlp/yt-dlp/releases/latest/download"
curl -fsSL "$RELEASE/$YTDLP_ASSET" -o "$WORK_DIR/$YTDLP_ASSET"
curl -fsSL "$RELEASE/SHA2-256SUMS" -o "$WORK_DIR/SHA2-256SUMS"
# A mismatch aborts the update and keeps the installed binary.
(cd "$WORK_DIR" && grep " $YTDLP_ASSET\$" SHA2-256SUMS | sha256sum -c --quiet -)
install -m 0755 "$WORK_DIR/$YTDLP_ASSET" /usr/local/bin/yt-dlp
# Debian 12 / Ubuntu 24.04 mark the system Python as externally managed;
# retry like the installer does instead of silently keeping the old version.
PIP=(python3 -m pip install --target "$DAEMON_DEPS" --upgrade --quiet)
if ! "${PIP[@]}" "yt-dlp[default]"; then
  "${PIP[@]}" --break-system-packages "yt-dlp[default]" \
    || echo "rhapsod: yt-dlp daemon package update failed" >&2
fi
systemctl restart rhapsod-ytdlp-daemon || true
CRON
} > /etc/cron.weekly/rhapsod-ytdlp-update
chmod 0755 /etc/cron.weekly/rhapsod-ytdlp-update

systemctl daemon-reload
systemctl enable bgutil-pot-provider rhapsod-ytdlp-daemon rhapsod
# rhapsod starts too: with the placeholder host it boots panel-only, which
# is what makes the setup wizard reachable.
systemctl start bgutil-pot-provider rhapsod-ytdlp-daemon rhapsod

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
