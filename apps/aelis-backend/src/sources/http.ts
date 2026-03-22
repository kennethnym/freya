import type { Context, Hono } from "hono"

import { type } from "arktype"
import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { UserSessionManager } from "../session/index.ts"

import { InvalidSourceConfigError, SourceNotFoundError } from "./errors.ts"

type Env = {
	Variables: {
		sessionManager: UserSessionManager
	}
}

interface SourcesHttpHandlersDeps {
	sessionManager: UserSessionManager
	authSessionMiddleware: AuthSessionMiddleware
}

const UpdateSourceConfigRequestBody = type({
	"enabled?": "boolean",
	"config?": "unknown",
})

const ReplaceSourceConfigRequestBody = type({
	enabled: "boolean",
	config: "unknown",
})

export function registerSourcesHttpHandlers(
	app: Hono,
	{ sessionManager, authSessionMiddleware }: SourcesHttpHandlersDeps,
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("sessionManager", sessionManager)
		await next()
	})

	app.patch("/api/sources/:sourceId", inject, authSessionMiddleware, handleUpdateSource)
	app.put("/api/sources/:sourceId", inject, authSessionMiddleware, handleReplaceSource)
}

async function handleUpdateSource(c: Context<Env>) {
	const sourceId = c.req.param("sourceId")
	if (!sourceId) {
		return c.body(null, 404)
	}

	const sessionManager = c.get("sessionManager")

	// Validate source exists as a registered provider
	const provider = sessionManager.getProvider(sourceId)
	if (!provider) {
		return c.json({ error: `Source "${sourceId}" not found` }, 404)
	}

	// Parse request body
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: "Invalid JSON" }, 400)
	}

	const parsed = UpdateSourceConfigRequestBody(body)
	if (parsed instanceof type.errors) {
		return c.json({ error: parsed.summary }, 400)
	}

	const { enabled, config: newConfig } = parsed
	const user = c.get("user")!

	try {
		await sessionManager.updateSourceConfig(user.id, sourceId, {
			enabled,
			config: newConfig,
		})
	} catch (err) {
		if (err instanceof SourceNotFoundError) {
			return c.json({ error: err.message }, 404)
		}
		if (err instanceof InvalidSourceConfigError) {
			return c.json({ error: err.message }, 400)
		}
		throw err
	}

	return c.body(null, 204)
}

async function handleReplaceSource(c: Context<Env>) {
	const sourceId = c.req.param("sourceId")
	if (!sourceId) {
		return c.body(null, 404)
	}

	const sessionManager = c.get("sessionManager")

	const provider = sessionManager.getProvider(sourceId)
	if (!provider) {
		return c.json({ error: `Source "${sourceId}" not found` }, 404)
	}

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: "Invalid JSON" }, 400)
	}

	const parsed = ReplaceSourceConfigRequestBody(body)
	if (parsed instanceof type.errors) {
		return c.json({ error: parsed.summary }, 400)
	}

	const { enabled, config } = parsed
	const user = c.get("user")!

	try {
		await sessionManager.upsertSourceConfig(user.id, sourceId, {
			enabled,
			config,
		})
	} catch (err) {
		if (err instanceof SourceNotFoundError) {
			return c.json({ error: err.message }, 404)
		}
		if (err instanceof InvalidSourceConfigError) {
			return c.json({ error: err.message }, 400)
		}
		throw err
	}

	return c.body(null, 204)
}
