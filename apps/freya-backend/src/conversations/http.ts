import type { Context, Hono } from "hono"

import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { Database } from "../db/index.ts"

import { conversations } from "./storage.ts"

type Env = {
	Variables: {
		db: Database
	}
}

interface ConversationsHttpHandlersDeps {
	db: Database
	authSessionMiddleware: AuthSessionMiddleware
}

export function registerConversationsHttpHandlers(
	app: Hono,
	{ db, authSessionMiddleware }: ConversationsHttpHandlersDeps,
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("db", db)
		await next()
	})

	app.get("/api/conversations", inject, authSessionMiddleware, handleListConversations)
}

async function handleListConversations(c: Context<Env>) {
	const user = c.get("user")!
	const db = c.get("db")

	return c.json({
		conversations: (await conversations(db, user.id).listConversations()).map((row) => ({
			id: row.id,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		})),
	})
}
