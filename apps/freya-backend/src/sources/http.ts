import type { ActionDefinition } from "@freya/core"
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
	app.get("/api/sources/:sourceId/actions", inject, authSessionMiddleware, handleListActions)
	app.post(
		"/api/sources/:sourceId/actions/:actionId",
		inject,
		authSessionMiddleware,
		handleExecuteAction,
	)
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
		await sessionManager.saveSourceConfig(user.id, sourceId, {
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

async function handleListActions(c: Context<Env>) {
	const sourceId = c.req.param("sourceId")
	if (!sourceId) {
		return c.body(null, 404)
	}

	const user = c.get("user")!
	const sessionManager = c.get("sessionManager")

	let session
	try {
		session = await sessionManager.getOrCreate(user.id)
	} catch (err) {
		console.error("[handleListActions] Failed to create session:", err)
		return c.json({ error: "Service unavailable" }, 503)
	}

	try {
		const actions = await session.engine.listActions(sourceId)
		return c.json({ actions: serializeActions(actions) })
	} catch (err) {
		if (isActionNotFoundError(err)) {
			return c.json({ error: err.message }, 404)
		}
		console.error(`[handleListActions] Failed to list actions for "${sourceId}":`, err)
		return c.json({ error: "Failed to list actions" }, 500)
	}
}

async function handleExecuteAction(c: Context<Env>) {
	const sourceId = c.req.param("sourceId")
	const actionId = c.req.param("actionId")
	if (!sourceId || !actionId) {
		return c.body(null, 404)
	}

	let params: unknown
	try {
		params = await c.req.json()
	} catch {
		return c.json({ error: "Invalid JSON" }, 400)
	}

	const user = c.get("user")!
	const sessionManager = c.get("sessionManager")

	let session
	try {
		session = await sessionManager.getOrCreate(user.id)
	} catch (err) {
		console.error("[handleExecuteAction] Failed to create session:", err)
		return c.json({ error: "Service unavailable" }, 503)
	}

	try {
		const result = await session.engine.executeAction(sourceId, actionId, params)
		return c.json({ result })
	} catch (err) {
		if (isActionNotFoundError(err)) {
			return c.json({ error: err.message }, 404)
		}
		return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
	}
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

function serializeActions(actions: Record<string, ActionDefinition>) {
	const serialized: Record<string, { id: string; description?: string }> = {}
	for (const [key, action] of Object.entries(actions)) {
		serialized[key] = {
			id: action.id,
			...(action.description ? { description: action.description } : {}),
		}
	}
	return serialized
}

function isActionNotFoundError(err: unknown): err is Error {
	if (!(err instanceof Error)) {
		return false
	}
	return err.message.startsWith("Source not found:") || err.message.startsWith("Action ")
}
