import type { AgentEvent } from "@freya/agent-protocol"

import { describe, expect, test } from "bun:test"

import type {
	QueryAgent,
	QueryAgentAsk,
	QueryAgentEvent,
	QueryAgentEventListener,
	QueryAgentStreamEvent,
} from "./query-agent.ts"
import type { AgentResponseStreamItem } from "./streaming.ts"

import { streamAgentResponse } from "./streaming.ts"

class FakeQueryAgent implements QueryAgent {
	readonly inputs: QueryAgentAsk[] = []
	private readonly events: QueryAgentStreamEvent[]

	constructor(events: QueryAgentStreamEvent[]) {
		this.events = events
	}

	async *ask(input: QueryAgentAsk): AsyncIterable<QueryAgentStreamEvent> {
		this.inputs.push(input)
		for (const event of this.events) {
			yield event
		}
	}

	addEventListener<T extends QueryAgentEvent>(
		_type: T,
		_listener: QueryAgentEventListener<T>,
	): () => void {
		return () => {}
	}

	dispose(): void {}
}

describe("streamAgentResponse", () => {
	test("emits one message event per completed newline", async () => {
		const agent = new FakeQueryAgent([
			{ type: "conversation", conversationId: "conversation-1" },
			{ type: "text_delta", text: "First message\nSec" },
			{ type: "text_delta", text: "ond message\nThird message" },
			{ type: "done" },
		])

		const { events, result } = await collectStreamAgentResponse(
			streamAgentResponse({
				agent,
				input: { message: "hello" },
			}),
		)

		expect(result).toEqual({
			conversationId: "conversation-1",
			message: "First message\nSecond message\nThird message",
		})
		expect(events).toEqual([
			{ type: "conversation_started", conversationId: "conversation-1" },
			{ type: "message_created", text: "First message" },
			{ type: "message_created", text: "Second message" },
			{ type: "message_created", text: "Third message" },
			{ type: "message_finished" },
		])
	})

	test("preserves whitespace without emitting empty message events", async () => {
		const agent = new FakeQueryAgent([
			{ type: "conversation", conversationId: "conversation-1" },
			{ type: "text_delta", text: "  const value = 1  \n\n  return value" },
			{ type: "done" },
		])

		const { events, result } = await collectStreamAgentResponse(
			streamAgentResponse({
				agent,
				input: { message: "hello" },
			}),
		)

		expect(result).toEqual({
			conversationId: "conversation-1",
			message: "  const value = 1  \n\n  return value",
		})
		expect(events).toEqual([
			{ type: "conversation_started", conversationId: "conversation-1" },
			{ type: "message_created", text: "  const value = 1  " },
			{ type: "message_created", text: "  return value" },
			{ type: "message_finished" },
		])
	})

	test("emits tool and failure events", async () => {
		const agent = new FakeQueryAgent([
			{ type: "conversation", conversationId: "conversation-1" },
			{ type: "text_delta", text: "I'll check" },
			{ type: "tool_start", toolName: "calendar" },
			{ type: "tool_end", toolName: "calendar", ok: false },
			{ type: "text_delta", text: "That failed" },
			{ type: "error", message: "model unavailable" },
		])
		const stream = streamAgentResponse({
			agent,
			input: { message: "hello" },
		})
		const events: AgentEvent[] = []

		await expect(collectStreamAgentResponse(stream, events)).rejects.toThrow("model unavailable")

		expect(events).toEqual([
			{ type: "conversation_started", conversationId: "conversation-1" },
			{ type: "message_created", text: "I'll check" },
			{ type: "tool_started", toolName: "calendar" },
			{ type: "tool_finished", toolName: "calendar", ok: false },
			{ type: "message_created", text: "That failed" },
			{ type: "message_failed", error: "model unavailable" },
		])
	})
})

async function collectStreamAgentResponse(
	stream: AsyncIterable<AgentResponseStreamItem>,
	events: AgentEvent[] = [],
): Promise<{
	events: AgentEvent[]
	result: { message: string; conversationId: string }
}> {
	let result: { message: string; conversationId: string } | null = null

	for await (const item of stream) {
		switch (item.type) {
			case "event":
				events.push(item.event)
				break
			case "result":
				result = item.result
				break
		}
	}

	if (!result) {
		throw new Error("Expected stream result")
	}

	return { events, result }
}
