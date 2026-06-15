export interface QueryAgentAsk {
	message: string
}

export type QueryAgentEvent =
	| { type: "text_delta"; text: string }
	| { type: "tool_start"; toolName: string }
	| { type: "tool_end"; toolName: string; ok: boolean }
	| { type: "done" }
	| { type: "error"; message: string }

export interface QueryAgent {
	ask(input: QueryAgentAsk): AsyncIterable<QueryAgentEvent>
	dispose(): void
}

export interface QueryAgentResponse {
	message: string
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

	for await (const event of agent.ask(input)) {
		switch (event.type) {
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

	return { message }
}
