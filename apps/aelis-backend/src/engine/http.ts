import type { Context, Hono } from "hono"

import { contextKey } from "@aelis/core"
import { render } from "@nym.sh/jrx"
import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { UserSessionManager } from "../session/index.ts"

type Env = {
	Variables: {
		sessionManager: UserSessionManager
	}
}

interface FeedHttpHandlersDeps {
	sessionManager: UserSessionManager
	authSessionMiddleware: AuthSessionMiddleware
}

export function registerFeedHttpHandlers(
	app: Hono,
	{ sessionManager, authSessionMiddleware }: FeedHttpHandlersDeps,
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("sessionManager", sessionManager)
		await next()
	})

	app.get("/api/feed", inject, authSessionMiddleware, handleGetFeed)
	app.get("/api/context", inject, authSessionMiddleware, handleGetContext)
}

async function handleGetFeed(c: Context<Env>) {
	const user = c.get("user")!
	const sessionManager = c.get("sessionManager")
	const session = sessionManager.getOrCreate(user.id)

	const feed = await session.feed()

	const renderParam = c.req.query("render")

	if (renderParam !== undefined) {
		if (renderParam !== "json-render") {
			return c.json({ error: `Unknown render format: "${renderParam}"` }, 400)
		}

		if (!session.renderer) {
			return c.json({ error: "Rendering is not available" }, 500)
		}

		const renderedItems = session.renderer.render(feed.items).map((item) => ({
			...item,
			ui: render(item.ui),
		}))

		return c.json({
			items: renderedItems,
			errors: feed.errors.map((e) => ({
				sourceId: e.sourceId,
				error: e.error.message,
			})),
		})
	}

	return c.json({
		items: feed.items,
		errors: feed.errors.map((e) => ({
			sourceId: e.sourceId,
			error: e.error.message,
		})),
	})
}

function handleGetContext(c: Context<Env>) {
	const keyParam = c.req.query("key")
	if (!keyParam) {
		return c.json({ error: 'Invalid or missing "key" parameter: must be a JSON array' }, 400)
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(keyParam)
	} catch {
		return c.json({ error: 'Invalid or missing "key" parameter: must be a JSON array' }, 400)
	}

	if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isContextKeyPart)) {
		return c.json({ error: 'Invalid or missing "key" parameter: must be a JSON array' }, 400)
	}

	const matchParam = c.req.query("match")
	if (matchParam !== undefined && matchParam !== "exact" && matchParam !== "prefix") {
		return c.json({ error: 'Invalid "match" parameter: must be "exact" or "prefix"' }, 400)
	}

	const user = c.get("user")!
	const sessionManager = c.get("sessionManager")
	const session = sessionManager.getOrCreate(user.id)
	const context = session.engine.currentContext()
	const key = contextKey(...parsed)

	if (matchParam === "exact") {
		const value = context.get(key)
		if (value === undefined) {
			return c.json({ error: "Context key not found" }, 404)
		}
		return c.json({ match: "exact", value })
	}

	if (matchParam === "prefix") {
		const entries = context.find(key)
		if (entries.length === 0) {
			return c.json({ error: "Context key not found" }, 404)
		}
		return c.json({ match: "prefix", entries })
	}

	// Default: single find() covers both exact and prefix matches
	const entries = context.find(key)
	if (entries.length === 0) {
		return c.json({ error: "Context key not found" }, 404)
	}

	// If exactly one result with the same key length, treat as exact match
	if (entries.length === 1 && entries[0]!.key.length === parsed.length) {
		return c.json({ match: "exact", value: entries[0]!.value })
	}

	return c.json({ match: "prefix", entries })
}

/** Validates that a value is a valid ContextKeyPart (string, number, or plain object of primitives). */
function isContextKeyPart(value: unknown): boolean {
	if (typeof value === "string" || typeof value === "number") {
		return true
	}
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return Object.values(value).every(
			(v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
		)
	}
	return false
}
