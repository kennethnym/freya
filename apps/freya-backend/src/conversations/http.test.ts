import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Hono } from "hono"

import type { Database } from "../db/index.ts"
import type { ConversationRow } from "./storage.ts"

import { mockAuthSessionMiddleware } from "../auth/session-middleware.ts"
import { registerConversationsHttpHandlers } from "./http.ts"

const MockUserId = "k7Gx2mPqRvNwYs9TdLfA4bHcJeUo1iZn"

const conversationRowsByUser = new Map<string, ConversationRow[]>()

mock.module("./storage.ts", () => ({
	conversations: (_db: Database, userId: string) => ({
		async listConversations(): Promise<ConversationRow[]> {
			return conversationRowsByUser.get(userId) ?? []
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

describe("GET /api/conversations", () => {
	beforeEach(() => {
		conversationRowsByUser.clear()
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
