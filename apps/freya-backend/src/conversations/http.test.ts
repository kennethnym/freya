import { ConversationEntryKind, ConversationEntryVisibility } from "@freya/core"
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Hono } from "hono"

import type { Database } from "../db/index.ts"
import type {
	ConversationEntryRow,
	ConversationRow,
	ListConversationEntriesParams,
} from "./storage.ts"

import { mockAuthSessionMiddleware } from "../auth/session-middleware.ts"
import { ConversationNotFoundError } from "./errors.ts"
import { registerConversationsHttpHandlers } from "./http.ts"

const MockUserId = "k7Gx2mPqRvNwYs9TdLfA4bHcJeUo1iZn"
const ConversationId = "11111111-1111-4111-8111-111111111111"
const MissingConversationId = "22222222-2222-4222-8222-222222222222"

const conversationRowsByUser = new Map<string, ConversationRow[]>()
const conversationEntryRowsByUserAndConversation = new Map<string, ConversationEntryRow[]>()
const listEntriesCalls: Array<{
	userId: string
	conversationId: string
	params: ListConversationEntriesParams
}> = []

mock.module("./storage.ts", () => ({
	conversations: (_db: Database, userId: string) => ({
		async listConversations(): Promise<ConversationRow[]> {
			return conversationRowsByUser.get(userId) ?? []
		},

		async listEntries(
			conversationId: string,
			params: ListConversationEntriesParams = {},
		): Promise<ConversationEntryRow[]> {
			listEntriesCalls.push({ userId, conversationId, params })

			const rows = conversationEntryRowsByUserAndConversation.get(
				conversationEntriesKey(userId, conversationId),
			)
			if (!rows) {
				throw new ConversationNotFoundError(conversationId, userId)
			}

			if (params.visibility) {
				return rows.filter((row) => row.visibility === params.visibility)
			}

			return rows
		},
	}),
}))

const fakeDb = {} as Database

function buildTestApp(userId?: string) {
	const app = new Hono()
	registerConversationsHttpHandlers(app, {
		db: fakeDb,
		authSessionMiddleware: mockAuthSessionMiddleware(userId),
	})
	return app
}

function createConversationRow(
	id: string,
	createdAt: string,
	updatedAt: string,
	userId = MockUserId,
): ConversationRow {
	return {
		id,
		userId,
		createdAt: new Date(createdAt),
		updatedAt: new Date(updatedAt),
	}
}

function createConversationEntryRow(
	id: string,
	conversationId: string,
	sequence: number,
	kind: ConversationEntryRow["kind"],
	visibility: ConversationEntryRow["visibility"],
	payload: ConversationEntryRow["payload"],
	createdAt: string,
	metadata: ConversationEntryRow["metadata"] = {},
	fileId: string | null = null,
): ConversationEntryRow {
	return {
		id,
		conversationId,
		sequence,
		kind,
		visibility,
		fileId,
		payload,
		metadata,
		createdAt: new Date(createdAt),
	}
}

function conversationEntriesKey(userId: string, conversationId: string): string {
	return `${userId}:${conversationId}`
}

describe("GET /api/conversations", () => {
	beforeEach(() => {
		conversationRowsByUser.clear()
		conversationEntryRowsByUserAndConversation.clear()
		listEntriesCalls.length = 0
	})

	test("returns 401 without auth", async () => {
		const app = buildTestApp()

		const res = await app.request("/api/conversations")

		expect(res.status).toBe(401)
	})

	test("returns conversation summaries for the authenticated user", async () => {
		conversationRowsByUser.set(MockUserId, [
			createConversationRow(
				"conversation-newer",
				"2026-06-16T10:00:00.000Z",
				"2026-06-17T09:30:00.000Z",
			),
			createConversationRow(
				"conversation-older",
				"2026-06-15T10:00:00.000Z",
				"2026-06-16T09:30:00.000Z",
			),
		])
		const app = buildTestApp("user-1")

		const res = await app.request("/api/conversations")

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			conversations: Array<{ id: string; createdAt: string; updatedAt: string }>
		}
		expect(body).toEqual({
			conversations: [
				{
					id: "conversation-newer",
					createdAt: "2026-06-16T10:00:00.000Z",
					updatedAt: "2026-06-17T09:30:00.000Z",
				},
				{
					id: "conversation-older",
					createdAt: "2026-06-15T10:00:00.000Z",
					updatedAt: "2026-06-16T09:30:00.000Z",
				},
			],
		})
	})

	test("returns an empty list when no conversations exist", async () => {
		const app = buildTestApp("user-1")

		const res = await app.request("/api/conversations")

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			conversations: Array<{ id: string; createdAt: string; updatedAt: string }>
		}
		expect(body).toEqual({
			conversations: [],
		})
	})
})

