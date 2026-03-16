import type { Context, Hono } from "hono"

import { type } from "arktype"
import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { UserSessionManager } from "../session/index.ts"

type Env = { Variables: { sessionManager: UserSessionManager } }

const locationInput = type({
	lat: "number",
	lng: "number",
	accuracy: "number",
	timestamp: "string.date.iso",
})

interface LocationHttpHandlersDeps {
	sessionManager: UserSessionManager
	authSessionMiddleware: AuthSessionMiddleware
}

export function registerLocationHttpHandlers(
	app: Hono,
	{ sessionManager, authSessionMiddleware }: LocationHttpHandlersDeps,
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("sessionManager", sessionManager)
		await next()
	})

	app.post("/api/location", inject, authSessionMiddleware, handleUpdateLocation)
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

	let session
	try {
		session = await sessionManager.getOrCreate(user.id)
	} catch (err) {
		console.error("[handleUpdateLocation] Failed to create session:", err)
		return c.json({ error: "Service unavailable" }, 503)
	}

	await session.engine.executeAction("aelis.location", "update-location", {
		lat: result.lat,
		lng: result.lng,
		accuracy: result.accuracy,
		timestamp: new Date(result.timestamp),
	})

	return c.body(null, 204)
}
