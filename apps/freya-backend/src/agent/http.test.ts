import { describe, expect, test } from "bun:test"
import { Hono } from "hono"

import type { QueryDebugTools, QueryDebugToolDefinition } from "./debug-tools.ts"
import type { ProposedAction, QueryAgent, QueryAgentAsk, QueryAgentEvent } from "./query-agent.ts"

import { mockAuthSessionMiddleware } from "../auth/session-middleware.ts"
import { registerAgentHttpHandlers, registerDebugAgentHttpHandlers } from "./http.ts"

const MockUserId = "k7Gx2mPqRvNwYs9TdLfA4bHcJeUo1iZn"

class FakeQueryAgent implements QueryAgent {
	readonly inputs: QueryAgentAsk[] = []
	private readonly events: QueryAgentEvent[]

	constructor(events: QueryAgentEvent[]) {
		this.events = events
	}

	async *ask(input: QueryAgentAsk): AsyncIterable<QueryAgentEvent> {
		this.inputs.push(input)
		for (const event of this.events) {
			yield event
		}
	}

	disposeUser(): void {}

	dispose(): void {}
}

class FakeDebugTools implements QueryDebugTools {
	readonly executions: Array<{ userId: string; toolName: string; params: unknown }> = []
	private readonly tools: QueryDebugToolDefinition[] = [
		{
			name: "freya_test_tool",
			label: "Test Tool",
			description: "A test debug tool.",
			parameters: { query: "string" },
		},
	]

	list(): QueryDebugToolDefinition[] {
		return this.tools
	}

	async execute(userId: string, toolName: string, params: unknown): Promise<unknown> {
		this.executions.push({ userId, toolName, params })
		return { ok: true, userId, toolName, params }
	}
}

function buildTestApp(queryAgent: QueryAgent, userId?: string) {
	const app = new Hono()
	registerAgentHttpHandlers(app, {
		queryAgent,
		authSessionMiddleware: mockAuthSessionMiddleware(userId),
	})
	return app
}

function buildDebugTestApp(userId: string | undefined, debugTools: QueryDebugTools) {
	const app = new Hono()
	registerDebugAgentHttpHandlers(app, {
		authSessionMiddleware: mockAuthSessionMiddleware(userId),
		debugTools,
	})
	return app
}

describe("POST /api/agent", () => {
	test("returns 401 without auth", async () => {
		const app = buildTestApp(new FakeQueryAgent([]))

		const res = await app.request("/api/agent", {
			method: "POST",
			body: JSON.stringify({ message: "hello" }),
		})

		expect(res.status).toBe(401)
	})

	test("collects text deltas and proposed actions", async () => {
		const action: ProposedAction = {
			id: "proposal-1",
			title: "Update commute line",
			description: "Set the user's commute line to Victoria.",
			sourceId: "freya.tfl",
			actionId: "set-lines-of-interest",
			params: ["victoria"],
			requiresConfirmation: true,
			createdAt: "2026-06-12T12:00:00.000Z",
		}
		const agent = new FakeQueryAgent([
			{ type: "text_delta", text: "You should " },
			{ type: "text_delta", text: "leave at 8:30." },
			{ type: "action_proposed", action },
			{ type: "done" },
		])
		const app = buildTestApp(agent, "user-1")

		const res = await app.request("/api/agent", {
			method: "POST",
			body: JSON.stringify({
				message: "What should I do?",
			}),
		})

		expect(res.status).toBe(200)
		expect(agent.inputs).toHaveLength(1)
		expect(agent.inputs[0]!.message).toBe("What should I do?")

		const body = (await res.json()) as {
			message: string
			proposedActions: ProposedAction[]
		}
		expect(body.message).toBe("You should leave at 8:30.")
		expect(body.proposedActions).toEqual([action])
	})

	test("returns 400 for invalid body", async () => {
		const app = buildTestApp(new FakeQueryAgent([]), "user-1")

		const res = await app.request("/api/agent", {
			method: "POST",
			body: JSON.stringify({ feedItemId: "feed-1" }),
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when body includes feedItemId", async () => {
		const app = buildTestApp(new FakeQueryAgent([]), "user-1")

		const res = await app.request("/api/agent", {
			method: "POST",
			body: JSON.stringify({
				message: "What should I do?",
				feedItemId: "feed-1",
			}),
		})

		expect(res.status).toBe(400)
	})

	test("returns 500 when agent reports an error", async () => {
		const app = buildTestApp(
			new FakeQueryAgent([{ type: "error", message: "model unavailable" }]),
			"user-1",
		)

		const res = await app.request("/api/agent", {
			method: "POST",
			body: JSON.stringify({ message: "hello" }),
		})

		expect(res.status).toBe(500)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe("model unavailable")
	})
})

describe("query debug tools", () => {
	test("returns 401 without auth", async () => {
		const app = buildDebugTestApp(undefined, new FakeDebugTools())

		const res = await app.request("/api/agent/tools")

		expect(res.status).toBe(401)
	})

	test("lists debug tools", async () => {
		const app = buildDebugTestApp("user-1", new FakeDebugTools())

		const res = await app.request("/api/agent/tools")

		expect(res.status).toBe(200)
		const body = (await res.json()) as { tools: QueryDebugToolDefinition[] }
		expect(body.tools[0]?.name).toBe("freya_test_tool")
	})

	test("executes debug tools for the authenticated user", async () => {
		const debugTools = new FakeDebugTools()
		const app = buildDebugTestApp("user-1", debugTools)

		const res = await app.request("/api/agent/tools/freya_test_tool", {
			method: "POST",
			body: JSON.stringify({ query: "hello" }),
		})

		expect(res.status).toBe(200)
		expect(debugTools.executions).toEqual([
			{
				userId: MockUserId,
				toolName: "freya_test_tool",
				params: { query: "hello" },
			},
		])

		const body = (await res.json()) as { result: unknown }
		expect(body.result).toEqual({
			ok: true,
			userId: MockUserId,
			toolName: "freya_test_tool",
			params: { query: "hello" },
		})
	})

	test("does not register debug tools in production", async () => {
		await withNodeEnv("production", async () => {
			const app = buildDebugTestApp("user-1", new FakeDebugTools())

			const res = await app.request("/api/agent/tools")

			expect(res.status).toBe(404)
		})
	})
})

async function withNodeEnv<T>(nodeEnv: string | undefined, callback: () => Promise<T>): Promise<T> {
	const previous = process.env.NODE_ENV
	if (nodeEnv === undefined) {
		delete process.env.NODE_ENV
	} else {
		process.env.NODE_ENV = nodeEnv
	}

	try {
		return await callback()
	} finally {
		if (previous === undefined) {
			delete process.env.NODE_ENV
		} else {
			process.env.NODE_ENV = previous
		}
	}
}
