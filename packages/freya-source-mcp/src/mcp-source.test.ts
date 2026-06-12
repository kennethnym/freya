import { Context, UnknownActionError, contextKey, type ActionDefinition } from "@freya/core"
import { describe, expect, test } from "bun:test"

import type {
	McpCallToolParams,
	McpCallToolResult,
	McpClient,
	McpListToolsParams,
	McpListToolsResult,
	McpReadResourceParams,
	McpReadResourceResult,
	McpTool,
} from "./mcp-client"

import { McpSource } from "./mcp-source"

class FakeMcpClient implements McpClient {
	tools: readonly McpTool[] = []
	readonly resources = new Map<string, McpReadResourceResult>()
	readonly toolResults = new Map<string, McpCallToolResult>()
	readonly listToolParams: Array<McpListToolsParams | undefined> = []
	readonly readResourceParams: McpReadResourceParams[] = []
	readonly callToolParams: McpCallToolParams[] = []

	async listTools(params?: McpListToolsParams): Promise<McpListToolsResult> {
		this.listToolParams.push(params)
		return { tools: this.tools }
	}

	async readResource(params: McpReadResourceParams): Promise<McpReadResourceResult> {
		this.readResourceParams.push(params)
		const result = this.resources.get(params.uri)
		if (!result) {
			throw new Error(`Missing resource: ${params.uri}`)
		}
		return result
	}

	async callTool(params: McpCallToolParams): Promise<McpCallToolResult> {
		this.callToolParams.push(params)
		const result = this.toolResults.get(params.name)
		if (!result) {
			throw new Error(`Missing tool result: ${params.name}`)
		}
		return result
	}
}

