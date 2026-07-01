import type { AgentEvent } from "@freya/agent-protocol"

import type { QueryAgent, QueryAgentAsk } from "./query-agent.ts"

export type AgentResponseStreamItem = { type: "event"; event: AgentEvent }

export async function* streamAgentResponse({
	agent,
	input,
}: {
	agent: QueryAgent
	input: QueryAgentAsk
}): AsyncGenerator<AgentEvent, void, void> {
	let message = ""
	let conversationId: string | null = null
	const splitter = new AgentMessageSplitter()

	function messageEvent(text: string): AgentEvent | null {
		if (text.trim() === "") return null

		return { type: "message_created", text }
	}

	function flushPendingMessage(): AgentEvent | null {
		const text = splitter.flush()
		if (text === null) return null

		return messageEvent(text)
	}

	for await (const event of agent.ask(input)) {
		if (input.signal?.aborted) {
			break
		}

		switch (event.type) {
			case "conversation":
				conversationId = event.conversationId
				yield { type: "conversation_started", conversationId }
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
				yield { type: "tool_started", toolName: event.toolName }
				break

			case "tool_end":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				yield {
					type: "tool_finished",
					toolName: event.toolName,
					ok: event.ok,
				}
				break

			case "error":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				yield { type: "message_failed", error: event.message }
				throw new Error(event.message)

			case "done":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				yield { type: "message_finished" }
				return
		}
	}

	const item = flushPendingMessage()
	if (item) yield item

	yield { type: "message_finished" }
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
