#!/usr/bin/env bash
# Rhapsod one-command installer for any mainstream Linux VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh | sudo bash
#
# Supported: Ubuntu 20.04+, Debian 11+, RHEL / Oracle Linux / Rocky / Alma 9+
# on x86_64 or aarch64 (arm64). Installs: Node 22, yt-dlp (binary + daemon package), static
# FFmpeg, the bgutil POT provider, the bot itself, systemd units, a weekly
# yt-dlp updater and the `rhapsod` command (status, doctor, logs). On a new install it asks for the TeamSpeak server, so the
# bot joins it as soon as the install ends, and prints the !claim code that
# makes the owner admin.
#
# Optional environment overrides:
#   RHAPSOD_REF           git ref to install (default: latest stable tag)
#   RHAPSOD_REPOSITORY    git URL or local path to install from (CI installs
#                         the checkout under test this way)
#   RHAPSOD_APP_DIR       install dir (default: /home/rhapsod/rhapsod)
#   RHAPSOD_USER          service user (default: rhapsod)
#   RHAPSOD_TS3_HOST      TeamSpeak server (host or host:port); skips the question
#   RHAPSOD_TS3_PASSWORD  TeamSpeak server password, if it has one
#   RHAPSOD_WITH_WARP     set to 1 to add Cloudflare WARP (proxy mode), the
#                         fallback egress when YouTube blocks the server's IP
#   RHAPSOD_SKIP_WARP     set to 1 to leave WARP out even if already installed
set -Eeuo pipefail

