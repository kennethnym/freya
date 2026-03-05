import type { Context, Hono } from "hono"

import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"
import type { UserSessionManager } from "../session/index.ts"

type Env = {
	Variables: {
		sessionManager: UserSessionManager
		feedEnhancer: FeedEnhancer | null
	}
}

interface FeedHttpHandlersDeps {
	sessionManager: UserSessionManager
	authSessionMiddleware: AuthSessionMiddleware
	feedEnhancer: FeedEnhancer | null
}

export function registerFeedHttpHandlers(
	app: Hono,
	{ sessionManager, authSessionMiddleware, feedEnhancer }: FeedHttpHandlersDeps,
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("sessionManager", sessionManager)
		c.set("feedEnhancer", feedEnhancer)
		await next()
	})

	app.get("/api/feed", inject, authSessionMiddleware, handleGetFeed)
}

async function handleGetFeed(c: Context<Env>) {
	const user = c.get("user")!
	const sessionManager = c.get("sessionManager")
	const session = sessionManager.getOrCreate(user.id)

	const feed = session.engine.lastFeed() ?? (await session.engine.refresh())

	let items = feed.items
	const enhance = c.get("feedEnhancer")
	if (enhance) {
		try {
			items = await enhance(feed.items)
		} catch (err) {
			console.error("[enhancement] Unexpected error, returning unenhanced feed:", err)
		}
	}

	return c.json({
		items,
		errors: feed.errors.map((e) => ({
			sourceId: e.sourceId,
			error: e.error.message,
		})),
	})
}
