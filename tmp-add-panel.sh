#!/bin/bash
PASS=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 16)
printf '\n# --- Setup panel ---\nRHAPSOD_PANEL_ENABLED=true\nRHAPSOD_PANEL_PORT=8080\nRHAPSOD_PANEL_USER=admin\nRHAPSOD_PANEL_PASSWORD=%s\n' "$PASS" | sudo tee -a /etc/rhapsod.env > /dev/null
echo "PANEL_PASS=$PASS"
