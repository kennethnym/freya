export interface QueryAgentAsk {
	userId: string
	message: string
}

export interface ProposedAction {
	id: string
	title: string
	description: string
	sourceId?: string
	actionId?: string
	params?: unknown
	requiresConfirmation: true
	createdAt: string
}

export type QueryAgentEvent =
	| { type: "text_delta"; text: string }
	| { type: "tool_start"; toolName: string }
	| { type: "tool_end"; toolName: string; ok: boolean }
	| { type: "action_proposed"; action: ProposedAction }
	| { type: "done" }
	| { type: "error"; message: string }

export interface QueryAgent {
	ask(input: QueryAgentAsk): AsyncIterable<QueryAgentEvent>
	disposeUser(userId: string): void
	dispose(): void
}

export interface QueryAgentResponse {
	message: string
	proposedActions: ProposedAction[]
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
	const proposedActions: ProposedAction[] = []

	for await (const event of agent.ask(input)) {
		switch (event.type) {
			case "text_delta":
				message += event.text
				break
			case "action_proposed":
				proposedActions.push(event.action)
				break
			case "error":
				throw new QueryAgentError(event.message)
			case "tool_start":
			case "tool_end":
			case "done":
				break
		}
	}

	return { message, proposedActions }
}
