#!/usr/bin/env bash
# Rhapsod host command, installed by install.sh as /usr/local/bin/rhapsod.
#
#   rhapsod status [--json]   services, player state, TeamSpeak, panel tunnel
#   rhapsod doctor            checks the install and says what to fix
#   rhapsod password          new random panel password (asks to restart)
#   rhapsod restart [--force] restarts the bot once nothing is playing
#   rhapsod logs [N]          follows the bot's log, starting N lines back
#   rhapsod version           installed version
#   rhapsod backup [--force]  archives data/ and .env (stops the bot briefly)
#   rhapsod update [--ref REF] [--force]
#                             backs up, installs the latest release (or REF)
#                             and rolls back if the new version is unhealthy
#   rhapsod rollback [--force]
#                             reinstalls the version the last update replaced
#   rhapsod uninstall [--purge] [--yes]
#                             removes the services and this command; --purge
#                             also removes the user, its home and the data
#
# status, doctor, password and version run dist/cli.js, which Docker and
# other hosts share; this wrapper adds what is specific to systemd.
set -Eeuo pipefail

CONF="${RHAPSOD_INSTALL_CONF:-/etc/rhapsod/install.conf}"
# Overridable for tests; production uses the real commands.
SYSTEMCTL="${RHAPSOD_SYSTEMCTL:-systemctl}"
JOURNALCTL="${RHAPSOD_JOURNALCTL:-journalctl}"
AS_USER="${RHAPSOD_AS_USER:-sudo -u}"
USERDEL="${RHAPSOD_USERDEL:-userdel}"
# Prefix for the system paths uninstall removes; tests point it at a sandbox.
ROOT="${RHAPSOD_ROOT:-}"
UNITS=(rhapsod rhapsod-ytdlp-daemon bgutil-pot-provider)

fail() { printf 'rhapsod: %s\n' "$1" >&2; exit 1; }

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; }

[[ -r "$CONF" ]] || fail "cannot read $CONF; was Rhapsod installed with install.sh? (try sudo)"
# Written by install.sh: plain KEY=value lines, read without sourcing.
conf_value() { sed -n "s/^$1=//p" "$CONF" | tail -1; }
APP_DIR="$(conf_value APP_DIR)"
APP_USER="$(conf_value APP_USER)"
NODE_BIN="$(conf_value NODE_BIN)"
[[ -n "$APP_DIR" && -n "$APP_USER" && -n "$NODE_BIN" ]] || fail "$CONF is missing APP_DIR, APP_USER or NODE_BIN"
# Same place deploy.sh keeps its backups, so both share one rotation.
BACKUP_DIR="${RHAPSOD_BACKUP_DIR:-$(dirname "$APP_DIR")/backups}"
DEPLOY="${RHAPSOD_DEPLOY:-$APP_DIR/scripts/deploy.sh}"
KEEP=5

# The env file is 0600 and owned by the service user, so reading it needs
# that user; anyone else goes through sudo once, here. Commands that touch
# systemd or /etc need root even for the service user.
case "${1:-}" in
  backup|update|rollback|uninstall) needs_root=1 ;;
  *) needs_root=0 ;;
esac
if [[ "${RHAPSOD_NO_SUDO:-0}" != "1" && "$(id -u)" != "0" ]] \
  && [[ "$needs_root" == "1" || "$(id -un)" != "$APP_USER" ]]; then
  exec sudo "$0" "$@"
fi

cli() {
  if [[ -z "${RHAPSOD_AS_USER:-}" && "$(id -un)" == "$APP_USER" ]]; then
    (cd "$APP_DIR" && "$NODE_BIN" dist/cli.js "$@")
  else
    # shellcheck disable=SC2086 # AS_USER is a command prefix on purpose.
    (cd "$APP_DIR" && $AS_USER "$APP_USER" "$NODE_BIN" dist/cli.js "$@")
  fi
}

player_state() {
  cli status --json 2>/dev/null \
    | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).playerState??""))}catch{}})' \
    || true
}

as_app() {
  # shellcheck disable=SC2086 # AS_USER is a command prefix on purpose.
  $AS_USER "$APP_USER" "$@"
}

# Fails closed: a panel that does not answer (disabled, down, or a password
# changed in .env but not yet loaded) could be in the middle of a song.
require_idle() {
  local state
  "$SYSTEMCTL" is-active --quiet rhapsod || return 0
  state="$(player_state)"
  case "$state" in
    idle) ;;
    "") fail "could not read the player from the panel; check nothing is playing, then pass --force" ;;
    *) fail "the player is $state; retry when it is idle, or pass --force" ;;
  esac
}

