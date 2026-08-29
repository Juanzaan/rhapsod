#!/bin/bash
# Rhapsod bootstrap for Oracle Linux 9 x86_64.
# Target profile: 1 OCPU / 1 GB low-end VPS (v2.x runtime).
# OCI's 2 OCPU / 3 GB machine can use the same runtime setup.
set -Eeuo pipefail

readonly REPOSITORY="https://github.com/Juanzaan/rhapsod.git"
readonly RELEASE_REF="v2.2.0"
readonly NODE_MAJOR="22"
readonly NODE_VERSION="v22.23.2"
readonly APP_DIR="/home/rhapsod/rhapsod"
readonly DAEMON_DIR="/home/rhapsod/ytdlp-deps"
readonly DNF_ARGS=(--disablerepo=ol9_ksplice)

log() {
  printf '=== RHAPSOD SETUP: %s ===\n' "$1"
}

log "Updating Oracle Linux"
dnf "${DNF_ARGS[@]}" update -y

log "Installing base packages"
dnf "${DNF_ARGS[@]}" install -y \
  curl \
  git \
  gcc-c++ \
  make \
  sudo \
  tar \
  xz \
  python3-pip

log "Installing Node.js $NODE_MAJOR"
if ! command -v node >/dev/null 2>&1; then
  readonly NODE_ARCHIVE="/tmp/node-${NODE_VERSION}-linux-x64.tar.xz"
  curl -fL \
    "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" \
    -o "$NODE_ARCHIVE"
  tar -xJf "$NODE_ARCHIVE" -C /usr/local --strip-components=1
  rm -f "$NODE_ARCHIVE"
fi
node --version
npm --version

log "Installing yt-dlp binary"
curl -fL \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o /tmp/yt-dlp
install -m 0755 /tmp/yt-dlp /usr/local/bin/yt-dlp
rm -f /tmp/yt-dlp
/usr/local/bin/yt-dlp --version

log "Installing yt-dlp python package for the daemon"
python3 -m pip install --target "$DAEMON_DIR" --upgrade "yt-dlp[default]"

log "Installing static FFmpeg"
readonly FFMPEG_ARCHIVE="/tmp/ffmpeg-release-amd64-static.tar.xz"
curl -fL \
  https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  -o "$FFMPEG_ARCHIVE"
tar -xJf "$FFMPEG_ARCHIVE" -C /tmp
readonly FFMPEG_DIR="$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*-amd64-static' -print -quit)"
install -m 0755 "$FFMPEG_DIR/ffmpeg" /usr/local/bin/ffmpeg
install -m 0755 "$FFMPEG_DIR/ffprobe" /usr/local/bin/ffprobe
rm -rf "$FFMPEG_ARCHIVE" "$FFMPEG_DIR"
/usr/local/bin/ffmpeg -version 2>&1 | head -1

log "Creating rhapsod user"
if ! id rhapsod >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash rhapsod
fi
usermod -aG wheel rhapsod

log "Copying the OCI-provided SSH key"
install -d -o rhapsod -g rhapsod -m 0700 /home/rhapsod/.ssh
if [[ -s /home/opc/.ssh/authorized_keys ]]; then
  install -o rhapsod -g rhapsod -m 0600 \
    /home/opc/.ssh/authorized_keys \
    /home/rhapsod/.ssh/authorized_keys
else
  install -o rhapsod -g rhapsod -m 0600 /dev/null \
    /home/rhapsod/.ssh/authorized_keys
fi

log "Cloning the stable release"
if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u rhapsod git clone --depth 1 --branch "$RELEASE_REF" "$REPOSITORY" "$APP_DIR"
fi
sudo -u rhapsod git -C "$APP_DIR" fetch --tags origin
sudo -u rhapsod git -C "$APP_DIR" checkout --detach "$RELEASE_REF"

log "Installing dependencies and building"
sudo -u rhapsod npm --prefix "$APP_DIR" ci
sudo -u rhapsod npm --prefix "$APP_DIR" run build

log "Preparing runtime files"
install -d -o rhapsod -g rhapsod -m 0750 "$APP_DIR/data"
install -o rhapsod -g rhapsod -m 0600 /dev/null "$APP_DIR/.env"
install -o rhapsod -g rhapsod -m 0600 /dev/null /home/rhapsod/youtube-cookies.txt

log "Installing systemd units"
cat > /etc/systemd/system/rhapsod.service <<'UNIT'
[Unit]
Description=Rhapsod TeamSpeak music bot
After=network-online.target rhapsod-ytdlp-daemon.service
Wants=network-online.target
Requires=rhapsod-ytdlp-daemon.service

[Service]
Type=simple
User=rhapsod
WorkingDirectory=/home/rhapsod/rhapsod
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
MemoryMax=512M
MemorySwapMax=1G
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/rhapsod-ytdlp-daemon.service <<'UNIT'
[Unit]
Description=Rhapsod yt-dlp audio resolution daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=rhapsod
ExecStart=/usr/bin/python3 /home/rhapsod/rhapsod/scripts/yt-dlp-daemon.py
Environment=PYTHONPATH=/home/rhapsod/ytdlp-deps
Environment=RHAPSOD_YTDLP_COOKIES_PATH=/home/rhapsod/youtube-cookies.txt
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

cat > /home/rhapsod/deploy-rhapsod.sh <<'DEPLOY'
#!/usr/bin/env bash
# Rebuild Rhapsod from the stable release tag and restart it.
set -euo pipefail
APP_DIR="/home/rhapsod/rhapsod"
cd "$APP_DIR"
git fetch --tags origin
git checkout --detach "v2.2.0"
npm ci
npm run build
/usr/bin/systemctl restart rhapsod-ytdlp-daemon rhapsod
DEPLOY
chmod 0750 /home/rhapsod/deploy-rhapsod.sh
chown rhapsod:rhapsod /home/rhapsod/deploy-rhapsod.sh

cat > /etc/sudoers.d/rhapsod <<'SUDOERS'
rhapsod ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart rhapsod, /usr/bin/systemctl status rhapsod, /usr/bin/systemctl restart rhapsod-ytdlp-daemon
SUDOERS
chmod 0440 /etc/sudoers.d/rhapsod
visudo -cf /etc/sudoers.d/rhapsod

systemctl daemon-reload
systemctl enable rhapsod
systemctl enable rhapsod-ytdlp-daemon

log "Setup complete"
printf '%s\n' \
  'Copy .env, data/ts3-identity.txt, and youtube-cookies.txt from the existing deployment.' \
  'Then run: sudo systemctl start rhapsod-ytdlp-daemon rhapsod'