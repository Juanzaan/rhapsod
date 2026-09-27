#!/usr/bin/env bash
# Entrypoint of the Rhapsod image, for the bot and the yt-dlp daemon alike.
#
# The first start has no env file: the bot's container writes one that boots
# the panel-only setup mode (or connects right away when RHAPSOD_TS3_HOST is
# set), with a generated panel password printed once to the log. Then the
# file's RHAPSOD_* values are exported, so the daemon sees the cookie path
# the panel saved; values set on the container win, as they do with dotenv.
set -Eeuo pipefail

ENV_FILE="${RHAPSOD_ENV_FILE:-/app/data/.env}"
DATA_DIR="$(dirname "$ENV_FILE")"

# The daemon mounts data/ read-only and starts first; only the bot writes.
if [[ ! -e "$ENV_FILE" && -w "$DATA_DIR" ]]; then
  password="$(od -An -tx1 -N12 /dev/urandom | tr -d ' \n')"
  cookies="$DATA_DIR/youtube-cookies.txt"
  (umask 077 && : >>"$cookies")
  if [[ -n "${RHAPSOD_TS3_HOST:-}" ]]; then
    ts3=$'RHAPSOD_TS3_AUTO_CONNECT=true'
  else
    # Placeholder until the setup wizard saves a real host.
    ts3=$'RHAPSOD_TS3_HOST=setup.invalid\nRHAPSOD_TS3_AUTO_CONNECT=false'
  fi
  (
    umask 077
    cat >"$ENV_FILE" <<ENV
$ts3
RHAPSOD_DATA_DIR=$DATA_DIR
RHAPSOD_YTDLP_PATH=yt-dlp
RHAPSOD_YTDLP_COOKIES_PATH=$cookies
RHAPSOD_FFMPEG_PATH=/usr/bin/ffmpeg
RHAPSOD_FFPROBE_PATH=/usr/bin/ffprobe
RHAPSOD_PANEL_ENABLED=true
RHAPSOD_PANEL_PORT=8080
RHAPSOD_PANEL_USER=admin
RHAPSOD_PANEL_PASSWORD=$password
ENV
  )
  printf '%s\n' \
    "Rhapsod: wrote $ENV_FILE for the first start." \
    "Rhapsod: panel login admin / $password (shown once; change it with: node dist/cli.js password)"
fi

if [[ -r "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Only the app's own keys: exported here, a NODE_OPTIONS or PATH line
    # would apply before the process starts; dotenv loads it too late to.
    [[ "$line" =~ ^[[:space:]]*(RHAPSOD_[A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    [[ -z "${!key+set}" ]] || continue
    # dotenv trims the value and drops one pair of surrounding quotes.
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
    export "$key=$value"
  done <"$ENV_FILE"
fi
export RHAPSOD_ENV_FILE="$ENV_FILE"

exec "$@"
