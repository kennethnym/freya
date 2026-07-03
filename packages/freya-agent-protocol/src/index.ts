import type { ConversationEntry } from "@freya/core"

export const AgentEventKind = {
	ConversationStarted: "conversation_started",
	ConversationEntryCreated: "conversation_entry_created",
	ResponseFinished: "response_finished",
	ResponseFailed: "response_failed",
} as const

export type AgentEventKind = (typeof AgentEventKind)[keyof typeof AgentEventKind]

export interface AgentConversationStartedEvent {
	kind: typeof AgentEventKind.ConversationStarted
	conversationId: string
}

export interface AgentConversationEntryCreatedEvent {
	kind: typeof AgentEventKind.ConversationEntryCreated
	entry: ConversationEntry
}

export interface AgentResponseFinishedEvent {
	kind: typeof AgentEventKind.ResponseFinished
	conversationId: string
}

export interface AgentResponseFailedEvent {
	kind: typeof AgentEventKind.ResponseFailed
	conversationId: string
	error: string
}

export type AgentEvent =
	| AgentConversationStartedEvent
	| AgentConversationEntryCreatedEvent
	| AgentResponseFinishedEvent
	| AgentResponseFailedEvent

export type UserEvent = { type: "typing" }

export interface AgentServerApi {
	sendMessage(message: string): Promise<ConversationEntry>
	notify(event: UserEvent): void
	ping(): "pong"
}

export interface AgentClientApi {
	notify(event: AgentEvent): void
}
