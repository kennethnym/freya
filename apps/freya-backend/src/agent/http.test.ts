import { describe, expect, test } from "bun:test"
import { Hono } from "hono"

import type { QueryDebugTools, QueryDebugToolDefinition } from "./debug-tools.ts"

import { mockAuthSessionMiddleware } from "../auth/session-middleware.ts"
import { registerDebugAgentHttpHandlers } from "./http.ts"

const MockUserId = "k7Gx2mPqRvNwYs9TdLfA4bHcJeUo1iZn"

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

function buildDebugTestApp(userId: string | undefined, debugTools: QueryDebugTools) {
	const app = new Hono()
	registerDebugAgentHttpHandlers(app, {
		authSessionMiddleware: mockAuthSessionMiddleware(userId),
		debugTools,
	})
	return app
}

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
