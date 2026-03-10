import type { Context, Hono } from "hono"

import { type } from "arktype"
import { createMiddleware } from "hono/factory"

import type { UserSessionManager } from "../session/index.ts"

import { requireSession } from "../auth/session-middleware.ts"

type Env = { Variables: { sessionManager: UserSessionManager } }

const locationInput = type({
	lat: "number",
	lng: "number",
	accuracy: "number",
	timestamp: "string.date.iso",
})

export function registerLocationHttpHandlers(
	app: Hono,
	{ sessionManager }: { sessionManager: UserSessionManager },
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("sessionManager", sessionManager)
		await next()
	})

	app.post("/api/location", inject, requireSession, handleUpdateLocation)
}

async function handleUpdateLocation(c: Context<Env>) {
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: "Invalid JSON" }, 400)
	}

	const result = locationInput(body)

	if (result instanceof type.errors) {
		return c.json({ error: result.summary }, 400)
	}

	const user = c.get("user")!
	const sessionManager = c.get("sessionManager")
	const session = sessionManager.getOrCreate(user.id)
	await session.engine.executeAction("aelis.location", "update-location", {
		lat: result.lat,
		lng: result.lng,
		accuracy: result.accuracy,
		timestamp: new Date(result.timestamp),
	})

	return c.body(null, 204)
}