# Turns the TeamSpeak answer ("host", "host:port" or "[ipv6]:port") into .env
# lines. Fails on values that cannot be one .env line or one port.
ts3_env_lines() {
  local answer="$1" password="${2:-}" host port=""
  # dotenv ends an unquoted value at "#" and strips quotes and spaces.
  [[ "$answer$password" != *[[:space:]\#\"\']* ]] || return 1
  if [[ "$answer" =~ ^\[([0-9A-Fa-f:.]+)\](:([0-9]+))?$ ]]; then
    host="${BASH_REMATCH[1]}"
    port="${BASH_REMATCH[3]}"
  elif [[ "$answer" =~ ^([^:]+):([0-9]+)$ ]]; then
    host="${BASH_REMATCH[1]}"
    port="${BASH_REMATCH[2]}"
  elif [[ "$answer" =~ ^[^:]+$ || "$answer" =~ ^[0-9A-Fa-f]*:[0-9A-Fa-f]*:[0-9A-Fa-f:.]*$ ]]; then
    host="$answer"
  else
    return 1
  fi
  [[ -n "$host" ]] || return 1
  if [[ -n "$port" ]] && (( 10#$port < 1 || 10#$port > 65535 )); then
    return 1
  fi
  printf 'RHAPSOD_TS3_HOST=%s\n' "$host"
  [[ -z "$port" ]] || printf 'RHAPSOD_TS3_PORT=%s\n' "$((10#$port))"
  [[ -z "$password" ]] || printf 'RHAPSOD_TS3_PASSWORD=%s\n' "$password"
  printf 'RHAPSOD_TS3_AUTO_CONNECT=true\n'
}

# Asks on the terminal even under `curl | sudo bash`, where stdin is the
# script. Without a terminal and without RHAPSOD_TS3_HOST it prints nothing
# and the bot boots panel-only, as before.
ask_ts3() {
  local answer="${RHAPSOD_TS3_HOST:-}" password="${RHAPSOD_TS3_PASSWORD:-}" lines
  # Overridable so tests never prompt, even when run from a terminal.
  local tty="${RHAPSOD_INSTALL_TTY:-/dev/tty}"
  if [[ -z "$answer" ]] && { : <"$tty"; } 2>/dev/null; then
    while true; do
      read -rp "TeamSpeak server (address or address:port, Enter to set it later in the panel): " answer <"$tty"
      [[ -n "$answer" ]] || return 0
      read -rsp "Server password (Enter if none): " password <"$tty"
      echo >"$tty"
      if lines="$(ts3_env_lines "$answer" "$password")"; then
        printf '%s\n' "$lines"
        return 0
      fi
      echo "Use an address like ts.example.com or ts.example.com:9987. A password with spaces, #, or quotes has to be set later in the panel." >"$tty"
    done
  fi
  [[ -n "$answer" ]] || return 0
  ts3_env_lines "$answer" "$password" \
    || { echo "RHAPSOD_TS3_HOST or RHAPSOD_TS3_PASSWORD cannot be written to .env" >&2; return 1; }
}

# Tests run one of the functions above without running the install:
#   RHAPSOD_INSTALL_FUNCTIONS_ONLY=1 bash install.sh ts3_env_lines host
if [[ "${RHAPSOD_INSTALL_FUNCTIONS_ONLY:-0}" == "1" ]]; then
  [[ $# -eq 0 ]] || { "$@"; exit $?; }
  return 0 2>/dev/null || exit 0
fi

REPOSITORY="${RHAPSOD_REPOSITORY:-https://github.com/Juanzaan/rhapsod.git}"
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
# WARP only helps when YouTube blocks the server's address, which happens on
# cloud VPS ranges and rarely on a home connection, so it is opt-in. A rerun
# keeps an existing WARP setup: dropping it would change the daemon's egress.
if [[ "${RHAPSOD_SKIP_WARP:-0}" == "1" ]]; then
  SKIP_WARP=1
elif [[ "${RHAPSOD_WITH_WARP:-0}" == "1" ]] || command -v warp-cli >/dev/null 2>&1; then
  SKIP_WARP=0
else
  SKIP_WARP=1
fi

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

# Asked before the long downloads so the owner can answer and walk away.
TS3_ENV=""
FRESH_INSTALL=0
if [[ ! -e "$APP_DIR/.env" ]]; then
  FRESH_INSTALL=1
  TS3_ENV="$(ask_ts3)" || fail "invalid RHAPSOD_TS3_HOST"
fi

# cron runs the weekly yt-dlp update below; minimal images leave it out.
install_base_debian() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y curl git python3 python3-pip tar xz-utils ca-certificates \
    gnupg lsb-release openssl cron
}

install_base_rhel() {
  # RHEL 9 images ship curl-minimal, which conflicts with the curl package
  # and already does everything this script needs.
  local packages=(git python3 python3-pip tar xz ca-certificates gnupg2 openssl cronie)
  command -v curl >/dev/null 2>&1 || packages+=(curl)
  dnf install -y "${packages[@]}"
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

# --- Service user ---------------------------------------------------------------
# Before anything is written under /home/$APP_USER: the daemon packages below
# used to create that directory as root first, so on a new server useradd
# left the home root-owned and the POT provider clone failed.
log "Creating $APP_USER user"
if ! id "$APP_USER" >/dev/null 2>&1; then
  # A service account needs no login shell; the installer runs its commands
  # through runuser, which does not use it. Existing users are left as is.
  useradd --create-home --shell "$(command -v nologin || echo /usr/sbin/nologin)" "$APP_USER"
fi
# runuser, not sudo -u: RHEL's sudo secure_path leaves out /usr/local/bin,
# where Node lives, and runuser needs neither the sudo package nor its PAM
# account check.
as_app() { runuser -u "$APP_USER" -- "$@"; }
# A run that failed with that bug left the home owned by root.
if [[ -d "/home/$APP_USER" && "$(stat -c %U "/home/$APP_USER")" == "root" ]]; then
  chown "$APP_USER:" "/home/$APP_USER"
fi

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
# Two sources: johnvansickle.com is a single host that has been unreachable
# for minutes at a time, BtbN's builds on GitHub are the fallback. Both
# layouts are flattened into $WORK_DIR/ffmpeg.
case "$FFMPEG_ARCH" in amd64) BTBN_ARCH="linux64" ;; *) BTBN_ARCH="linuxarm64" ;; esac
ffmpeg_from_johnvansickle() {
  local name="ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz"
  local url="https://johnvansickle.com/ffmpeg/releases/$name"
  curl -fL --connect-timeout 20 --retry 2 "$url" -o "$WORK_DIR/$name" || return 1
  # This mirror only publishes an MD5: it catches corrupt or swapped
  # downloads, not a compromised host.
  curl -fsSL --connect-timeout 20 --retry 2 "$url.md5" -o "$WORK_DIR/ffmpeg.md5" || return 1
  verify_checksum "$WORK_DIR/$name" "$name" "$WORK_DIR/ffmpeg.md5" md5sum
  tar -xJf "$WORK_DIR/$name" -C "$WORK_DIR/ffmpeg" --strip-components=1
}
ffmpeg_from_btbn() {
  local release="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest" name
  curl -fsSL --retry 2 "$release/checksums.sha256" -o "$WORK_DIR/ffmpeg.sha256" || return 1
  # Newest numbered release build (not master), static GPL variant.
  name="$(grep -oE "ffmpeg-n[0-9.]+-latest-$BTBN_ARCH-gpl-[0-9.]+\.tar\.xz" "$WORK_DIR/ffmpeg.sha256" | sort -V | tail -1)"
  [[ -n "$name" ]] || return 1
  curl -fL --retry 2 "$release/$name" -o "$WORK_DIR/$name" || return 1
  verify_checksum "$WORK_DIR/$name" "$name" "$WORK_DIR/ffmpeg.sha256"
  tar -xJf "$WORK_DIR/$name" -C "$WORK_DIR/ffmpeg" --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe'
}
mkdir "$WORK_DIR/ffmpeg"
if ! ffmpeg_from_johnvansickle; then
  warn "johnvansickle.com did not answer; downloading FFmpeg from BtbN's GitHub builds"
  rm -rf "$WORK_DIR/ffmpeg" && mkdir "$WORK_DIR/ffmpeg"
  ffmpeg_from_btbn || fail "could not download FFmpeg from either source"
fi
install -m 0755 "$WORK_DIR/ffmpeg/ffmpeg" /usr/local/bin/ffmpeg
install -m 0755 "$WORK_DIR/ffmpeg/ffprobe" /usr/local/bin/ffprobe
/usr/local/bin/ffmpeg -version 2>&1 | head -1

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
  log "Skipping Cloudflare WARP (add it with RHAPSOD_WITH_WARP=1 if YouTube blocks this server)"
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
  as_app git clone --depth 1 --branch "$POT_VERSION" "$POT_REPOSITORY" "$POT_DIR"
else
  as_app git -C "$POT_DIR" fetch --depth 1 origin tag "$POT_VERSION"
  as_app git -C "$POT_DIR" checkout --detach "$POT_VERSION"
fi
(
  cd "$POT_DIR/server"
  as_app npm ci
  as_app npx tsc
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
  as_app git clone --depth 1 --branch "$REF" "$REPOSITORY" "$APP_DIR"
fi
as_app git -C "$APP_DIR" fetch --tags origin
as_app git -C "$APP_DIR" checkout --detach "$REF"
as_app npm --prefix "$APP_DIR" ci
as_app npm --prefix "$APP_DIR" run build

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
  if [[ -z "$TS3_ENV" ]]; then
    # Placeholder until the wizard saves a real host; the bot boots
    # panel-only (AUTO_CONNECT=false) so /setup is reachable out of the box.
    # Completing the wizard's TeamSpeak step writes the real host and flips
    # AUTO_CONNECT=true.
    TS3_ENV=$'RHAPSOD_TS3_HOST=setup.invalid\nRHAPSOD_TS3_AUTO_CONNECT=false'
  fi
  as_app tee "$APP_DIR/.env" >/dev/null <<ENV
$TS3_ENV
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
  chmod 0600 "$APP_DIR/.env"
fi
WARP_ADDED=0
if [[ "$SKIP_WARP" != "1" ]] && ! grep -q '^RHAPSOD_WARP_PROXY=' "$APP_DIR/.env"; then
  echo "RHAPSOD_WARP_PROXY=$WARP_PROXY" | as_app tee -a "$APP_DIR/.env" >/dev/null
  WARP_ADDED=1
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
# Kernel, device, namespace and syscall isolation. None of it narrows file
# access: the services write data/, .env and the cookie file under /home.
# Blocked syscalls fail with EPERM instead of killing the process.
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
UMask=0077
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
# Kernel, device, namespace and syscall isolation. None of it narrows file
# access: the services write data/, .env and the cookie file under /home.
# Blocked syscalls fail with EPERM instead of killing the process.
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
UMask=0077
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
# Kernel, device, namespace and syscall isolation. None of it narrows file
# access: the services write data/, .env and the cookie file under /home.
# Blocked syscalls fail with EPERM instead of killing the process.
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
UMask=0077
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

# --- rhapsod command -----------------------------------------------------------------
# Plain KEY=value lines: the wrapper reads them without sourcing the file.
install -d -m 0755 /etc/rhapsod
printf 'APP_DIR=%s\nAPP_USER=%s\nNODE_BIN=%s\n' "$APP_DIR" "$APP_USER" "$NODE_BIN" \
  > /etc/rhapsod/install.conf
chmod 0644 /etc/rhapsod/install.conf
install -m 0755 "$APP_DIR/scripts/rhapsod.sh" /usr/local/bin/rhapsod

systemctl daemon-reload
systemctl enable bgutil-pot-provider rhapsod-ytdlp-daemon rhapsod
# rhapsod starts too: with the placeholder host it boots panel-only, which
# is what makes the setup wizard reachable.
systemctl start bgutil-pot-provider rhapsod-ytdlp-daemon rhapsod

log "Setup complete"

# The bot writes the code while no admin is configured; see admin-claim.ts.
CLAIM_FILE="$APP_DIR/data/admin-claim-code"
CONNECTED=0
WAITED=0
# A rerun does not restart a running bot, so only a new install is waited on.
if [[ "$FRESH_INSTALL" == "1" ]] && grep -q '^RHAPSOD_TS3_AUTO_CONNECT=true' "$APP_DIR/.env"; then
  WAITED=1
  log "Waiting for the bot to join TeamSpeak"
  for _ in $(seq 1 45); do
    if journalctl -u rhapsod --since "-2min" --no-pager 2>/dev/null \
      | grep -q "Connected to TeamSpeak 3"; then
      CONNECTED=1
      break
    fi
    sleep 2
  done
fi
# The bot writes it right after starting; a rerun with an admin has none.
if [[ "$FRESH_INSTALL" == "1" ]]; then
  for _ in $(seq 1 15); do
    [[ ! -s "$CLAIM_FILE" ]] || break
    sleep 1
  done
fi
CLAIM_CODE="$(cat "$CLAIM_FILE" 2>/dev/null || true)"

echo
if [[ "$CONNECTED" == "1" ]]; then
  echo "The bot is in your TeamSpeak server."
  if [[ -n "$CLAIM_CODE" ]]; then
    echo "Make yourself its admin: in TeamSpeak, send the bot or its channel"
    echo "  !claim $CLAIM_CODE"
  fi
  echo "Then try:  !play <song or link>"
elif [[ "$WAITED" == "1" ]]; then
  echo "The bot has not joined TeamSpeak yet. Check the address and password:"
  echo "  journalctl -u rhapsod -n 50 --no-pager"
  [[ -z "$CLAIM_CODE" ]] || echo "Once it joins, send  !claim $CLAIM_CODE  to become its admin."
elif [[ -n "$CLAIM_CODE" ]]; then
  echo "Set the TeamSpeak server in the web panel below. Once the bot joins,"
  echo "send  !claim $CLAIM_CODE  in TeamSpeak to become its admin."
fi
if [[ "$WARP_ADDED" == "1" ]]; then
  echo "WARP was added. When nothing is playing, apply it with:"
  echo "  sudo systemctl restart rhapsod-ytdlp-daemon rhapsod"
fi
printf '%s\n' \
  "" \
  "Check on it any time:  rhapsod status   (problems: rhapsod doctor)" \
  "" \
  "Web panel (optional; settings, queue and diagnostics):" \
  "  1. On your own computer, open a tunnel:  ssh -N -L 8080:127.0.0.1:8080 <user>@<this-host>" \
  "  2. Open http://127.0.0.1:8080/ (first time without TeamSpeak set: /setup)." \
  "  Login: admin / $PANEL_PASSWORD" \
  "" \
  "WARP egress: $([[ "$SKIP_WARP" == "1" ]] && echo "off (rerun with RHAPSOD_WITH_WARP=1 if YouTube blocks this server)" || echo "$WARP_PROXY")"
