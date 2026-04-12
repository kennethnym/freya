import type { Context, Hono } from "hono"

import { type } from "arktype"
import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { UserSessionManager } from "../session/index.ts"

import {
	CredentialStorageUnavailableError,
	InvalidSourceConfigError,
	InvalidSourceCredentialsError,
	SourceNotFoundError,
} from "./errors.ts"

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
	"+": "reject",
	"enabled?": "boolean",
	"config?": "unknown",
})

const ReplaceSourceConfigRequestBody = type({
	"+": "reject",
	enabled: "boolean",
	config: "unknown",
	"credentials?": "unknown",
})

const ReplaceSourceConfigNoConfigRequestBody = type({
	"+": "reject",
	enabled: "boolean",
	"credentials?": "unknown",
})

export function registerSourcesHttpHandlers(
	app: Hono,
	{ sessionManager, authSessionMiddleware }: SourcesHttpHandlersDeps,
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("sessionManager", sessionManager)
		await next()
	})

	app.get("/api/sources/:sourceId", inject, authSessionMiddleware, handleGetSource)
	app.patch("/api/sources/:sourceId", inject, authSessionMiddleware, handleUpdateSource)
	app.put("/api/sources/:sourceId", inject, authSessionMiddleware, handleReplaceSource)
	app.put(
		"/api/sources/:sourceId/credentials",
		inject,
		authSessionMiddleware,
		handleUpdateCredentials,
	)
}

async function handleGetSource(c: Context<Env>) {
	const sourceId = c.req.param("sourceId")
	if (!sourceId) {
		return c.body(null, 404)
	}

	const sessionManager = c.get("sessionManager")
	const user = c.get("user")!

	try {
		const result = await sessionManager.fetchSourceConfig(user.id, sourceId)
		return c.json(result)
	} catch (err) {
		if (err instanceof SourceNotFoundError) {
			return c.json({ error: err.message }, 404)
		}
		throw err
	}
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

	if (!provider.configSchema && "config" in parsed) {
		return c.json({ error: `Source "${sourceId}" does not accept config` }, 400)
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

	const schema = provider.configSchema
		? ReplaceSourceConfigRequestBody
		: ReplaceSourceConfigNoConfigRequestBody
	const parsed = schema(body)
	if (parsed instanceof type.errors) {
		return c.json({ error: parsed.summary }, 400)
	}

	const { enabled, credentials } = parsed
	const config = "config" in parsed ? parsed.config : undefined
	const user = c.get("user")!

	try {
		await sessionManager.upsertSourceConfig(user.id, sourceId, {
			enabled,
			config,
			credentials,
		})
	} catch (err) {
		if (err instanceof SourceNotFoundError) {
			return c.json({ error: err.message }, 404)
		}
		if (err instanceof InvalidSourceConfigError) {
			return c.json({ error: err.message }, 400)
		}
		if (err instanceof CredentialStorageUnavailableError) {
			return c.json({ error: err.message }, 503)
		}
		throw err
	}

	return c.body(null, 204)
}

async function handleUpdateCredentials(c: Context<Env>) {
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

	const user = c.get("user")!

	try {
		await sessionManager.updateSourceCredentials(user.id, sourceId, body)
	} catch (err) {
		if (err instanceof SourceNotFoundError) {
			return c.json({ error: err.message }, 404)
		}
		if (err instanceof InvalidSourceCredentialsError) {
			return c.json({ error: err.message }, 400)
		}
		if (err instanceof CredentialStorageUnavailableError) {
			return c.json({ error: err.message }, 503)
		}
		throw err
	}

	return c.body(null, 204)
}
