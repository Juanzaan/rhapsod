#!/bin/sh
# Verifies nested-tree deploy: mode flag, data, page.
P=$(/usr/bin/sudo /bin/grep '^RHAPSOD_PANEL_PASSWORD=' /etc/rhapsod.env | /bin/cut -d= -f2-)
BASE=http://127.0.0.1:8080
/usr/bin/curl -s -m 15 -u "admin:$P" $BASE/api/server | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print("mode:", d.get("mode"), "| ch:", len(d.get("channels",[])), "| users:", len(d.get("clients",[])))'
echo -n 'server page: '
/usr/bin/curl -s -m 10 -o /dev/null -w '%{http_code}' -u "admin:$P" $BASE/server
echo
/bin/rm -f /tmp/server-snapshot.* /tmp/main.js* /tmp/panel-server.* /tmp/panel-templates.* /tmp/server-snapshot.ts /tmp/main.ts /tmp/panel-server.ts /tmp/panel-templates.ts /tmp/server-snapshot.test.ts /tmp/panel-templates.test.ts /tmp/qw-srv4.sh
echo CLEANED
