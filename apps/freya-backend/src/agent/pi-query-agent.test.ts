import { ConversationEntryKind } from "@freya/core"
import { beforeEach, describe, expect, mock, test } from "bun:test"

import type { QueryAgentToolbox } from "./query-agent-toolbox.ts"
import type { QueryAgentStreamEvent } from "./query-agent.ts"

import { QueryAgentEvent } from "./query-agent.ts"

interface FakePiSession {
	subscribe(listener: (event: unknown) => void): () => void
	prompt(message: string): Promise<void>
	dispose(): void
}

type CapturedExtensionHandler = (event: unknown) => Promise<unknown> | unknown

interface CapturedExtensionApi {
	on(event: string, handler: CapturedExtensionHandler): void
}

type CapturedExtensionFactory = (pi: CapturedExtensionApi) => Promise<void> | void

interface CapturedExtension {
	handlers: Map<string, CapturedExtensionHandler[]>
}

interface CapturedResourceLoader {
	getExtensions(): unknown
}

interface CapturedDefaultResourceLoaderOptions {
	extensionFactories?: CapturedExtensionFactory[]
}

class FakeDefaultResourceLoader implements CapturedResourceLoader {
	private readonly extensionFactories: CapturedExtensionFactory[]
	private extensionsResult: { extensions: CapturedExtension[] }

	constructor(options: unknown) {
		this.extensionFactories = isDefaultResourceLoaderOptions(options)
			? (options.extensionFactories ?? [])
			: []
		this.extensionsResult = { extensions: [] }
	}

	async reload(): Promise<void> {
		const handlers: CapturedExtension["handlers"] = new Map()
		const api: CapturedExtensionApi = {
			on(event: string, handler: CapturedExtensionHandler): void {
				const existing = handlers.get(event) ?? []
				existing.push(handler)
				handlers.set(event, existing)
			},
		}

		for (const factory of this.extensionFactories) {
			await factory(api)
		}

		this.extensionsResult = {
			extensions: [{ handlers }],
		}
	}

	getExtensions(): unknown {
		return this.extensionsResult
	}
}

let createAgentSessionCalls = 0
let createAgentSessionOptions: unknown
let runtimeApiKeyCalls: Array<{ provider: string; apiKey: string }> = []
let modelFindCalls: Array<{ provider: string; modelId: string }> = []
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

class FakeSessionManager {
	private messages: unknown[] = []
	private compaction: { summary: string; tokensBefore: number; timestamp: number } | null = null

	appendMessage(message: unknown): string {
		this.messages.push(message)
		return `message-${this.messages.length}`
	}

	appendCompaction(summary: string, _firstKeptEntryId: string, tokensBefore: number): string {
		this.compaction = {
			summary,
			tokensBefore,
			timestamp: Date.now(),
		}
		this.messages = []
		return "compaction-1"
	}

	buildSessionContext(): unknown {
		const messages = [...this.messages]
		if (this.compaction) {
			messages.unshift({
				role: "compactionSummary",
				summary: this.compaction.summary,
				tokensBefore: this.compaction.tokensBefore,
				timestamp: this.compaction.timestamp,
			})
		}

		return {
			messages,
			thinkingLevel: "off",
			model: modelFromMessages(messages),
		}
	}
}

