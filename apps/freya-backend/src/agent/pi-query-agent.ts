import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent"

import {
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent"
import { tmpdir } from "node:os"

import type { QueryAgentToolbox } from "./query-agent-toolbox.ts"
import type { QueryAgent, QueryAgentAsk, QueryAgentEvent } from "./query-agent.ts"

import { InMemoryResourceLoader } from "./in-memory-resource-loader.ts"
import defaultSystemPrompt from "./prompts/system.txt"
import { createFreyaAgentTools, FREYA_AGENT_TOOL_NAMES } from "./tools.ts"

type PiSession = Awaited<ReturnType<typeof createAgentSession>>["session"]
type PiMessageEndEvent = Extract<AgentSessionEvent, { type: "message_end" }>
type PiAgentMessage = PiMessageEndEvent["message"]
type PiAgentEndEvent = Extract<AgentSessionEvent, { type: "agent_end" }>

export interface PiQueryAgentConfig {
	userId: string
	toolbox: QueryAgentToolbox
	apiKey?: string
	cwd?: string
	systemPrompt?: string
}

const MODEL_PROVIDER = "openrouter"
const MODEL_ID = "z-ai/glm-4.7-flash"

export class PiQueryAgent implements QueryAgent {
	private readonly userId: string
	private readonly toolbox: QueryAgentToolbox
	private readonly cwd: string
	private readonly systemPrompt: string
	private readonly apiKey: string | undefined
	private session: PiSession | null = null
	private pendingSession: Promise<PiSession> | null = null
	private activeRun: symbol | null = null
	private disposed = false

	constructor(config: PiQueryAgentConfig) {
		this.userId = config.userId
		this.toolbox = config.toolbox
		this.apiKey = config.apiKey
		this.cwd = config.cwd ?? tmpdir()
		this.systemPrompt = config.systemPrompt ?? defaultSystemPrompt
	}

	async *ask(input: QueryAgentAsk): AsyncIterable<QueryAgentEvent> {
		if (this.activeRun) {
			yield {
				type: "error",
				message: "A query is already running for this user",
			}
			return
		}

		const run = Symbol(this.userId)
		this.activeRun = run

		let session: PiSession
		try {
			session = await this.getOrCreateSession()
		} catch (err) {
			this.clearActiveRun(run)
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
				this.clearActiveRun(run)
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

	dispose(): void {
		this.disposed = true
		this.session?.dispose()
		this.session = null
		this.pendingSession = null
		this.activeRun = null
	}

	private clearActiveRun(run: symbol): void {
		if (this.activeRun === run) {
			this.activeRun = null
		}
	}

	private async getOrCreateSession(): Promise<PiSession> {
		if (this.disposed) {
			throw new Error("Query agent is disposed")
		}

		if (this.session) return this.session

		const pending = this.pendingSession
		if (pending) return pending

		const promise = this.createSession()
		this.pendingSession = promise

		try {
			const session = await promise
			if (this.disposed) {
				session.dispose()
				throw new Error("Query agent is disposed")
			}
			this.session = session
			return session
		} finally {
			if (this.pendingSession === promise) {
				this.pendingSession = null
			}
		}
	}

	private async createSession(): Promise<PiSession> {
		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: true },
			retry: { enabled: true, maxRetries: 2 },
		})
		const authStorage = AuthStorage.inMemory()
		if (this.apiKey) {
			authStorage.setRuntimeApiKey(MODEL_PROVIDER, this.apiKey)
		}

		const modelRegistry = ModelRegistry.inMemory(authStorage)
		const model = modelRegistry.find(MODEL_PROVIDER, MODEL_ID)
		if (!model) {
			throw new Error(`Pi model not found: ${MODEL_PROVIDER}/${MODEL_ID}`)
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
				toolbox: this.toolbox,
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
