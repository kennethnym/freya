import { ConversationEntryKind, ConversationEntryVisibility } from "@freya/core"
import { describe, expect, test } from "bun:test"

import { AgentEventKind, type AgentEvent, type AgentServerApi } from "./index"

describe("agent protocol", () => {
	test("defines server methods and agent events", () => {
		const server: AgentServerApi = {
			async sendMessage(message) {
				return {
					id: "entry-1",
					conversationId: "conversation-1",
					sequence: 1,
					kind: ConversationEntryKind.UserMessage,
					visibility: ConversationEntryVisibility.UserVisible,
					fileId: null,
					payload: {
						role: "user",
						parts: [{ type: "text", text: message }],
					},
					metadata: {},
					createdAt: "2026-07-03T00:00:00.000Z",
				}
			},
			notify() {
				// no-op for protocol shape test
			},
			ping() {
				return "pong"
			},
		}
		const event: AgentEvent = {
			kind: AgentEventKind.ResponseFinished,
			conversationId: "conversation-1",
		}

		expect(server.ping()).toBe("pong")
		expect(event.kind).toBe(AgentEventKind.ResponseFinished)
	})
})