mock.module("@earendil-works/pi-coding-agent", () => ({
	AuthStorage: {
		inMemory() {
			return {
				setRuntimeApiKey(provider: string, apiKey: string): void {
					runtimeApiKeyCalls.push({ provider, apiKey })
				},
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
	DefaultResourceLoader: FakeDefaultResourceLoader,
	defineTool(tool: unknown): unknown {
		return tool
	},
	ModelRegistry: {
		inMemory(_authStorage: unknown) {
			return {
				find(provider: string, modelId: string): unknown {
					modelFindCalls.push({ provider, modelId })
					return { id: "mock-model" }
				},
			}
		},
	},
	SessionManager: {
		inMemory(_cwd: string): unknown {
			return new FakeSessionManager()
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
	runtimeApiKeyCalls = []
	modelFindCalls = []
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
			toolbox: createStubToolbox(),
			apiKey: "test-api-key",
			cwd: "/tmp/freya-pi-query-agent-test",
			systemPrompt: "test",
		})

		const firstEvents = collectEvents(
			agent.ask({
				message: "first",
			}),
		)

		await sessionCreationStarted

		const secondEvents = await collectEvents(
			agent.ask({
				message: "second",
			}),
		)

		expect(secondEvents).toEqual([
			{
				type: "error",
				message: "A query is already running",
			},
		])
		expect(createAgentSessionCalls).toBe(1)
		expect(runtimeApiKeyCalls).toEqual([{ provider: "openrouter", apiKey: "test-api-key" }])
		expect(modelFindCalls).toEqual([{ provider: "openrouter", modelId: "z-ai/glm-4.7-flash" }])
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
		expect(typeof sessionCompactHandlerFromCapturedOptions()).toBe("function")

		agent.dispose()
	})

	test("hydrates initial entries into the Pi session manager", async () => {
		const { PiQueryAgent } = await import("./pi-query-agent.ts")
		const agent = new PiQueryAgent({
			toolbox: createStubToolbox(),
			cwd: "/tmp/freya-pi-query-agent-test",
			systemPrompt: "test",
			initialEntries: [
				{
					id: "entry-1",
					sequence: 1,
					kind: ConversationEntryKind.UserMessage,
					payload: {
						role: "user",
						parts: [{ type: "text", text: "stored hello" }],
					},
					metadata: {},
					createdAt: new Date("2026-06-15T00:00:00.000Z"),
				},
				{
					id: "entry-2",
					sequence: 2,
					kind: ConversationEntryKind.AssistantMessage,
					payload: {
						role: "assistant",
						parts: [{ type: "text", text: "stored reply" }],
					},
					metadata: {},
					createdAt: new Date("2026-06-15T00:00:01.000Z"),
				},
			],
		})

		const events = collectEvents(
			agent.ask({
				message: "hello",
			}),
		)

		await sessionCreationStarted
		if (!isRecord(createAgentSessionOptions)) {
			throw new Error("createAgentSession options were not captured")
		}
		const sessionManager = createAgentSessionOptions.sessionManager
		if (!(sessionManager instanceof FakeSessionManager)) {
			throw new Error("session manager was not hydrated by PiQueryAgent")
		}
		const context = sessionManager.buildSessionContext()
		if (!isRecord(context) || !Array.isArray(context.messages)) {
			throw new Error("session context messages were not captured")
		}
		expect(context.messages[0]).toEqual({
			role: "user",
			content: "stored hello",
			timestamp: new Date("2026-06-15T00:00:00.000Z").getTime(),
		})
		expect(context.messages[1]).toMatchObject({
			role: "assistant",
			provider: "openrouter",
			model: "z-ai/glm-4.7-flash",
			stopReason: "stop",
			timestamp: new Date("2026-06-15T00:00:01.000Z").getTime(),
		})

		releaseSessionCreation()
		await promptStarted
		releasePrompt()

		expect(await events).toEqual([{ type: "done" }])

		agent.dispose()
	})

	test("emits Pi compaction events for the active conversation", async () => {
		const recordedCompactions: unknown[] = []
		const { PiQueryAgent } = await import("./pi-query-agent.ts")
		const agent = new PiQueryAgent({
			toolbox: createStubToolbox(),
			cwd: "/tmp/freya-pi-query-agent-test",
			systemPrompt: "test",
		})
		agent.addEventListener(QueryAgentEvent.Compaction, (event) => {
			recordedCompactions.push(event)
		})

		const events = collectEvents(
			agent.ask({
				conversationId: "conversation-1",
				message: "hello",
			}),
		)

		await sessionCreationStarted
		releaseSessionCreation()
		await promptStarted

		const handler = sessionCompactHandlerFromCapturedOptions()
		await handler({
			type: "session_compact",
			fromExtension: false,
			compactionEntry: {
				type: "compaction",
				id: "pi-compaction-1",
				timestamp: "2026-06-15T00:00:00.000Z",
				summary: "The user prefers concise updates.",
				firstKeptEntryId: "pi-entry-7",
				tokensBefore: 1234,
				details: { reason: "threshold" },
			},
		})

		expect(recordedCompactions).toEqual([
			{
				type: QueryAgentEvent.Compaction,
				conversationId: "conversation-1",
				summary: "The user prefers concise updates.",
				firstKeptEntryId: "pi-entry-7",
				compactedEntryRange: null,
				tokensBefore: 1234,
				details: { reason: "threshold" },
				fromExtension: false,
			},
		])

		releasePrompt()

		expect(await events).toEqual([{ type: "done" }])
		expect(unsubscribeCalls).toBe(1)

		agent.dispose()
	})

	test("emits Freya coverage through the entry before Pi's kept boundary", async () => {
		const recordedCompactions: unknown[] = []
		const { PiQueryAgent } = await import("./pi-query-agent.ts")
		const agent = new PiQueryAgent({
			toolbox: createStubToolbox(),
			cwd: "/tmp/freya-pi-query-agent-test",
			systemPrompt: "test",
			initialEntries: [
				{
					id: "entry-1",
					sequence: 1,
					kind: ConversationEntryKind.UserMessage,
					payload: {
						role: "user",
						parts: [{ type: "text", text: "old hello" }],
					},
					metadata: {},
					createdAt: new Date("2026-06-15T00:00:00.000Z"),
				},
				{
					id: "entry-2",
					sequence: 2,
					kind: ConversationEntryKind.AssistantMessage,
					payload: {
						role: "assistant",
						parts: [{ type: "text", text: "kept reply" }],
					},
					metadata: {},
					createdAt: new Date("2026-06-15T00:00:01.000Z"),
				},
			],
		})
		agent.addEventListener(QueryAgentEvent.Compaction, (event) => {
			recordedCompactions.push(event)
		})

		const events = collectEvents(
			agent.ask({
				conversationId: "conversation-1",
				message: "hello",
			}),
		)

		await sessionCreationStarted

		await extensionHandlerFromCapturedOptions("session_before_compact")({
			type: "session_before_compact",
			preparation: {
				firstKeptEntryId: "message-2",
			},
			branchEntries: [{ id: "message-1" }, { id: "message-2" }],
		})
		await extensionHandlerFromCapturedOptions("session_compact")({
			type: "session_compact",
			fromExtension: false,
			compactionEntry: {
				type: "compaction",
				id: "pi-compaction-1",
				timestamp: "2026-06-15T00:00:00.000Z",
				summary: "Old hello was discussed.",
				firstKeptEntryId: "message-2",
				tokensBefore: 1234,
			},
		})

		expect(recordedCompactions).toEqual([
			{
				type: QueryAgentEvent.Compaction,
				conversationId: "conversation-1",
				summary: "Old hello was discussed.",
				firstKeptEntryId: "message-2",
				compactedEntryRange: {
					startSequence: 1,
					endSequence: 1,
				},
				tokensBefore: 1234,
				details: undefined,
				fromExtension: false,
			},
		])

		releaseSessionCreation()
		await promptStarted
		releasePrompt()

		expect(await events).toEqual([{ type: "done" }])

		agent.dispose()
	})

	test("surfaces Pi message_end provider errors instead of done", async () => {
		const { PiQueryAgent } = await import("./pi-query-agent.ts")
		const agent = new PiQueryAgent({
			toolbox: createStubToolbox(),
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
			toolbox: createStubToolbox(),
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

async function collectEvents(
	events: AsyncIterable<QueryAgentStreamEvent>,
): Promise<QueryAgentStreamEvent[]> {
	const result: QueryAgentStreamEvent[] = []
	for await (const event of events) {
		result.push(event)
	}
	return result
}

function createStubToolbox(): QueryAgentToolbox {
	return {
		async listSources(): Promise<never> {
			throw new Error("not used")
		},
		async getContext(): Promise<never> {
			throw new Error("not used")
		},
		async getFeedItem(): Promise<never> {
			throw new Error("not used")
		},
		async queryContext(): Promise<never> {
			throw new Error("not used")
		},
		async listContext(): Promise<never> {
			throw new Error("not used")
		},
		async getSourceData(): Promise<never> {
			throw new Error("not used")
		},
		async executeAction(): Promise<never> {
			throw new Error("not used")
		},
	}
}

function sessionCompactHandlerFromCapturedOptions(): CapturedExtensionHandler {
	return extensionHandlerFromCapturedOptions("session_compact")
}

function extensionHandlerFromCapturedOptions(eventName: string): CapturedExtensionHandler {
	if (!isRecord(createAgentSessionOptions)) {
		throw new Error("createAgentSession options were not captured")
	}

	const resourceLoader = createAgentSessionOptions.resourceLoader
	if (!isCapturedResourceLoader(resourceLoader)) {
		throw new Error("resourceLoader was not captured")
	}

	const extensionsResult = resourceLoader.getExtensions()
	if (!isRecord(extensionsResult) || !Array.isArray(extensionsResult.extensions)) {
		throw new Error("extensions were not captured")
	}

	const extension = extensionsResult.extensions[0]
	if (!isCapturedExtension(extension)) {
		throw new Error("compaction extension was not captured")
	}

	const handlers = extension.handlers.get(eventName)
	const handler = handlers?.[0]
	if (!handler) {
		throw new Error(`${eventName} handler was not captured`)
	}

	return handler
}

function isCapturedResourceLoader(value: unknown): value is CapturedResourceLoader {
	return isRecord(value) && typeof value.getExtensions === "function"
}

function isCapturedExtension(value: unknown): value is CapturedExtension {
	return isRecord(value) && value.handlers instanceof Map
}

function isDefaultResourceLoaderOptions(
	value: unknown,
): value is CapturedDefaultResourceLoaderOptions {
	return (
		isRecord(value) &&
		(value.extensionFactories === undefined ||
			(Array.isArray(value.extensionFactories) &&
				value.extensionFactories.every(isCapturedExtensionFactory)))
	)
}

function isCapturedExtensionFactory(value: unknown): value is CapturedExtensionFactory {
	return typeof value === "function"
}

function modelFromMessages(messages: unknown[]): { provider: string; modelId: string } | null {
	let model: { provider: string; modelId: string } | null = null

	for (const message of messages) {
		if (!isRecord(message)) continue
		if (message.role !== "assistant") continue
		if (typeof message.provider !== "string" || typeof message.model !== "string") continue

		model = {
			provider: message.provider,
			modelId: message.model,
		}
	}

	return model
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
