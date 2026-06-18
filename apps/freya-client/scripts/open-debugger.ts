// Opens React Native DevTools in Chrome, connected to the first
// available Hermes debug target. Requires Metro + proxy to be running.

import { $ } from "bun"

const PROXY_PORT = process.env.PROXY_PORT || "8080"
const tsIp = (await $`tailscale ip -4`.text()).trim()
const base = `http://${tsIp}:${PROXY_PORT}`

interface DebugTarget {
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

const parsedTargets: unknown = await res.json()
if (!Array.isArray(parsedTargets)) {
	console.error("Invalid /json response from Metro.")
	process.exit(1)
}

const targets = parsedTargets.filter(isDebugTarget)
const target = targets.find((t) => t.reactNative?.capabilities?.prefersFuseboxFrontend)

if (!target) {
	console.error("No debug target found. Is the app connected?")
	process.exit(1)
}

const wsUrl = getProxyWebSocketPath(target.webSocketDebuggerUrl)

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

function isDebugTarget(value: unknown): value is DebugTarget {
	if (!isRecord(value) || typeof value.webSocketDebuggerUrl !== "string") return false

	const reactNative = value.reactNative
	if (reactNative === undefined) return true
	if (!isRecord(reactNative)) return false

	const capabilities = reactNative.capabilities
	if (capabilities === undefined) return true
	if (!isRecord(capabilities)) return false

	const prefersFuseboxFrontend = capabilities.prefersFuseboxFrontend
	return prefersFuseboxFrontend === undefined || typeof prefersFuseboxFrontend === "boolean"
}

function getProxyWebSocketPath(webSocketDebuggerUrl: string) {
	const url = new URL(webSocketDebuggerUrl)
	return `${tsIp}:${PROXY_PORT}${url.pathname}${url.search}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