# Same layout as deploy.sh: data/ and .env relative to APP_DIR, so a restore
# is "tar -xzf FILE -C APP_DIR". data/logs is left out, the journal has it.
write_backup() {
  local dir="$1" file revision args
  revision="$(as_app git -C "$APP_DIR" rev-parse --short=7 HEAD 2>/dev/null || echo unknown)"
  # Explicit returns: callers use `|| ...`, which turns off errexit here.
  mkdir -p "$dir" && chmod 0700 "$dir" || return 1
  file="$dir/rhapsod-$(date +%Y%m%d-%H%M%S)-$revision.tar.gz"
  args=(-czf "$file" --exclude=data/logs)
  if tar --version 2>/dev/null | grep -q GNU; then args=(--force-local "${args[@]}"); fi
  if [[ -d "$APP_DIR/data" ]]; then args+=(-C "$APP_DIR" data); fi
  if [[ -f "$APP_DIR/.env" ]]; then args+=(-C "$APP_DIR" .env); fi
  tar "${args[@]}" && chmod 0600 "$file" || return 1
  printf '%s\n' "$file"
}

prune_backups() {
  { ls -1t "$BACKUP_DIR"/rhapsod-*.tar.gz 2>/dev/null || true; } | tail -n +"$((KEEP + 1))" | xargs -r rm -f
}

latest_release() {
  as_app git -C "$APP_DIR" ls-remote --tags --sort=-v:refname origin 2>/dev/null \
    | grep -oE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 | sed 's|refs/tags/||'
}

installed_version() {
  "$NODE_BIN" -p 'require(process.argv[1]).version' "$APP_DIR/package.json" 2>/dev/null || true
}

# deploy.sh waits for idle, backs up, builds as the service user, restarts
# and rolls back when the new version does not come up healthy. It runs
# from a copy because the checkout it runs from changes under it.
run_deploy() {
  local copy code=0
  copy="$(mktemp)"
  cp "$DEPLOY" "$copy"
  PATH="$(dirname "$NODE_BIN"):$PATH" bash "$copy" --app-dir "$APP_DIR" --user "$APP_USER" \
    --backup-dir "$BACKUP_DIR" --keep "$KEEP" "$@" || code=$?
  rm -f "$copy"
  return "$code"
}

