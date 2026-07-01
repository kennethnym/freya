export interface QueryAgentAsk {
	message: string
	conversationId?: string
	userMessageEntry?: QueryAgentConversationEntryRef
	signal?: AbortSignal
}

export type QueryAgentStreamEvent =
	| { type: "conversation"; conversationId: string }
	| { type: "text_delta"; text: string }
	| { type: "tool_start"; toolName: string }
	| { type: "tool_end"; toolName: string; ok: boolean }
	| { type: "done" }
	| { type: "error"; message: string }

export const QueryAgentEvent = {
	Compaction: "compaction",
} as const

export type QueryAgentEvent = (typeof QueryAgentEvent)[keyof typeof QueryAgentEvent]

export interface QueryAgentConversationEntryRef {
	id: string
	sequence: number
}

export interface QueryAgentCompactedEntryRange {
	startSequence: number
	endSequence: number
}

export interface QueryAgentCompactionEvent {
	type: typeof QueryAgentEvent.Compaction
	conversationId: string
	summary: string
	firstKeptEntryId: string
	compactedEntryRange: QueryAgentCompactedEntryRange | null
	tokensBefore: number
	details?: unknown
	fromExtension: boolean
}

export interface QueryAgentEventMap {
	[QueryAgentEvent.Compaction]: QueryAgentCompactionEvent
}

export type QueryAgentEventListener<T extends QueryAgentEvent> = (
	event: QueryAgentEventMap[T],
) => void | Promise<void>

export type QueryAgentEventListeners = {
	[T in QueryAgentEvent]: Set<QueryAgentEventListener<T>>
}

export function createQueryAgentEventListeners(): QueryAgentEventListeners {
	return {
		[QueryAgentEvent.Compaction]: new Set(),
	}
}

export interface QueryAgent {
	ask(input: QueryAgentAsk): AsyncIterable<QueryAgentStreamEvent>
	addEventListener<T extends QueryAgentEvent>(
		type: T,
		listener: QueryAgentEventListener<T>,
	): () => void
	dispose(): void
}

export interface QueryAgentResponse {
	message: string
	conversationId?: string
}

export class QueryAgentError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "QueryAgentError"
	}
}

export async function collectQueryAgentResponse(
	agent: QueryAgent,
	input: QueryAgentAsk,
): Promise<QueryAgentResponse> {
	let message = ""
	let conversationId: string | undefined

	for await (const event of agent.ask(input)) {
		switch (event.type) {
			case "conversation":
				conversationId = event.conversationId
				break
			case "text_delta":
				message += event.text
				break
			case "error":
				throw new QueryAgentError(event.message)
			case "tool_start":
			case "tool_end":
			case "done":
				break
		}
	}

	return { message, conversationId }
}
