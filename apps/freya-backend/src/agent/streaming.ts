import type { QueryAgent, QueryAgentAsk } from "./query-agent.ts"

export const AgentResponseStreamEventKind = {
	ConversationStarted: "conversation_started",
	AssistantMessage: "assistant_message",
	ToolStarted: "tool_started",
	ToolFinished: "tool_finished",
	ResponseFinished: "response_finished",
	ResponseFailed: "response_failed",
} as const

export type AgentResponseStreamEventKind =
	(typeof AgentResponseStreamEventKind)[keyof typeof AgentResponseStreamEventKind]

export type AgentResponseStreamEvent =
	| {
			kind: typeof AgentResponseStreamEventKind.ConversationStarted
			conversationId: string
	  }
	| {
			kind: typeof AgentResponseStreamEventKind.AssistantMessage
			text: string
	  }
	| {
			kind: typeof AgentResponseStreamEventKind.ToolStarted
			toolName: string
	  }
	| {
			kind: typeof AgentResponseStreamEventKind.ToolFinished
			toolName: string
			ok: boolean
	  }
	| {
			kind: typeof AgentResponseStreamEventKind.ResponseFinished
	  }
	| {
			kind: typeof AgentResponseStreamEventKind.ResponseFailed
			error: string
	  }

export async function* streamAgentResponse({
	agent,
	input,
}: {
	agent: QueryAgent
	input: QueryAgentAsk
}): AsyncGenerator<AgentResponseStreamEvent, void, void> {
	const splitter = new AgentMessageSplitter()

	function messageEvent(text: string): AgentResponseStreamEvent | null {
		if (text.trim() === "") return null

		return { kind: AgentResponseStreamEventKind.AssistantMessage, text }
	}

	function flushPendingMessage(): AgentResponseStreamEvent | null {
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
				yield {
					kind: AgentResponseStreamEventKind.ConversationStarted,
					conversationId: event.conversationId,
				}
				break

			case "text_delta":
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
				yield {
					kind: AgentResponseStreamEventKind.ToolStarted,
					toolName: event.toolName,
				}
				break

			case "tool_end":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				yield {
					kind: AgentResponseStreamEventKind.ToolFinished,
					toolName: event.toolName,
					ok: event.ok,
				}
				break

			case "error":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				yield {
					kind: AgentResponseStreamEventKind.ResponseFailed,
					error: event.message,
				}
				throw new Error(event.message)

			case "done":
				{
					const item = flushPendingMessage()
					if (item) yield item
				}
				yield { kind: AgentResponseStreamEventKind.ResponseFinished }
				return
		}
	}

	const item = flushPendingMessage()
	if (item) yield item

	yield { kind: AgentResponseStreamEventKind.ResponseFinished }
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
