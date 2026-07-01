import type { Context, Hono } from "hono"

import {
	AssistantMessagePayload,
	AttachmentPayload,
	ConversationEntryKind,
	ConversationEntryVisibility,
	ContextSummaryPayload,
	GenericObjectPayload,
	UserMessagePayload,
	type Conversation,
	type ConversationEntry,
} from "@freya/core"
import { type } from "arktype"
import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { Database } from "../db/index.ts"
import type { ConversationEntryRow, ConversationRow } from "./storage.ts"

import { conversations } from "./db-storage.ts"
import { ConversationNotFoundError } from "./errors.ts"

/** Hono environment populated by the conversations route middleware. */
type Env = {
	Variables: {
		db: Database
	}
}

/** Dependencies required to register conversation HTTP handlers. */
interface ConversationsHttpHandlersDeps {
	db: Database
	authSessionMiddleware: AuthSessionMiddleware
}

interface ListConversationsResponse {
	conversations: Conversation[]
}

interface ListConversationEntriesResponse {
	entries: ConversationEntry[]
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
	const response: ListConversationsResponse = {
		conversations: (await conversations(db, user.id).listConversations()).map(
			serializeConversation,
		),
	}

	return c.json(response)
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
		const response: ListConversationEntriesResponse = {
			entries: entries.map(serializeConversationEntry),
		}

		return c.json(response)
	} catch (err) {
		if (err instanceof ConversationNotFoundError) {
			return c.json({ error: "Conversation not found" }, 404)
		}
		throw err
	}
}

function serializeConversation(row: ConversationRow): Conversation {
	return {
		id: row.id,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	}
}

function serializeConversationEntry(row: ConversationEntryRow): ConversationEntry {
	const base = {
		id: row.id,
		conversationId: row.conversationId,
		sequence: row.sequence,
		visibility: row.visibility,
		metadata: row.metadata,
		createdAt: row.createdAt.toISOString(),
	}

	switch (row.kind) {
		case ConversationEntryKind.UserMessage:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: UserMessagePayload.assert(row.payload),
			}
		case ConversationEntryKind.AssistantMessage:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: AssistantMessagePayload.assert(row.payload),
			}
		case ConversationEntryKind.Attachment:
			return {
				...base,
				kind: row.kind,
				fileId: requireFileId(row),
				payload: AttachmentPayload.assert(row.payload),
			}
		case ConversationEntryKind.ToolCall:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: GenericObjectPayload.assert(row.payload),
			}
		case ConversationEntryKind.ToolResult:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: GenericObjectPayload.assert(row.payload),
			}
		case ConversationEntryKind.ContextSummary:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: ContextSummaryPayload.assert(row.payload),
			}
		case ConversationEntryKind.SystemNote:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: GenericObjectPayload.assert(row.payload),
			}
	}
}

function requireFileId(row: ConversationEntryRow): string {
	if (!row.fileId) {
		throw new Error(`Conversation attachment entry "${row.id}" is missing a file id`)
	}

	return row.fileId
}

function nullFileId(row: ConversationEntryRow): null {
	if (row.fileId !== null) {
		throw new Error(`Conversation entry "${row.id}" unexpectedly references a file`)
	}

	return null
}
