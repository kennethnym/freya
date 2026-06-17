import { describe, expect, test } from "bun:test"

import type { AgentEvent, AgentServerApi } from "./index"

describe("agent protocol", () => {
	test("defines server methods and agent events", () => {
		const server: AgentServerApi = {
			async sendMessage(message) {
				return { message, conversationId: "conversation-1" }
			},
			ping() {
				return "pong"
			},
		}
		const event: AgentEvent = { type: "message_finished" }

		expect(server.ping()).toBe("pong")
		expect(event.type).toBe("message_finished")
	})
})