command="${1:-help}"
[[ $# -eq 0 ]] || shift
case "$command" in
  status)
    for unit in "${UNITS[@]}"; do
      printf '%-22s %s\n' "$unit" "$("$SYSTEMCTL" is-active "$unit" 2>/dev/null || true)"
    done
    echo
    cli status "$@"
    ;;
  doctor)
    code=0
    for unit in "${UNITS[@]}"; do
      if "$SYSTEMCTL" is-active --quiet "$unit"; then
        echo "ok    service $unit: active"
      else
        echo "FAIL  service $unit: not running; see  rhapsod logs"
        code=1
      fi
    done
    cli doctor || code=1
    exit "$code"
    ;;
  password)
    cli password
    # The running bot still has the old password, so the idle check cannot
    # log in until the restart.
    echo "Apply it, once nothing is playing, with:  rhapsod restart --force"
    ;;
  version)
    cli version
    ;;
  restart)
    [[ "${1:-}" == "--force" ]] || require_idle
    "$SYSTEMCTL" restart rhapsod
    echo "Restarted. Check it with:  rhapsod status"
    ;;
  logs)
    lines="${1:-100}"
    [[ "$lines" =~ ^[0-9]+$ ]] || fail "logs takes a number of lines"
    exec "$JOURNALCTL" -u rhapsod -u rhapsod-ytdlp-daemon -n "$lines" -f
    ;;
  backup)
    [[ "${1:-}" == "--force" ]] || require_idle
    # Stopped, the bot has flushed queue, history and preferences, and
    # nothing writes to data/ while tar reads it.
    "$SYSTEMCTL" stop rhapsod
    code=0
    file="$(write_backup "$BACKUP_DIR")" || code=$?
    "$SYSTEMCTL" start rhapsod
    [[ "$code" == "0" ]] || fail "backup failed; the bot was started again"
    prune_backups
    echo "Backup: $file"
    echo "Restore: stop the bot, then  tar -xzf $file -C $APP_DIR"
    ;;
  update)
    ref=""
    force=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --ref) [[ $# -ge 2 ]] || fail "--ref needs a value"; ref="$2"; shift 2 ;;
        --force) force=(--force); shift ;;
        *) fail "unknown option for update: $1" ;;
      esac
    done
    if [[ -z "$ref" ]]; then
      ref="$(latest_release)"
      [[ -n "$ref" ]] || fail "could not find a release tag at the origin; pass --ref"
      current="$(installed_version)"
      if [[ -n "$current" && "$(printf '%s\n' "v$current" "$ref" | sort -V | tail -1)" == "v$current" ]]; then
        echo "Up to date: v$current is the latest release ($ref)."
        exit 0
      fi
    fi
    previous="$(as_app git -C "$APP_DIR" rev-parse HEAD)"
    run_deploy --ref "$ref" "${force[@]}" || fail "update to $ref failed; see the lines above"
    if [[ "$(as_app git -C "$APP_DIR" rev-parse HEAD)" != "$previous" ]]; then
      mkdir -p "$BACKUP_DIR"
      printf '%s\n' "$previous" > "$BACKUP_DIR/previous-version"
      # Last: this replaces the script bash is running (a new file, so the
      # running copy is untouched).
      install -m 0755 "$APP_DIR/scripts/rhapsod.sh" "$ROOT/usr/local/bin/rhapsod"
      echo "Updated to $ref. Undo it with:  rhapsod rollback"
    fi
    ;;
  rollback)
    force=()
    [[ "${1:-}" == "--force" ]] && force=(--force)
    [[ -s "$BACKUP_DIR/previous-version" ]] \
      || fail "no previous version recorded; rollback undoes the last  rhapsod update"
    target="$(head -1 "$BACKUP_DIR/previous-version")"
    current="$(as_app git -C "$APP_DIR" rev-parse HEAD)"
    run_deploy --ref "$target" "${force[@]}" || fail "rollback to ${target:0:7} failed; see the lines above"
    # A second rollback goes forward again.
    printf '%s\n' "$current" > "$BACKUP_DIR/previous-version"
    echo "Rolled back to ${target:0:7}. Data is kept; the backup taken before it is in $BACKUP_DIR"
    ;;
  uninstall)
    purge=0
    yes=0
    for arg in "$@"; do
      case "$arg" in
        --purge) purge=1 ;;
        --yes) yes=1 ;;
        *) fail "unknown option for uninstall: $arg" ;;
      esac
    done
    if [[ "$yes" != "1" ]]; then
      [[ -t 0 ]] || fail "pass --yes to uninstall without a prompt"
      if [[ "$purge" == "1" ]]; then
        what="the services, the $APP_USER user and everything in its home"
      else
        what="the services and the rhapsod command (data stays in $APP_DIR)"
      fi
      read -r -p "Remove $what? [y/N] " answer
      [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" ]] || fail "cancelled"
    fi
    for unit in "${UNITS[@]}"; do
      "$SYSTEMCTL" disable --now "$unit" 2>/dev/null || true
    done
    # --purge deletes the home the usual backups live in; this one goes
    # where root keeps backups instead.
    final_dir="$BACKUP_DIR"
    [[ "$purge" == "1" ]] && final_dir="$ROOT/var/backups/rhapsod"
    final="$(write_backup "$final_dir")" || fail "final backup failed; nothing was removed but the services are stopped"
    for unit in "${UNITS[@]}"; do
      rm -f "$ROOT/etc/systemd/system/$unit.service"
    done
    "$SYSTEMCTL" daemon-reload || true
    rm -f "$ROOT/etc/cron.weekly/rhapsod-ytdlp-update"
    rm -rf "$ROOT/etc/rhapsod"
    if [[ "$purge" == "1" ]]; then
      # The app dir may live outside the home; remove it only when it is
      # a Rhapsod checkout.
      if grep -q '"name": "rhapsod"' "$APP_DIR/package.json" 2>/dev/null; then
        rm -rf "$APP_DIR"
      fi
      "$USERDEL" --remove "$APP_USER" 2>/dev/null || "$USERDEL" "$APP_USER" || true
    fi
    rm -f "$ROOT/usr/local/bin/rhapsod"
    echo "Rhapsod was removed. Last backup: $final"
    if [[ "$purge" != "1" ]]; then
      echo "Kept: the $APP_USER user and its home ($APP_DIR, backups). Remove them with  sudo userdel --remove $APP_USER"
    fi
    echo "Kept, shared with other software: Node.js in /usr/local, /usr/local/bin/ffmpeg, ffprobe and yt-dlp, and Cloudflare WARP if it was installed."
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