describe("McpSource", () => {
	test("reads configured MCP resources into context", async () => {
		const NotificationsKey = contextKey<{ unread: number }>("com.example.mcp", "notifications")
		const client = new FakeMcpClient()
		client.resources.set("mcp://notifications", {
			contents: [
				{
					uri: "mcp://notifications",
					mimeType: "application/json",
					text: JSON.stringify({ unread: 3 }),
				},
			],
		})

		const source = new McpSource({
			id: "com.example.mcp",
			client,
			resources: [
				{
					uri: "mcp://notifications",
					contextKey: NotificationsKey,
				},
			],
		})

		const context = new Context()
		const entries = await source.fetchContext(context)
		context.set(entries ?? [])

		expect(context.get(NotificationsKey)).toEqual({ unread: 3 })
		expect(client.readResourceParams).toEqual([{ uri: "mcp://notifications" }])
	})

	test("calls configured MCP tools into context", async () => {
		const ViewerKey = contextKey<{ name: string }>("com.example.mcp", "viewer")
		const client = new FakeMcpClient()
		client.toolResults.set("viewer", {
			structuredContent: { name: "Kenneth" },
		})

		const source = new McpSource({
			id: "com.example.mcp",
			client,
			contextTools: [
				{
					tool: "viewer",
					contextKey: ViewerKey,
				},
			],
		})

		const context = new Context()
		const entries = await source.fetchContext(context)
		context.set(entries ?? [])

		expect(context.get(ViewerKey)).toEqual({ name: "Kenneth" })
		expect(client.callToolParams).toEqual([{ name: "viewer", arguments: {} }])
	})

	test("projects configured MCP resources into feed items", async () => {
		const client = new FakeMcpClient()
		client.resources.set("mcp://alerts", {
			contents: [
				{
					uri: "mcp://alerts",
					text: JSON.stringify([{ title: "Build failed" }]),
				},
			],
		})

		const source = new McpSource({
			id: "com.example.mcp",
			client,
			feedItems: [
				{
					kind: "resource",
					uri: "mcp://alerts",
					type: "mcp-alerts",
				},
			],
		})

		const context = new Context(new Date("2026-01-01T00:00:00.000Z"))
		const items = await source.fetchItems(context)

		expect(items).toHaveLength(1)
		expect(items[0]).toMatchObject({
			sourceId: "com.example.mcp",
			type: "mcp-alerts",
			timestamp: context.time,
			data: {
				kind: "mcp-resource",
				uri: "mcp://alerts",
				value: [{ title: "Build failed" }],
			},
		})
	})

	test("lists allowlisted MCP tools as Freya actions", async () => {
		const client = new FakeMcpClient()
		client.tools = [
			{
				name: "github.create_issue",
				description: "Create a GitHub issue",
				inputSchema: { type: "object" },
			},
			{
				name: "github.delete_repo",
				description: "Delete a repository",
				inputSchema: { type: "object" },
			},
		]

		const source = new McpSource({
			id: "com.example.github",
			client,
			actions: {
				"create-issue": {
					tool: "github.create_issue",
				},
			},
		})

		const actions = await source.listActions()

		expect(Object.keys(actions)).toEqual(["create-issue"])
		expect(actions["create-issue"]).toMatchObject({
			id: "create-issue",
			description: "Create a GitHub issue",
		})
	})

	test("executes allowlisted MCP tools as Freya actions", async () => {
		const client = new FakeMcpClient()
		client.toolResults.set("github.create_issue", {
			structuredContent: { issueNumber: 42 },
		})

		const source = new McpSource({
			id: "com.example.github",
			client,
			actions: {
				"create-issue": {
					tool: "github.create_issue",
				},
			},
		})

		const result = await source.executeAction("create-issue", { title: "Bug" })

		expect(result).toEqual({ issueNumber: 42 })
		expect(client.callToolParams).toEqual([
			{
				name: "github.create_issue",
				arguments: { title: "Bug" },
			},
		])
	})

	test("validates mapped action input before calling MCP tools", async () => {
		const client = new FakeMcpClient()
		client.toolResults.set("github.create_issue", {
			structuredContent: { issueNumber: 42 },
		})

		const source = new McpSource({
			id: "com.example.github",
			client,
			actions: {
				"create-issue": {
					tool: "github.create_issue",
					input: createIssueInputSchema(),
				},
			},
		})

		await expectRejectedMessage(
			source.executeAction("create-issue", { title: 42 }),
			'Invalid MCP action "create-issue" params: title: Expected string',
		)
		expect(client.callToolParams).toEqual([])
	})

	test("rejects MCP tools that are not allowlisted as actions", async () => {
		const client = new FakeMcpClient()
		client.tools = [
			{
				name: "github.create_issue",
				description: "Create a GitHub issue",
				inputSchema: { type: "object" },
			},
			{
				name: "github.delete_repo",
				description: "Delete a repository",
				inputSchema: { type: "object" },
			},
		]
		client.toolResults.set("github.delete_repo", {
			structuredContent: { deleted: true },
		})

		const source = new McpSource({
			id: "com.example.github",
			client,
			actions: {
				"create-issue": {
					tool: "github.create_issue",
				},
			},
		})

		const actions = await source.listActions()

		expect(Object.keys(actions)).toEqual(["create-issue"])
		await expectUnknownActionError(source.executeAction("github.delete_repo", {}))
		expect(client.callToolParams).toEqual([])
	})

	test("rejects unknown actions", async () => {
		const source = new McpSource({
			id: "com.example.mcp",
			client: new FakeMcpClient(),
			actions: {
				"known-action": {
					tool: "known_tool",
				},
			},
		})

		await expectUnknownActionError(source.executeAction("unknown-action", {}))
	})

	test("requires object params for default action argument mapping", async () => {
		const source = new McpSource({
			id: "com.example.mcp",
			client: new FakeMcpClient(),
			actions: {
				"known-action": {
					tool: "known_tool",
				},
			},
		})

		await expectRejectedMessage(
			source.executeAction("known-action", "bad params"),
			'MCP action "known-action" requires object params',
		)
	})
})

async function expectUnknownActionError(promise: Promise<unknown>): Promise<void> {
	try {
		await promise
	} catch (error) {
		expect(error).toBeInstanceOf(UnknownActionError)
		return
	}

	throw new Error("Expected promise to reject with UnknownActionError")
}

async function expectRejectedMessage(promise: Promise<unknown>, message: string): Promise<void> {
	try {
		await promise
	} catch (error) {
		expect(error).toBeInstanceOf(Error)
		if (error instanceof Error) {
			expect(error.message).toBe(message)
			return
		}
		throw new Error("Expected promise to reject with an Error")
	}

	throw new Error(`Expected promise to reject with message: ${message}`)
}

function createIssueInputSchema(): NonNullable<ActionDefinition["input"]> {
	return {
		"~standard": {
			version: 1,
			vendor: "freya-test",
			validate(value: unknown) {
				if (!isRecord(value)) {
					return {
						issues: [{ message: "Expected object" }],
					}
				}

				if (typeof value.title !== "string") {
					return {
						issues: [{ message: "Expected string", path: ["title"] }],
					}
				}

				return {
					value: {
						title: value.title.trim(),
					},
				}
			},
		},
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}
