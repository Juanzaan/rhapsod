#!/usr/bin/env bash
# Rhapsod safe deploy: waits until nothing is playing, backs up, updates,
# rebuilds, restarts and rolls back on its own when the new version fails.
#
#   sudo bash scripts/deploy.sh                 # deploy origin/main
#   sudo bash scripts/deploy.sh --ref v4.0.0    # deploy a tag or commit
#   sudo bash scripts/deploy.sh --dry-run       # show what would happen
#
# Options:
#   --ref REF           branch, tag or commit to deploy (default: main)
#   --app-dir DIR       checkout to update (default: /home/rhapsod/rhapsod)
#   --user USER         service user that owns the checkout (default: rhapsod)
#   --service UNIT      bot unit, e.g. rhapsod@blue (default: rhapsod)
#   --env-file FILE     env file with the panel settings (default: APP_DIR/.env)
#   --backup-dir DIR    where backups go (default: APP_DIR/../backups)
#   --keep N            backups to keep (default: 5)
#   --wait-minutes N    how long to wait for idle (default: 30)
#   --force             restart even if a track is playing
#   --dry-run           print the plan and exit without changing anything
#
# Run as root (or with sudo): it stops and starts systemd units. The checkout,
# npm ci and the build run as the service user.
set -Eeuo pipefail

REF="main"
APP_DIR="/home/rhapsod/rhapsod"
APP_USER="rhapsod"
SERVICE="rhapsod"
DAEMON_SERVICE="rhapsod-ytdlp-daemon"
ENV_FILE=""
BACKUP_DIR=""
KEEP=5
WAIT_MINUTES=30
FORCE=0
DRY_RUN=0
# Overridable for tests; production uses the real commands.
SYSTEMCTL="${RHAPSOD_DEPLOY_SYSTEMCTL:-systemctl}"
AS_USER="${RHAPSOD_DEPLOY_AS_USER:-sudo -u}"
POLL_SECONDS="${RHAPSOD_DEPLOY_POLL_SECONDS:-10}"
# The panel starts only after the TeamSpeak connection, which may take up
# to RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS (180 by default).
HEALTH_SECONDS="${RHAPSOD_DEPLOY_HEALTH_SECONDS:-180}"
STABLE_SECONDS="${RHAPSOD_DEPLOY_STABLE_SECONDS:-15}"

log() { printf '=== DEPLOY: %s ===\n' "$1"; }
warn() { printf '=== DEPLOY WARNING: %s ===\n' "$1" >&2; }
fail() { printf '=== DEPLOY ERROR: %s ===\n' "$1" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --user) APP_USER="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --wait-minutes) WAIT_MINUTES="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$APP_DIR")/backups}"
[[ -d "$APP_DIR/.git" ]] || fail "$APP_DIR is not a git checkout"
[[ "$KEEP" =~ ^[0-9]+$ && "$KEEP" -ge 1 ]] || fail "--keep must be a positive number"
[[ "$WAIT_MINUTES" =~ ^[0-9]+$ ]] || fail "--wait-minutes must be a number"

as_app() {
  # shellcheck disable=SC2086 # AS_USER is a command prefix on purpose.
  $AS_USER "$APP_USER" "$@"
}

# Reads KEY from the env file: last assignment wins, surrounding quotes go.
env_value() {
  local key="$1" value=""
  [[ -r "$ENV_FILE" ]] || return 0
  value="$(grep -E "^[[:space:]]*$key=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

PANEL_ENABLED="$(env_value RHAPSOD_PANEL_ENABLED)"
PANEL_PORT="$(env_value RHAPSOD_PANEL_PORT)"; PANEL_PORT="${PANEL_PORT:-8080}"
PANEL_USER="$(env_value RHAPSOD_PANEL_USER)"; PANEL_USER="${PANEL_USER:-admin}"
PANEL_PASSWORD="$(env_value RHAPSOD_PANEL_PASSWORD)"
PANEL_URL="http://127.0.0.1:$PANEL_PORT"

# The password goes to curl on stdin as a config line, never on the command
# line where other users could read it from the process list.
panel_get() {
  printf 'user = "%s:%s"\n' "$PANEL_USER" "$PANEL_PASSWORD" \
    | curl -fsS --max-time 5 -K - "$PANEL_URL$1"
}

panel_available() {
  [[ "$PANEL_ENABLED" == "true" && -n "$PANEL_PASSWORD" ]]
}

player_state() {
  panel_get /api/state 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).playerState??""))}catch{}})' \
    || true
}

wait_for_idle() {
  if [[ "$FORCE" == "1" ]]; then
    warn "--force: not waiting for idle"
    return 0
  fi
  if ! panel_available; then
    warn "panel disabled or no password in $ENV_FILE: cannot check playback, pass --force to deploy anyway"
    exit 1
  fi
  local deadline=$((SECONDS + WAIT_MINUTES * 60)) state
  while :; do
    state="$(player_state)"
    case "$state" in
      idle) return 0 ;;
      "") warn "the panel did not answer $PANEL_URL/api/state; is the bot running?" ;;
      *) log "player is $state; waiting for idle" ;;
    esac
    if (( SECONDS >= deadline )); then
      fail "still not idle after $WAIT_MINUTES minutes; retry later or pass --force"
    fi
    sleep "$POLL_SECONDS"
  done
}