describe("GET /api/conversations/:id/entries", () => {
	beforeEach(() => {
		conversationRowsByUser.clear()
		conversationEntryRowsByUserAndConversation.clear()
		listEntriesCalls.length = 0
	})

	test("returns 401 without auth", async () => {
		const app = buildTestApp()

		const res = await app.request("/api/conversations/conversation-1/entries")

		expect(res.status).toBe(401)
	})

	test("returns user-visible entries for the authenticated user", async () => {
		conversationEntryRowsByUserAndConversation.set(
			conversationEntriesKey(MockUserId, ConversationId),
			[
				createConversationEntryRow(
					"entry-user",
					ConversationId,
					1,
					ConversationEntryKind.UserMessage,
					ConversationEntryVisibility.UserVisible,
					{
						role: "user",
						parts: [{ type: "text", text: "What is on today?" }],
					},
					"2026-06-17T09:30:00.000Z",
				),
				createConversationEntryRow(
					"entry-tool",
					ConversationId,
					2,
					ConversationEntryKind.ToolCall,
					ConversationEntryVisibility.Internal,
					{
						toolName: "freya_list_context",
						input: {},
					},
					"2026-06-17T09:30:01.000Z",
				),
				createConversationEntryRow(
					"entry-assistant",
					ConversationId,
					3,
					ConversationEntryKind.AssistantMessage,
					ConversationEntryVisibility.UserVisible,
					{
						role: "assistant",
						parts: [{ type: "text", text: "You have two calendar events." }],
					},
					"2026-06-17T09:30:02.000Z",
					{ runId: "run-1" },
				),
			],
		)
		const app = buildTestApp("user-1")

		const res = await app.request(`/api/conversations/${ConversationId}/entries`)

		expect(res.status).toBe(200)
		expect(listEntriesCalls).toEqual([
			{
				userId: MockUserId,
				conversationId: ConversationId,
				params: { visibility: ConversationEntryVisibility.UserVisible },
			},
		])

		const body = (await res.json()) as { entries: unknown[] }
		expect(body).toEqual({
			entries: [
				{
					id: "entry-user",
					conversationId: ConversationId,
					sequence: 1,
					kind: ConversationEntryKind.UserMessage,
					visibility: ConversationEntryVisibility.UserVisible,
					fileId: null,
					payload: {
						role: "user",
						parts: [{ type: "text", text: "What is on today?" }],
					},
					metadata: {},
					createdAt: "2026-06-17T09:30:00.000Z",
				},
				{
					id: "entry-assistant",
					conversationId: ConversationId,
					sequence: 3,
					kind: ConversationEntryKind.AssistantMessage,
					visibility: ConversationEntryVisibility.UserVisible,
					fileId: null,
					payload: {
						role: "assistant",
						parts: [{ type: "text", text: "You have two calendar events." }],
					},
					metadata: { runId: "run-1" },
					createdAt: "2026-06-17T09:30:02.000Z",
				},
			],
		})
	})

	test("returns an empty list when the conversation has no user-visible entries", async () => {
		conversationEntryRowsByUserAndConversation.set(
			conversationEntriesKey(MockUserId, ConversationId),
			[
				createConversationEntryRow(
					"entry-tool",
					ConversationId,
					1,
					ConversationEntryKind.ToolResult,
					ConversationEntryVisibility.Internal,
					{ toolCallId: "call-1", output: { ok: true } },
					"2026-06-17T09:30:00.000Z",
				),
			],
		)
		const app = buildTestApp("user-1")

		const res = await app.request(`/api/conversations/${ConversationId}/entries`)

		expect(res.status).toBe(200)
		const body = (await res.json()) as { entries: unknown[] }
		expect(body).toEqual({ entries: [] })
	})

	test("returns 404 for malformed conversation ids without querying storage", async () => {
		const app = buildTestApp("user-1")

		const res = await app.request("/api/conversations/missing-conversation/entries")

		expect(res.status).toBe(404)
		expect(listEntriesCalls).toEqual([])
		const body = (await res.json()) as { error: string }
		expect(body).toEqual({ error: "Conversation not found" })
	})

	test("returns 404 when the conversation does not exist for the user", async () => {
		const app = buildTestApp("user-1")

		const res = await app.request(`/api/conversations/${MissingConversationId}/entries`)

		expect(res.status).toBe(404)
		expect(listEntriesCalls).toEqual([
			{
				userId: MockUserId,
				conversationId: MissingConversationId,
				params: { visibility: ConversationEntryVisibility.UserVisible },
			},
		])
		const body = (await res.json()) as { error: string }
		expect(body).toEqual({ error: "Conversation not found" })
	})
})
