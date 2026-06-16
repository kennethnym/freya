import { describe, expect, test } from "bun:test"

import type { ConversationStorageEntry } from "./conversation-recording-query-agent.ts"

import { ConversationEntryKind } from "../conversations/types.ts"
import { createSessionManager } from "./session-manager.ts"

describe("createSessionManager", () => {
	test("hydrates user and assistant entries into Pi session context", () => {
		const sessionManager = createSessionManager({
			entries: [
				entry({
					id: "entry-1",
					sequence: 1,
					kind: ConversationEntryKind.UserMessage,
					payload: {
						role: "user",
						parts: [{ type: "text", text: "hello" }],
					},
				}),
				entry({
					id: "entry-2",
					sequence: 2,
					kind: ConversationEntryKind.AssistantMessage,
					payload: {
						role: "assistant",
						parts: [{ type: "text", text: "hi there" }],
					},
					metadata: {
						modelRun: {
							route: "agent_query",
							provider: "openrouter",
							model: "stored-model",
						},
					},
				}),
			],
			modelProvider: "openrouter",
			modelId: "fallback-model",
		})

		const context = sessionManager.buildSessionContext()

		expect(context.messages.map(roleOf)).toEqual(["user", "assistant"])
		expect(textFromMessage(context.messages[0])).toBe("hello")
		expect(textFromMessage(context.messages[1])).toBe("hi there")
		expect(context.model).toEqual({
			provider: "openrouter",
			modelId: "stored-model",
		})
	})

	test("uses the latest context summary and replays only uncovered raw entries", () => {
		const sessionManager = createSessionManager({
			entries: [
				entry({
					id: "entry-1",
					sequence: 1,
					kind: ConversationEntryKind.UserMessage,
					payload: {
						role: "user",
						parts: [{ type: "text", text: "old question" }],
					},
				}),
				entry({
					id: "entry-2",
					sequence: 2,
					kind: ConversationEntryKind.AssistantMessage,
					payload: {
						role: "assistant",
						parts: [{ type: "text", text: "old answer" }],
					},
				}),
				entry({
					id: "entry-3",
					sequence: 3,
					kind: ConversationEntryKind.ContextSummary,
					payload: {
						covers: {
							startSequence: 1,
							endSequence: 2,
						},
						summary: {
							durableFacts: ["The user is designing conversation storage."],
							preferences: [],
							decisions: ["Context compaction is stored as a conversation entry."],
							openTasks: [],
							importantDetails: [],
						},
						promptVersion: "test-v1",
					},
				}),
				entry({
					id: "entry-4",
					sequence: 4,
					kind: ConversationEntryKind.UserMessage,
					payload: {
						role: "user",
						parts: [{ type: "text", text: "new question" }],
					},
				}),
			],
			modelProvider: "openrouter",
			modelId: "fallback-model",
		})

		const context = sessionManager.buildSessionContext()

		expect(context.messages.map(roleOf)).toEqual(["compactionSummary", "user"])
		expect(textFromMessage(context.messages[0])).toContain(
			"The user is designing conversation storage.",
		)
		expect(textFromMessage(context.messages[0])).toContain(
			"Context compaction is stored as a conversation entry.",
		)
		expect(textFromMessage(context.messages[1])).toBe("new question")
	})
})

function entry(
	input: Omit<ConversationStorageEntry, "createdAt" | "metadata"> & {
		createdAt?: Date
		metadata?: ConversationStorageEntry["metadata"]
	},
): ConversationStorageEntry {
	return {
		...input,
		metadata: input.metadata ?? {},
		createdAt: input.createdAt ?? new Date("2026-06-15T00:00:00.000Z"),
	}
}

function roleOf(message: unknown): string | undefined {
	if (!isRecord(message)) return undefined
	return typeof message.role === "string" ? message.role : undefined
}

function textFromMessage(message: unknown): string {
	if (!isRecord(message)) return ""
	if (typeof message.summary === "string") return message.summary

	const content = message.content
	if (typeof content === "string") return content
	if (!Array.isArray(content)) return ""

	return content.map(textFromContentPart).join("")
}

function textFromContentPart(part: unknown): string {
	if (!isRecord(part)) return ""
	return typeof part.text === "string" ? part.text : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