# Healthy means: the unit stays active without restarts and, when the panel
# is enabled, answers /api/health; then it has to stay that way for
# STABLE_SECONDS. A unit that restarts or stops at any point fails at once.
healthy() {
  local deadline=$((SECONDS + HEALTH_SECONDS)) restarts_before restarts ready_at=-1
  restarts_before="$($SYSTEMCTL show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)"
  while (( SECONDS < deadline )); do
    $SYSTEMCTL is-active --quiet "$SERVICE" || return 1
    restarts="$($SYSTEMCTL show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)"
    [[ "$restarts" == "$restarts_before" ]] || return 1
    if (( ready_at < 0 )); then
      if ! panel_available || panel_get /api/health >/dev/null 2>&1; then
        ready_at=$SECONDS
      fi
    elif (( SECONDS - ready_at >= STABLE_SECONDS )); then
      return 0
    fi
    sleep 2
  done
  return 1
}

build_at() {
  as_app git -C "$APP_DIR" checkout --quiet --detach "$1"
  as_app npm --prefix "$APP_DIR" ci --no-audit --no-fund
  as_app npm --prefix "$APP_DIR" run build
}

# --- Plan ---------------------------------------------------------------------
as_app git -C "$APP_DIR" fetch --quiet --tags origin
if as_app git -C "$APP_DIR" rev-parse --verify --quiet "origin/$REF^{commit}" >/dev/null; then
  TARGET="$(as_app git -C "$APP_DIR" rev-parse "origin/$REF^{commit}")"
else
  TARGET="$(as_app git -C "$APP_DIR" rev-parse --verify "$REF^{commit}")" \
    || fail "unknown ref: $REF"
fi
PREVIOUS="$(as_app git -C "$APP_DIR" rev-parse HEAD)"
log "current $(as_app git -C "$APP_DIR" log -1 --format='%h %s' "$PREVIOUS")"
log "target  $(as_app git -C "$APP_DIR" log -1 --format='%h %s' "$TARGET")"
if [[ "$TARGET" == "$PREVIOUS" ]]; then
  log "already at $REF; nothing to deploy"
  exit 0
fi
DAEMON_CHANGED=0
if ! as_app git -C "$APP_DIR" diff --quiet "$PREVIOUS" "$TARGET" -- scripts/yt-dlp-daemon.py; then
  DAEMON_CHANGED=1
fi
if ! as_app git -C "$APP_DIR" diff --quiet "$PREVIOUS" "$TARGET" -- install.sh deploy/systemd; then
  warn "install.sh or deploy/systemd changed: installed units are not updated by this script; compare them or rerun the installer"
fi
if [[ "$DRY_RUN" == "1" ]]; then
  log "dry run: would wait for idle, back up, build $TARGET, restart $SERVICE$([[ $DAEMON_CHANGED == 1 ]] && echo " and $DAEMON_SERVICE")"
  exit 0
fi

# --- Wait, stop, back up --------------------------------------------------------
wait_for_idle
log "stopping $SERVICE"
$SYSTEMCTL stop "$SERVICE"
# Stopping flushes queue, history and preferences, so the backup taken now
# is consistent and nothing writes to data/ while tar reads it.
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/rhapsod-$STAMP-${PREVIOUS:0:7}.tar.gz"
log "backing up data and env to $BACKUP"
# Entries are stored relative to their directory, so a restore is
# "tar -xzf BACKUP -C APP_DIR" (plus the env file's own directory if it
# lives elsewhere). --force-local keeps GNU tar from reading "host:path".
TAR_ARGS=(-czf "$BACKUP")
tar --version 2>/dev/null | grep -q GNU && TAR_ARGS=(--force-local "${TAR_ARGS[@]}")
[[ -d "$APP_DIR/data" ]] && TAR_ARGS+=(-C "$APP_DIR" data)
[[ -f "$ENV_FILE" ]] && TAR_ARGS+=(-C "$(dirname "$ENV_FILE")" "$(basename "$ENV_FILE")")
if [[ ${#TAR_ARGS[@]} -gt 3 ]]; then
  if ! tar "${TAR_ARGS[@]}"; then
    $SYSTEMCTL start "$SERVICE" || true
    fail "backup failed; the old version was started again"
  fi
  chmod 0600 "$BACKUP"
fi
# Keep the newest KEEP backups.
{ ls -1t "$BACKUP_DIR"/rhapsod-*.tar.gz 2>/dev/null || true; } | tail -n +"$((KEEP + 1))" | xargs -r rm -f

# --- Build and start --------------------------------------------------------------
rollback() {
  warn "$1; rolling back to ${PREVIOUS:0:7}"
  $SYSTEMCTL stop "$SERVICE" || true
  if build_at "$PREVIOUS"; then
    $SYSTEMCTL start "$SERVICE" || true
  fi
  fail "deploy of ${TARGET:0:7} failed and was rolled back; data backup: $BACKUP"
}

log "building ${TARGET:0:7}"
build_at "$TARGET" || rollback "build failed"
if [[ "$DAEMON_CHANGED" == "1" ]]; then
  log "restarting $DAEMON_SERVICE (daemon script changed)"
  $SYSTEMCTL restart "$DAEMON_SERVICE" || warn "$DAEMON_SERVICE did not restart"
fi
log "starting $SERVICE"
$SYSTEMCTL start "$SERVICE" || rollback "$SERVICE did not start"
healthy || rollback "$SERVICE is not healthy"
log "deployed ${TARGET:0:7} ($REF); previous ${PREVIOUS:0:7}; backup $BACKUP"
