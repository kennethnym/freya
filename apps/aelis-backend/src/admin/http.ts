import type { Context, Hono } from "hono"

import { type } from "arktype"
import { createMiddleware } from "hono/factory"

import type { AdminMiddleware } from "../auth/admin-middleware.ts"
import type { Database } from "../db/index.ts"
import type { UserSessionManager } from "../session/index.ts"

import { WeatherSourceProvider } from "../weather/provider.ts"

type Env = {
	Variables: {
		sessionManager: UserSessionManager
		db: Database
	}
}

interface AdminHttpHandlersDeps {
	sessionManager: UserSessionManager
	adminMiddleware: AdminMiddleware
	db: Database
}

export function registerAdminHttpHandlers(
	app: Hono,
	{ sessionManager, adminMiddleware, db }: AdminHttpHandlersDeps,
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("sessionManager", sessionManager)
		c.set("db", db)
		await next()
	})

	app.put("/api/admin/:sourceId/config", inject, adminMiddleware, handleUpdateProviderConfig)
}

const WeatherKitSourceProviderConfig = type({
	credentials: {
		privateKey: "string",
		keyId: "string",
		teamId: "string",
		serviceId: "string",
	},
})

async function handleUpdateProviderConfig(c: Context<Env>) {
	const sourceId = c.req.param("sourceId")
	if (!sourceId) {
		return c.body(null, 404)
	}

	const sessionManager = c.get("sessionManager")

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: "Invalid JSON" }, 400)
	}

	switch (sourceId) {
		case "aelis.weather": {
			const parsed = WeatherKitSourceProviderConfig(body)
			if (parsed instanceof type.errors) {
				return c.json({ error: parsed.summary }, 400)
			}

			const updated = new WeatherSourceProvider({
				credentials: parsed.credentials,
			})

			try {
				await sessionManager.replaceProvider(updated)
			} catch (err) {
				console.error(`[admin] replaceProvider("${sourceId}") failed:`, err)
				return c.json({ error: "Failed to apply config" }, 500)
			}

			return c.body(null, 204)
		}

		default:
			return c.json({ error: `Provider "${sourceId}" not found` }, 404)
	}
}
