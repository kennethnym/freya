export interface SendMessageResult {
	message: string
	conversationId: string
}

export type AgentEvent =
	| { type: "conversation_started"; conversationId: string }
	| { type: "message_created"; text: string }
	| { type: "tool_started"; toolName: string }
	| { type: "tool_finished"; toolName: string; ok: boolean }
	| { type: "message_finished" }
	| { type: "message_failed"; error: string }

export interface AgentServerApi {
	sendMessage(message: string): Promise<SendMessageResult>
	ping(): "pong"
}

export interface AgentClientApi {
	notify(event: AgentEvent): void
}
