export type AgentEvent =
	| { type: "conversation_started"; conversationId: string }
	| { type: "message_created"; text: string }
	| { type: "tool_started"; toolName: string }
	| { type: "tool_finished"; toolName: string; ok: boolean }
	| { type: "message_finished" }
	| { type: "message_failed"; error: string }

export type UserEvent = { type: "typing" }

export interface AgentServerApi {
	sendMessage(message: string): Promise<boolean>
	notify(event: UserEvent): void
	ping(): "pong"
}

export interface AgentClientApi {
	notify(event: AgentEvent): void
}
