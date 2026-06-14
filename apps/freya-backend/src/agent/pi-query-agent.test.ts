import { beforeEach, describe, expect, mock, test } from "bun:test"

import type { UserSessionManager } from "../session/index.ts"
import type { QueryAgentEvent } from "./query-agent.ts"

interface FakePiSession {
	subscribe(listener: (event: unknown) => void): () => void
	prompt(message: string): Promise<void>
	dispose(): void
}

let createAgentSessionCalls = 0
let createAgentSessionOptions: unknown
let promptCalls = 0
let unsubscribeCalls = 0
let sessionListeners: Array<(event: unknown) => void> = []
let promptEvents: unknown[] = []

let sessionCreationStarted: Promise<void>
let resolveSessionCreationStarted: () => void
let sessionCreationReleased: Promise<void>
let releaseSessionCreation: () => void
let promptStarted: Promise<void>
let resolvePromptStarted: () => void
let promptReleased: Promise<void>
let releasePrompt: () => void

const fakeSession: FakePiSession = {
	subscribe(listener: (event: unknown) => void): () => void {
		sessionListeners.push(listener)
		return () => {
			const index = sessionListeners.indexOf(listener)
			if (index >= 0) {
				sessionListeners.splice(index, 1)
			}
			unsubscribeCalls += 1
		}
	},
	async prompt(_message: string): Promise<void> {
		promptCalls += 1
		resolvePromptStarted()
		await promptReleased
		for (const event of promptEvents) {
			for (const listener of sessionListeners) {
				listener(event)
			}
		}
	},
	dispose(): void {},
}

mock.module("@earendil-works/pi-coding-agent", () => ({
	AuthStorage: {
		inMemory() {
			return {
				setRuntimeApiKey(_provider: string, _apiKey: string): void {},
			}
		},
	},
	async createAgentSession(options: unknown) {
		createAgentSessionCalls += 1
		createAgentSessionOptions = options
		resolveSessionCreationStarted()
		await sessionCreationReleased
		return { session: fakeSession }
	},
	createExtensionRuntime() {
		return {}
	},
	defineTool(tool: unknown): unknown {
		return tool
	},
	ModelRegistry: {
		inMemory(_authStorage: unknown) {
			return {
				find(_provider: string, _modelId: string): unknown {
					return { id: "mock-model" }
				},
			}
		},
	},
	SessionManager: {
		inMemory(_cwd: string): unknown {
			return {}
		},
	},
	SettingsManager: {
		inMemory(_settings: unknown): unknown {
			return {}
		},
	},
}))

beforeEach(() => {
	createAgentSessionCalls = 0
	createAgentSessionOptions = undefined
	promptCalls = 0
	unsubscribeCalls = 0
	sessionListeners = []
	promptEvents = []

	resolveSessionCreationStarted = () => {}
	sessionCreationStarted = new Promise((resolve) => {
		resolveSessionCreationStarted = resolve
	})

	releaseSessionCreation = () => {}
	sessionCreationReleased = new Promise((resolve) => {
		releaseSessionCreation = resolve
	})

	resolvePromptStarted = () => {}
	promptStarted = new Promise((resolve) => {
		resolvePromptStarted = resolve
	})

	releasePrompt = () => {}
	promptReleased = new Promise((resolve) => {
		releasePrompt = resolve
	})
})

describe("PiQueryAgent", () => {
	test("rejects a concurrent first query while the Pi session is being created", async () => {
		const { PiQueryAgent } = await import("./pi-query-agent.ts")
		const agent = new PiQueryAgent({
			sessionManager: createStubSessionManager(),
			modelProvider: "mock",
			modelId: "mock-model",
			cwd: "/tmp/freya-pi-query-agent-test",
			systemPrompt: "test",
		})

		const firstEvents = collectEvents(
			agent.ask({
				userId: "user-1",
				message: "first",
			}),
		)

		await sessionCreationStarted

		const secondEvents = await collectEvents(
			agent.ask({
				userId: "user-1",
				message: "second",
			}),
		)

		expect(secondEvents).toEqual([
			{
				type: "error",
				message: "A query is already running for this user",
			},
		])
		expect(createAgentSessionCalls).toBe(1)
		expect(promptCalls).toBe(0)

		releaseSessionCreation()
		await promptStarted
		releasePrompt()

		expect(await firstEvents).toEqual([{ type: "done" }])
		expect(promptCalls).toBe(1)
		expect(unsubscribeCalls).toBe(1)
		if (!isRecord(createAgentSessionOptions)) {
			throw new Error("createAgentSession options were not captured")
		}
		expect("agentDir" in createAgentSessionOptions).toBe(false)
		expect(createAgentSessionOptions.resourceLoader).toBeDefined()

		agent.dispose()
	})

	test("surfaces Pi message_end provider errors instead of done", async () => {
		const { PiQueryAgent } = await import("./pi-query-agent.ts")
		const agent = new PiQueryAgent({
			sessionManager: createStubSessionManager(),
			modelProvider: "mock",
			modelId: "mock-model",
			cwd: "/tmp/freya-pi-query-agent-test",
			systemPrompt: "test",
		})

		promptEvents = [
			{
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "error",
					errorMessage: "Rate limit exceeded",
				},
			},
		]

		const events = collectEvents(
			agent.ask({
				userId: "user-1",
				message: "hello",
			}),
		)

		await sessionCreationStarted
		releaseSessionCreation()
		await promptStarted
		releasePrompt()

		expect(await events).toEqual([{ type: "error", message: "Rate limit exceeded" }])
		expect(unsubscribeCalls).toBe(1)

		agent.dispose()
	})

	test("surfaces Pi agent_end provider errors instead of done", async () => {
		const { PiQueryAgent } = await import("./pi-query-agent.ts")
		const agent = new PiQueryAgent({
			sessionManager: createStubSessionManager(),
			modelProvider: "mock",
			modelId: "mock-model",
			cwd: "/tmp/freya-pi-query-agent-test",
			systemPrompt: "test",
		})

		promptEvents = [
			{
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "Invalid API key",
					},
				],
			},
		]

		const events = collectEvents(
			agent.ask({
				userId: "user-1",
				message: "hello",
			}),
		)

		await sessionCreationStarted
		releaseSessionCreation()
		await promptStarted
		releasePrompt()

		expect(await events).toEqual([{ type: "error", message: "Invalid API key" }])
		expect(unsubscribeCalls).toBe(1)

		agent.dispose()
	})
})

async function collectEvents(events: AsyncIterable<QueryAgentEvent>): Promise<QueryAgentEvent[]> {
	const result: QueryAgentEvent[] = []
	for await (const event of events) {
		result.push(event)
	}
	return result
}

function createStubSessionManager(): UserSessionManager {
	return {
		async getOrCreate(): Promise<never> {
			throw new Error("not used")
		},
	} as unknown as UserSessionManager
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
