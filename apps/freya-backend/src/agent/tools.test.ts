import { describe, expect, mock, test } from "bun:test"

import type { QueryAgentToolResult, QueryAgentToolbox } from "./query-agent-toolbox.ts"

mock.module("@earendil-works/pi-coding-agent", () => ({
	defineTool(tool: unknown): unknown {
		return tool
	},
}))

interface TestTool {
	name: string
	parameters: unknown
	execute(toolCallId: string, params: unknown): Promise<unknown>
}

describe("FREYA agent tools", () => {
	test("rejects unknown top-level params", async () => {
		const { createFreyaAgentTools, FREYA_GET_CONTEXT_TOOL } = await import("./tools.ts")
		const tool = expectTool(
			createFreyaAgentTools({ toolbox: createStubToolbox() }),
			FREYA_GET_CONTEXT_TOOL,
		)

		await expect(
			tool.execute("tool-call-1", {
				key: ["freya.location"],
				extra: true,
			}),
		).rejects.toThrow("extra")
	})

	test("rejects invalid context keys", async () => {
		const { createFreyaAgentTools, FREYA_GET_CONTEXT_TOOL } = await import("./tools.ts")
		const tool = expectTool(
			createFreyaAgentTools({ toolbox: createStubToolbox() }),
			FREYA_GET_CONTEXT_TOOL,
		)

		await expect(tool.execute("tool-call-1", { key: [] })).rejects.toThrow("key")
		await expect(tool.execute("tool-call-1", { key: [["freya.location"]] })).rejects.toThrow("key")
		await expect(
			tool.execute("tool-call-1", { key: [{ nested: { invalid: true } }] }),
		).rejects.toThrow("nested")
	})

	test("marks tool schemas as closed objects", async () => {
		const { createFreyaAgentTools } = await import("./tools.ts")
		const tools = createFreyaAgentTools({ toolbox: createStubToolbox() })

		for (const tool of tools.map(expectTestTool)) {
			expect(expectRecord(tool.parameters).additionalProperties).toBe(false)
		}
	})
})

function createStubToolbox(): QueryAgentToolbox {
	return {
		async listSources() {
			return toolResult({ sources: [] })
		},
		async getContext(key, match) {
			return toolResult({ key, match })
		},
		async getFeedItem(feedItemId) {
			return toolResult({ feedItemId })
		},
		async queryContext(question, feedItemId) {
			return toolResult({ question, feedItemId })
		},
		async listContext() {
			return toolResult({ entries: [] })
		},
		async getSourceData(sourceId, feedItemId) {
			return toolResult({ sourceId, feedItemId })
		},
		async executeAction(sourceId, actionId, params) {
			return toolResult({ sourceId, actionId, params })
		},
	}
}

function toolResult(result: unknown): QueryAgentToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(result) }],
		details: {},
	}
}

function expectTool(tools: unknown[], name: string): TestTool {
	const tool = tools.map(expectTestTool).find((candidate) => candidate.name === name)
	if (!tool) {
		throw new Error(`Missing test tool: ${name}`)
	}
	return tool
}

function expectTestTool(value: unknown): TestTool {
	const record = expectRecord(value)
	const execute = record.execute
	if (typeof record.name !== "string" || typeof execute !== "function") {
		throw new Error("Expected test tool")
	}
	return {
		name: record.name,
		parameters: record.parameters,
		execute: execute as TestTool["execute"],
	}
}

function expectRecord(value: unknown): Record<string, unknown> {
	expect(typeof value).toBe("object")
	expect(value).not.toBeNull()
	expect(Array.isArray(value)).toBe(false)
	return value as Record<string, unknown>
}
