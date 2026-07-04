import { describe, expect, test } from "bun:test"

import type {
	QueryAgent,
	QueryAgentAsk,
	QueryAgentEvent,
	QueryAgentEventListener,
	QueryAgentStreamEvent,
} from "./query-agent.ts"

import {
	AgentResponseStreamEventKind,
	streamAgentResponse,
	type AgentResponseStreamEvent,
} from "./streaming.ts"

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

		const events = await collectStreamAgentResponse(
			streamAgentResponse({
				agent,
				input: { message: "hello" },
			}),
		)

		expect(events).toEqual([
			{
				kind: AgentResponseStreamEventKind.ConversationStarted,
				conversationId: "conversation-1",
			},
			{ kind: AgentResponseStreamEventKind.AssistantMessage, text: "First message" },
			{ kind: AgentResponseStreamEventKind.AssistantMessage, text: "Second message" },
			{ kind: AgentResponseStreamEventKind.AssistantMessage, text: "Third message" },
			{ kind: AgentResponseStreamEventKind.ResponseFinished },
		])
	})

	test("preserves whitespace without emitting empty message events", async () => {
		const agent = new FakeQueryAgent([
			{ type: "conversation", conversationId: "conversation-1" },
			{ type: "text_delta", text: "  const value = 1  \n\n  return value" },
			{ type: "done" },
		])

		const events = await collectStreamAgentResponse(
			streamAgentResponse({
				agent,
				input: { message: "hello" },
			}),
		)

		expect(events).toEqual([
			{
				kind: AgentResponseStreamEventKind.ConversationStarted,
				conversationId: "conversation-1",
			},
			{ kind: AgentResponseStreamEventKind.AssistantMessage, text: "  const value = 1  " },
			{ kind: AgentResponseStreamEventKind.AssistantMessage, text: "  return value" },
			{ kind: AgentResponseStreamEventKind.ResponseFinished },
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
		const events: AgentResponseStreamEvent[] = []

		await expect(collectStreamAgentResponse(stream, events)).rejects.toThrow("model unavailable")

		expect(events).toEqual([
			{
				kind: AgentResponseStreamEventKind.ConversationStarted,
				conversationId: "conversation-1",
			},
			{ kind: AgentResponseStreamEventKind.AssistantMessage, text: "I'll check" },
			{ kind: AgentResponseStreamEventKind.ToolStarted, toolName: "calendar" },
			{
				kind: AgentResponseStreamEventKind.ToolFinished,
				toolName: "calendar",
				ok: false,
			},
			{ kind: AgentResponseStreamEventKind.AssistantMessage, text: "That failed" },
			{
				kind: AgentResponseStreamEventKind.ResponseFailed,
				error: "model unavailable",
			},
		])
	})
})

async function collectStreamAgentResponse(
	stream: AsyncIterable<AgentResponseStreamEvent>,
	events: AgentResponseStreamEvent[] = [],
): Promise<AgentResponseStreamEvent[]> {
	for await (const event of stream) {
		events.push(event)
	}

	return events
}
