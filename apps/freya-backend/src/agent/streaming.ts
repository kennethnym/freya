import type { AgentEvent, SendMessageResult } from "@freya/agent-protocol"

import type { QueryAgent, QueryAgentAsk } from "./query-agent.ts"

export type AgentResponseStreamItem =
	| { type: "event"; event: AgentEvent }
	| { type: "result"; result: SendMessageResult }

export async function* streamAgentResponse({
	agent,
	input,
}: {
	agent: QueryAgent
	input: QueryAgentAsk
}): AsyncGenerator<AgentResponseStreamItem, void, void> {
	let message = ""
	let conversationId: string | null = null
	const splitter = new AgentMessageSplitter()

	function messageEvent(text: string): AgentResponseStreamItem | null {
		if (text.trim() === "") return null

		return { type: "event", event: { type: "message_created", text } }
	}

	function flushPendingMessage(): AgentResponseStreamItem | null {
		const text = splitter.flush()
		if (text === null) return null

		return messageEvent(text)
	}

	for await (const event of agent.ask(input)) {
		switch (event.type) {
			case "conversation":
				conversationId = event.conversationId
				yield { type: "event", event: { type: "conversation_started", conversationId } }
				break

			case "text_delta":
				message += event.text
				for (const line of splitter.push(event.text)) {
					const item = messageEvent(line)
					if (item) yield item
				}
				break

			case "tool_start":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				yield { type: "event", event: { type: "tool_started", toolName: event.toolName } }
				break

			case "tool_end":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				yield {
					type: "event",
					event: {
						type: "tool_finished",
						toolName: event.toolName,
						ok: event.ok,
					},
				}
				break

			case "error":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				yield { type: "event", event: { type: "message_failed", error: event.message } }
				throw new Error(event.message)

			case "done":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				const result = createResult(message, conversationId)
				yield { type: "event", event: { type: "message_finished" } }
				yield { type: "result", result }
				return
		}
	}

	const item = flushPendingMessage()
	if (item) yield item
	const result = createResult(message, conversationId)
	yield { type: "event", event: { type: "message_finished" } }
	yield { type: "result", result }
}

function createResult(message: string, conversationId: string | null): SendMessageResult {
	if (!conversationId) {
		throw new Error("Agent response stream ended without a conversation id")
	}

	return { message, conversationId }
}

class AgentMessageSplitter {
	private pending = ""

	push(text: string): string[] {
		this.pending += text

		const lines = this.pending.split(/\r?\n/)
		this.pending = lines.pop() ?? ""

		return lines
	}

	flush(): string | null {
		if (this.pending === "") return null

		const text = this.pending
		this.pending = ""
		return text
	}
}
