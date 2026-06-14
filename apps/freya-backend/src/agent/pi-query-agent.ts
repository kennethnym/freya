import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent"

import {
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent"
import { tmpdir } from "node:os"

import type { UserSessionManager } from "../session/index.ts"
import type { QueryAgent, QueryAgentAsk, QueryAgentEvent } from "./query-agent.ts"

import { InMemoryResourceLoader } from "./in-memory-resource-loader.ts"
import defaultSystemPrompt from "./prompts/system.txt"
import { createFreyaAgentTools, FREYA_AGENT_TOOL_NAMES } from "./tools.ts"

type PiSession = Awaited<ReturnType<typeof createAgentSession>>["session"]
type PiMessageEndEvent = Extract<AgentSessionEvent, { type: "message_end" }>
type PiAgentMessage = PiMessageEndEvent["message"]
type PiAgentEndEvent = Extract<AgentSessionEvent, { type: "agent_end" }>

export interface PiQueryAgentConfig {
	sessionManager: UserSessionManager
	modelProvider: string
	modelId: string
	apiKey?: string
	cwd?: string
	systemPrompt?: string
}

export class PiQueryAgent implements QueryAgent {
	private readonly sessionManager: UserSessionManager
	private readonly cwd: string
	private readonly systemPrompt: string
	private readonly modelProvider: string
	private readonly modelId: string
	private readonly apiKey: string | undefined
	private readonly sessions = new Map<string, PiSession>()
	private readonly pendingSessions = new Map<string, Promise<PiSession>>()
	private readonly activeRuns = new Map<string, symbol>()

	constructor(config: PiQueryAgentConfig) {
		this.sessionManager = config.sessionManager
		this.modelProvider = config.modelProvider
		this.modelId = config.modelId
		this.apiKey = config.apiKey
		this.cwd = config.cwd ?? tmpdir()
		this.systemPrompt = config.systemPrompt ?? defaultSystemPrompt
	}

	async *ask(input: QueryAgentAsk): AsyncIterable<QueryAgentEvent> {
		if (this.activeRuns.has(input.userId)) {
			yield {
				type: "error",
				message: "A query is already running for this user",
			}
			return
		}

		const run = Symbol(input.userId)
		this.activeRuns.set(input.userId, run)

		let session: PiSession
		try {
			session = await this.getOrCreateSession(input.userId)
		} catch (err) {
			this.clearActiveRun(input.userId, run)
			yield {
				type: "error",
				message: `Failed to create query session: ${errorMessage(err)}`,
			}
			return
		}

		const events: QueryAgentEvent[] = []
		let closed = false
		let wake: (() => void) | null = null

		function push(event: QueryAgentEvent): void {
			events.push(event)
			if (wake) {
				wake()
				wake = null
			}
		}

		let runFailed = false
		function pushRunEvent(event: QueryAgentEvent): void {
			if (event.type === "error") {
				if (runFailed) return
				runFailed = true
			}
			push(event)
		}

		function close(): void {
			closed = true
			if (wake) {
				wake()
				wake = null
			}
		}

		const unsubscribe = session.subscribe((event) => {
			this.handlePiEvent(event, pushRunEvent)
		})

		void this.runPrompt(session, input)
			.then(() => {
				if (runFailed) return
				pushRunEvent({ type: "done" })
			})
			.catch((err: unknown) => {
				pushRunEvent({ type: "error", message: errorMessage(err) })
			})
			.finally(() => {
				unsubscribe()
				this.clearActiveRun(input.userId, run)
				close()
			})

		while (!closed || events.length > 0) {
			const next = events.shift()
			if (next) {
				yield next
				continue
			}

			await new Promise<void>((resolve) => {
				wake = resolve
			})
		}
	}

	disposeUser(userId: string): void {
		const session = this.sessions.get(userId)
		session?.dispose()
		this.sessions.delete(userId)
		this.pendingSessions.delete(userId)
		this.activeRuns.delete(userId)
	}

	dispose(): void {
		for (const session of this.sessions.values()) {
			session.dispose()
		}
		this.sessions.clear()
		this.pendingSessions.clear()
		this.activeRuns.clear()
	}

	private clearActiveRun(userId: string, run: symbol): void {
		if (this.activeRuns.get(userId) === run) {
			this.activeRuns.delete(userId)
		}
	}

	private async getOrCreateSession(userId: string): Promise<PiSession> {
		const existing = this.sessions.get(userId)
		if (existing) return existing

		const pending = this.pendingSessions.get(userId)
		if (pending) return pending

		const promise = this.createSession(userId)
		this.pendingSessions.set(userId, promise)

		try {
			const session = await promise
			this.sessions.set(userId, session)
			return session
		} finally {
			this.pendingSessions.delete(userId)
		}
	}

	private async createSession(userId: string): Promise<PiSession> {
		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: true },
			retry: { enabled: true, maxRetries: 2 },
		})
		const authStorage = AuthStorage.inMemory()
		if (this.apiKey) {
			authStorage.setRuntimeApiKey(this.modelProvider, this.apiKey)
		}

		const modelRegistry = ModelRegistry.inMemory(authStorage)
		const model = modelRegistry.find(this.modelProvider, this.modelId)
		if (!model) {
			throw new Error(`Pi model not found: ${this.modelProvider}/${this.modelId}`)
		}

		const { session } = await createAgentSession({
			cwd: this.cwd,
			authStorage,
			modelRegistry,
			model,
			resourceLoader: new InMemoryResourceLoader(this.systemPrompt),
			settingsManager,
			sessionManager: SessionManager.inMemory(this.cwd),
			noTools: "builtin",
			customTools: createFreyaAgentTools({
				userId,
				sessionManager: this.sessionManager,
			}),
			tools: [...FREYA_AGENT_TOOL_NAMES],
		})

		return session
	}

	private async runPrompt(session: PiSession, input: QueryAgentAsk): Promise<void> {
		await session.prompt(input.message)
	}

	private handlePiEvent(event: AgentSessionEvent, push: (event: QueryAgentEvent) => void): void {
		switch (event.type) {
			case "message_end": {
				const message = piAssistantMessageError(event.message)
				if (message) {
					push({ type: "error", message })
				}
				break
			}

			case "agent_end": {
				const message = piAgentEndError(event)
				if (message) {
					push({ type: "error", message })
				}
				break
			}

			case "message_update": {
				const assistantMessageEvent = event.assistantMessageEvent
				if (assistantMessageEvent.type === "text_delta") {
					push({ type: "text_delta", text: assistantMessageEvent.delta })
				}
				break
			}

			case "tool_execution_start":
				push({ type: "tool_start", toolName: event.toolName })
				break

			case "tool_execution_end":
				push({
					type: "tool_end",
					toolName: event.toolName,
					ok: event.isError !== true,
				})
				break
		}
	}
}

function piAgentEndError(event: PiAgentEndEvent): string | null {
	const messages = event.messages

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const agentMessage = messages[index]
		if (!agentMessage) continue

		const message = piAssistantMessageError(agentMessage)
		if (message) return message
	}

	return null
}

function piAssistantMessageError(message: PiAgentMessage): string | null {
	switch (message.role) {
		case "assistant":
			switch (message.stopReason) {
				case "error":
					return message.errorMessage || "Provider request failed"
				case "aborted":
					return message.errorMessage || "Provider request was aborted"
				case "length":
				case "stop":
				case "toolUse":
					return null
			}
			return null
		default:
			return null
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
