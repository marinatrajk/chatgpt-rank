#!/usr/bin/env bash
# Starts a virtual screen, shares it through noVNC on port 6080, then runs the given command
# (npm run check by default).
set -euo pipefail

Xvfb :99 -screen 0 1280x900x24 -nolisten tcp >/dev/null 2>&1 &
sleep 1
fluxbox >/dev/null 2>&1 &

# Without VNC_PASSWORD the viewer is open to anyone who can reach port 6080; compose.yaml only
# publishes it on 127.0.0.1. Set a password before exposing it on a server.
if [[ -n "${VNC_PASSWORD:-}" ]]; then
  x11vnc -storepasswd "$VNC_PASSWORD" /tmp/vncpass >/dev/null 2>&1
  auth=(-rfbauth /tmp/vncpass)
else
  auth=(-nopw)
fi
x11vnc -display :99 -localhost -forever -shared -quiet "${auth[@]}" >/dev/null 2>&1 &
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &

exec "$@"
