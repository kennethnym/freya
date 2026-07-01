import type { Context, Hono } from "hono"

import { ConversationEntryVisibility } from "@freya/core"
import { type } from "arktype"
import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { Database } from "../db/index.ts"
import type { ConversationRow } from "./storage.ts"

import { conversations } from "./db-storage.ts"
import { ConversationNotFoundError } from "./errors.ts"

/** Hono environment populated by the conversations route middleware. */
type Env = {
	Variables: {
		db: Database
	}
}

/** Serialized conversation summary returned by the list endpoint. */
interface ConversationSummaryResponse {
	id: string
	createdAt: string
	updatedAt: string
}

/** Dependencies required to register conversation HTTP handlers. */
interface ConversationsHttpHandlersDeps {
	db: Database
	authSessionMiddleware: AuthSessionMiddleware
}

const ConversationIdParam = type("string.uuid")

export function registerConversationsHttpHandlers(
	app: Hono,
	{ db, authSessionMiddleware }: ConversationsHttpHandlersDeps,
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("db", db)
		await next()
	})

	app.get("/api/conversations", inject, authSessionMiddleware, handleListConversations)
	app.get("/api/conversations/:id/entries", inject, authSessionMiddleware, handleListEntries)
}

async function handleListConversations(c: Context<Env>) {
	const user = c.get("user")!
	const db = c.get("db")

	return c.json({
		conversations: (await conversations(db, user.id).listConversations()).map(
			serializeConversation,
		),
	})
}

async function handleListEntries(c: Context<Env>) {
	const user = c.get("user")!
	const db = c.get("db")
	const conversationId = c.req.param("id")
	if (!conversationId) {
		return c.json({ error: "Conversation not found" }, 404)
	}
	const parsedConversationId = ConversationIdParam(conversationId)
	if (parsedConversationId instanceof type.errors) {
		return c.json({ error: "Conversation not found" }, 404)
	}

	try {
		const entries = await conversations(db, user.id).listEntries(parsedConversationId, {
			visibility: ConversationEntryVisibility.UserVisible,
		})

		return c.json({
			entries: entries.map((row) => ({
				id: row.id,
				conversationId: row.conversationId,
				sequence: row.sequence,
				kind: row.kind,
				visibility: row.visibility,
				fileId: row.fileId,
				payload: row.payload,
				metadata: row.metadata,
				createdAt: row.createdAt.toISOString(),
			})),
		})
	} catch (err) {
		if (err instanceof ConversationNotFoundError) {
			return c.json({ error: "Conversation not found" }, 404)
		}
		throw err
	}
}

function serializeConversation(row: ConversationRow): ConversationSummaryResponse {
	return {
		id: row.id,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	}
}
