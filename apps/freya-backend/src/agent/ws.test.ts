import { describe, expect, test } from "bun:test"
import { Hono } from "hono"

import type { UserSessionManager } from "../session/index.ts"

import { registerAgentWebSocketHandlers } from "./ws.ts"

describe("agent websocket handler", () => {
	test("rejects disallowed browser origins before authenticating", async () => {
		let sessionChecked = false
		const app = new Hono()

		registerAgentWebSocketHandlers(app, {
			sessionManager: {} as UserSessionManager,
			corsMiddleware: async (c, next) => {
				const origin = c.req.header("origin")
				if (origin && origin !== "https://app.freya.test") {
					return c.text("Forbidden", 403)
				}

				await next()
			},
			authSessionMiddleware: async (c) => {
				sessionChecked = true
				return c.json({ error: "Unauthorized" }, 401)
			},
		})

		const res = await app.fetch(
			new Request("https://api.freya.test/api/agent/ws", {
				headers: {
					origin: "https://evil.test",
					upgrade: "websocket",
				},
			}),
		)

		expect(res.status).toBe(403)
		expect(sessionChecked).toBe(false)
	})

	test("allows requests without an origin header", async () => {
		let sessionChecked = false
		const app = new Hono()

		registerAgentWebSocketHandlers(app, {
			sessionManager: {} as UserSessionManager,
			corsMiddleware: async (_c, next) => {
				await next()
			},
			authSessionMiddleware: async (c) => {
				sessionChecked = true
				return c.json({ error: "Unauthorized" }, 401)
			},
		})

		const res = await app.fetch(
			new Request("https://api.freya.test/api/agent/ws", {
				headers: {
					upgrade: "websocket",
				},
			}),
		)

		expect(res.status).toBe(401)
		expect(sessionChecked).toBe(true)
	})
})
