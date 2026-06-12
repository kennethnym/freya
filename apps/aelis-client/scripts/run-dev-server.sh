#!/usr/bin/env bash
set -euo pipefail

PROXY_PORT=8080
METRO_PORT=8081
TS_IP=$(tailscale ip -4)

# Start a reverse proxy so Metro sees all requests as loopback.
# This makes debugger endpoints (/debugger-frontend, /json, /open-debugger)
# accessible through the Tailscale IP.
PROXY_PORT=$PROXY_PORT METRO_PORT=$METRO_PORT bun run scripts/dev-proxy.ts &
PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null" EXIT

echo "Expo proxy: http://${TS_IP}:${PROXY_PORT}"
EXPO_PACKAGER_PROXY_URL=http://${TS_IP}:$PROXY_PORT bunx expo start --localhost -p $METRO_PORT
