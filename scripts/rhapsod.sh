#!/usr/bin/env bash
# Rhapsod host command, installed by install.sh as /usr/local/bin/rhapsod.
#
#   rhapsod status [--json]   services, player state, TeamSpeak, panel tunnel
#   rhapsod doctor            checks the install and says what to fix
#   rhapsod password          new random panel password (asks to restart)
#   rhapsod restart [--force] restarts the bot once nothing is playing
#   rhapsod logs [N]          follows the bot's log, starting N lines back
#   rhapsod version           installed version
#
# status, doctor, password and version run dist/cli.js, which Docker and
# other hosts share; this wrapper adds what is specific to systemd.
set -Eeuo pipefail

CONF="${RHAPSOD_INSTALL_CONF:-/etc/rhapsod/install.conf}"
# Overridable for tests; production uses the real commands.
SYSTEMCTL="${RHAPSOD_SYSTEMCTL:-systemctl}"
JOURNALCTL="${RHAPSOD_JOURNALCTL:-journalctl}"
AS_USER="${RHAPSOD_AS_USER:-sudo -u}"
UNITS=(rhapsod rhapsod-ytdlp-daemon bgutil-pot-provider)

fail() { printf 'rhapsod: %s\n' "$1" >&2; exit 1; }

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }

[[ -r "$CONF" ]] || fail "cannot read $CONF; was Rhapsod installed with install.sh? (try sudo)"
# Written by install.sh: plain KEY=value lines, read without sourcing.
conf_value() { sed -n "s/^$1=//p" "$CONF" | tail -1; }
APP_DIR="$(conf_value APP_DIR)"
APP_USER="$(conf_value APP_USER)"
NODE_BIN="$(conf_value NODE_BIN)"
[[ -n "$APP_DIR" && -n "$APP_USER" && -n "$NODE_BIN" ]] || fail "$CONF is missing APP_DIR, APP_USER or NODE_BIN"

# The env file is 0600 and owned by the service user, so reading it needs
# that user; anyone else goes through sudo once, here.
if [[ "${RHAPSOD_NO_SUDO:-0}" != "1" && "$(id -u)" != "0" && "$(id -un)" != "$APP_USER" ]]; then
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
    echo "Apply it with:  rhapsod restart"
    ;;
  version)
    cli version
    ;;
  restart)
    if [[ "${1:-}" != "--force" ]]; then
      state="$(player_state)"
      case "$state" in
        idle|"") ;;
        *) fail "the player is $state; retry when it is idle, or pass --force" ;;
      esac
    fi
    "$SYSTEMCTL" restart rhapsod
    echo "Restarted. Check it with:  rhapsod status"
    ;;
  logs)
    lines="${1:-100}"
    [[ "$lines" =~ ^[0-9]+$ ]] || fail "logs takes a number of lines"
    exec "$JOURNALCTL" -u rhapsod -u rhapsod-ytdlp-daemon -n "$lines" -f
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
