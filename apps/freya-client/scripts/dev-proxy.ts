// Reverse proxy that sits in front of Metro so that all requests
// (including those arriving via Tailscale or Ona port-forwarding) reach
// Metro as loopback connections. This satisfies the isLocalSocket check
// in Expo's debug middleware, making /debugger-frontend, /json, and
// /open-debugger accessible from a remote browser.

import type { ServerWebSocket } from "bun"

const PROXY_PORT = parseInt(process.env.PROXY_PORT || "8080", 10)
const PROXY_HOST = process.env.PROXY_HOST || "0.0.0.0"
const METRO_HOST = process.env.METRO_HOST || "localhost"
const METRO_PORT = parseInt(process.env.METRO_PORT || "8081", 10)
const METRO_BASE = `http://${METRO_HOST}:${METRO_PORT}`
const METRO_WS_BASE = `ws://${METRO_HOST}:${METRO_PORT}`

function forwardHeaders(headers: Headers): Headers {
	const result = new Headers(headers)
	result.delete("origin")
	result.delete("referer")
	result.set("host", `${METRO_HOST}:${METRO_PORT}`)
	return result
}

interface WsData {
	upstream: WebSocket
	isDevice: boolean
}

interface DebugTarget {
	webSocketDebuggerUrl: string
	reactNative?: {
		capabilities?: { prefersFuseboxFrontend?: boolean }
	}
}

Bun.serve<WsData>({
	hostname: PROXY_HOST,
	port: PROXY_PORT,

	async fetch(req, server) {
		const url = new URL(req.url)

		// WebSocket upgrade — bridge to Metro's ws endpoint
		if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
			const wsUrl = `${METRO_WS_BASE}${url.pathname}${url.search}`
			const upstream = new WebSocket(wsUrl)

			// Wait for upstream to connect before upgrading the client
			try {
				await new Promise<void>((resolve, reject) => {
					upstream.addEventListener("open", () => resolve())
					upstream.addEventListener("error", () => reject(new Error("upstream ws failed")))
				})
			} catch {
				return new Response("Upstream WebSocket unavailable", { status: 502 })
			}

			const isDevice = url.pathname.startsWith("/inspector/device")
			const ok = server.upgrade(req, { data: { upstream, isDevice } })
			if (!ok) {
				upstream.close()
				return new Response("WebSocket upgrade failed", { status: 500 })
			}
			return undefined
		}

		// HTTP proxy
		const upstream = `${METRO_BASE}${url.pathname}${url.search}`
		const body = req.body ? await req.arrayBuffer() : undefined
		const res = await fetchUpstream(upstream, req.method, forwardHeaders(req.headers), body)
		if (res == null) {
			return new Response(`Metro is not reachable on ${METRO_HOST}. Restart the Expo dev server.`, {
				status: 502,
			})
		}

		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers: res.headers,
		})
	},

	websocket: {
		message(ws: ServerWebSocket<WsData>, msg) {
			ws.data.upstream.send(msg)
		},
		open(ws: ServerWebSocket<WsData>) {
			const { upstream } = ws.data
			upstream.addEventListener("message", (ev) => {
				if (typeof ev.data === "string") {
					ws.send(ev.data)
				} else if (ev.data instanceof ArrayBuffer) {
					ws.sendBinary(new Uint8Array(ev.data))
				}
			})
			upstream.addEventListener("close", () => ws.close())
			upstream.addEventListener("error", () => ws.close())

			// Print debugger URL shortly after a device connects,
			// giving Metro time to register the target.
			if (ws.data.isDevice) {
				setTimeout(() => printDebuggerUrl(), 1000)
			}
		},
		close(ws: ServerWebSocket<WsData>) {
			ws.data.upstream.close()
		},
	},
})

const tsIp = await Bun.$`tailscale ip -4`.text().then((s) => s.trim())

async function printDebuggerUrl() {
	const base = `http://${tsIp}:${PROXY_PORT}`
	const res = await fetch(`${METRO_BASE}/json`)
	if (!res.ok) return

	const parsedTargets: unknown = await res.json()
	if (!Array.isArray(parsedTargets)) return

	const targets = parsedTargets.filter(isDebugTarget)
	const target = targets.find((t) => t.reactNative?.capabilities?.prefersFuseboxFrontend)
	if (!target) return

	const wsPath = getProxyWebSocketPath(target.webSocketDebuggerUrl)

	console.log(
		`\n  React Native DevTools:\n  ${base}/debugger-frontend/rn_fusebox.html?ws=${encodeURIComponent(wsPath)}&sources.hide_add_folder=true&unstable_enableNetworkPanel=true\n`,
	)
}

console.log(
	`[proxy] listening on ${PROXY_HOST}:${PROXY_PORT}, forwarding to ${METRO_HOST}:${METRO_PORT}`,
)

async function fetchUpstream(
	upstream: string,
	method: string,
	headers: Headers,
	body: ArrayBuffer | undefined,
) {
	try {
		return await fetch(upstream, {
			method,
			headers,
			body,
			redirect: "manual",
		})
	} catch {
		console.error(`[proxy] ${method} ${upstream} failed; Metro is not reachable`)
		return null
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
