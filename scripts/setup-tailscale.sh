#!/bin/bash

# Tailscale setup script
# Authenticates with Tailscale if TS_AUTH_KEY is set and Tailscale is not already logged in

set -e

if [ -z "$TS_AUTH_KEY" ]; then
    echo "TS_AUTH_KEY is not set, skipping Tailscale login."
    exit 0
fi

STATUS=$(tailscale status 2>&1 || true)

if echo "$STATUS" | grep -qi "logged out\|stopped"; then
    echo "Tailscale is not authenticated. Logging in..."
    sudo tailscale up --accept-routes --auth-key="$TS_AUTH_KEY"
    echo "Tailscale login complete."
else
    echo "Tailscale is already authenticated, skipping."
fi
