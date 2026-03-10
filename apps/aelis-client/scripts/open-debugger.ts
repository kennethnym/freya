// Opens React Native DevTools in Chrome, connected to the first
// available Hermes debug target. Requires Metro + proxy to be running.

import { $ } from "bun"

const PROXY_PORT = process.env.PROXY_PORT || "8080"
const METRO_PORT = process.env.METRO_PORT || "8081"
const tsIp = (await $`tailscale ip -4`.text()).trim()
const base = `http://${tsIp}:${PROXY_PORT}`

interface DebugTarget {
	devtoolsFrontendUrl: string
	webSocketDebuggerUrl: string
	reactNative?: {
		capabilities?: {
			prefersFuseboxFrontend?: boolean
		}
	}
}

const res = await fetch(`${base}/json`)
if (!res.ok) {
	console.error("Failed to fetch /json — is Metro running?")
	process.exit(1)
}

const targets: DebugTarget[] = await res.json()
const target = targets.find((t) => t.reactNative?.capabilities?.prefersFuseboxFrontend)

if (!target) {
	console.error("No debug target found. Is the app connected?")
	process.exit(1)
}

const wsUrl = target.webSocketDebuggerUrl
	.replace(/^ws:\/\//, "")
	.replace(`127.0.0.1:${METRO_PORT}`, `${tsIp}:${PROXY_PORT}`)

const url = `${base}/debugger-frontend/rn_fusebox.html?ws=${encodeURIComponent(wsUrl)}&sources.hide_add_folder=true&unstable_enableNetworkPanel=true`

console.log(url)

// Open in Chrome app mode if on macOS
try {
	await $`open -a "Google Chrome" --args --app=${url}`.quiet()
} catch {
	try {
		await $`xdg-open ${url}`.quiet()
	} catch {
		console.log("Open the URL above in Chrome.")
	}
}
