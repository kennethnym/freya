import type { Context, Hono } from "hono"

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
}

async function handleGetFeed(c: Context<Env>) {
	const user = c.get("user")!
	const sessionManager = c.get("sessionManager")
	const session = sessionManager.getOrCreate(user.id)

	const feed = await session.feed()

	return c.json({
		items: feed.items,
		errors: feed.errors.map((e) => ({
			sourceId: e.sourceId,
			error: e.error.message,
		})),
	})
}
