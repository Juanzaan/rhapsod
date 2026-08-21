#!/bin/bash
# Rhapsod bootstrap for Oracle Linux 9 x86_64.
# Target profile: 1 OCPU / 1 GB low-end VPS running v1.2.1.
# OCI's 2 OCPU / 3 GB machine can use the same runtime setup.
set -Eeuo pipefail

readonly REPOSITORY="https://github.com/Juanzaan/rhapsod.git"
readonly RELEASE_REF="v1.2.1"
readonly APP_DIR="/home/rhapsod/rhapsod"
readonly DNF_ARGS=(--disablerepo=ol9_ksplice)

log() {
  printf '=== RHAPSOD SETUP: %s ===\n' "$1"
}

log "Updating Oracle Linux"

log "Installing base packages"
  epel-release \
  curl \
  git \
  gcc-c++ \
  make \
  sudo \
  tar \
  xz

log "Installing Node.js 22"
node --version
npm --version

log "Installing yt-dlp"
curl -fL \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o /tmp/yt-dlp
install -m 0755 /tmp/yt-dlp /usr/local/bin/yt-dlp
rm -f /tmp/yt-dlp
/usr/local/bin/yt-dlp --version

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
sudo -u rhapsod npm --prefix "$APP_DIR" run build

log "Preparing runtime files"
install -d -o rhapsod -g rhapsod -m 0750 "$APP_DIR/data"
install -o rhapsod -g rhapsod -m 0600 /dev/null "$APP_DIR/.env"
install -o rhapsod -g rhapsod -m 0600 /dev/null /home/rhapsod/youtube-cookies.txt

log "Installing systemd unit"
cat > /etc/systemd/system/rhapsod.service <<'UNIT'
[Unit]
Description=Rhapsod TeamSpeak music bot
After=network-online.target
Wants=network-online.target

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

cat > /home/rhapsod/deploy-rhapsod.sh <<'DEPLOY'
#!/usr/bin/env bash
set -euo pipefail
cd /home/rhapsod/rhapsod
DEPLOY
chmod 0750 /home/rhapsod/deploy-rhapsod.sh
chown rhapsod:rhapsod /home/rhapsod/deploy-rhapsod.sh

cat > /etc/sudoers.d/rhapsod <<'SUDOERS'
rhapsod ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart rhapsod, /usr/bin/systemctl status rhapsod
SUDOERS
chmod 0440 /etc/sudoers.d/rhapsod
visudo -cf /etc/sudoers.d/rhapsod

systemctl daemon-reload
systemctl enable rhapsod

log "Setup complete"
  'Copy .env, data/ts3-identity.txt, and youtube-cookies.txt from the existing deployment.' \
  'Then run: sudo systemctl start rhapsod'
