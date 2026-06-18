#!/usr/bin/env bash
set -euo pipefail

PROXY_PORT=${PROXY_PORT:-8080}
METRO_HOST=${METRO_HOST:-localhost}
METRO_PORT=${METRO_PORT:-8081}
TS_IP=$(tailscale ip -4)

port_is_open() {
	(: >"/dev/tcp/$1/$2") >/dev/null 2>&1
}

ensure_port_available() {
	local port=$1
	local name=$2

	if port_is_open localhost "$port"; then
		echo "$name port $port is already in use." >&2
		echo "Stop the existing process or set ${name}_PORT to another value." >&2
		exit 1
	fi
}

wait_for_metro() {
	for _ in {1..120}; do
		if port_is_open "$METRO_HOST" "$METRO_PORT"; then
			return 0
		fi
		sleep 0.5
	done

	echo "Metro did not start on ${METRO_HOST}:${METRO_PORT}." >&2
	return 1
}

ensure_port_available "$PROXY_PORT" PROXY
ensure_port_available "$METRO_PORT" METRO

# Start the proxy only after Metro is listening. Otherwise an iOS client can hit
# the proxy during Expo startup and get a misleading upstream connection error.
(
	wait_for_metro
	exec env PROXY_PORT=$PROXY_PORT METRO_HOST=$METRO_HOST METRO_PORT=$METRO_PORT bun run scripts/dev-proxy.ts
) &
PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null" EXIT

echo "Expo proxy: http://${TS_IP}:${PROXY_PORT}"
EXPO_PACKAGER_PROXY_URL=http://${TS_IP}:$PROXY_PORT bunx expo start --localhost -p $METRO_PORT
