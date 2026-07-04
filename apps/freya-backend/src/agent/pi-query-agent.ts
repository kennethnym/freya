import type {
	AgentSessionEvent,
	ExtensionFactory,
	SessionEntry,
} from "@earendil-works/pi-coding-agent"

import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SettingsManager,
} from "@earendil-works/pi-coding-agent"
import { tmpdir } from "node:os"

import type { ConversationStorageEntry } from "./conversation-recording-query-agent.ts"
import type { QueryAgentToolbox } from "./query-agent-toolbox.ts"

import defaultSystemPrompt from "./prompts/system.txt"
import {
	createQueryAgentEventListeners,
	QueryAgentEvent,
	type QueryAgent,
	type QueryAgentAsk,
	type QueryAgentCompactedEntryRange,
	type QueryAgentCompactionEvent,
	type QueryAgentConversationEntryRef,
	type QueryAgentEventListeners,
	type QueryAgentEventListener,
	type QueryAgentEventMap,
	type QueryAgentStreamEvent,
} from "./query-agent.ts"
import { createSessionManager } from "./session-manager.ts"
import { createFreyaAgentTools, FREYA_AGENT_TOOL_NAMES } from "./tools.ts"

/** Active Pi SDK session instance returned by createAgentSession. */
type PiSession = Awaited<ReturnType<typeof createAgentSession>>["session"]

/** Pi event emitted when a message finishes. */
type PiMessageEndEvent = Extract<AgentSessionEvent, { type: "message_end" }>

/** Message payload carried by Pi's message-end event. */
type PiAgentMessage = PiMessageEndEvent["message"]

/** Pi event emitted when an agent run finishes. */
type PiAgentEndEvent = Extract<AgentSessionEvent, { type: "agent_end" }>

/** Session manager created for Pi conversation replay. */
type PiSessionManager = ReturnType<typeof createSessionManager>

/** Message shape accepted by the replay session manager. */
type PiSessionMessage = Parameters<PiSessionManager["appendMessage"]>[0]

/** Configuration for the Pi-backed query agent. */
export interface PiQueryAgentConfig {
	toolbox: QueryAgentToolbox
	apiKey?: string
	cwd?: string
	systemPrompt?: string
	initialEntries?: ConversationStorageEntry[]
}

export const PI_MODEL_PROVIDER = "openrouter"
export const PI_MODEL_ID = "z-ai/glm-4.7-flash"

export class PiQueryAgent implements QueryAgent {
	private readonly toolbox: QueryAgentToolbox
	private readonly cwd: string
	private readonly systemPrompt: string
	private readonly apiKey: string | undefined
	private readonly initialEntries: ConversationStorageEntry[]
	private readonly eventListeners = createQueryAgentEventListeners()
	private session: PiSession | null = null
	private pendingSession: Promise<PiSession> | null = null
	/**
	 * Conversation currently receiving Pi events for an active ask().
	 *
	 * Pi's compaction hook fires from the SDK session rather than from our
	 * QueryAgent call stack, so the hook reads this value to attach the
	 * compaction summary to the right Freya conversation. null means no active
	 * run; "" means a run is active but no Freya conversation id was supplied.
	 */
	private activeConversationId: string | null = null
	/**
	 * Freya entry for the user message currently being handed to Pi.
	 *
	 * ConversationRecordingQueryAgent appends the user message before calling
	 * PiQueryAgent. Pi later persists its own copy of that user message into its
	 * SessionManager, and this one-shot reference lets us map Pi's generated
	 * session entry id back to the Freya sequence.
	 */
	private activeUserMessageEntry: QueryAgentConversationEntryRef | null = null
	/**
	 * Maps Pi SessionManager entry ids to Freya conversation sequences.
	 *
	 * Pi compaction reports boundaries with Pi entry ids, while our DB replay
	 * logic uses monotonically increasing Freya sequences. This map is the bridge
	 * that lets us translate Pi's firstKeptEntryId into a compacted entry range.
	 */
	private readonly piEntryConversationSequences = new Map<string, number>()
	private disposed = false

	constructor(config: PiQueryAgentConfig) {
		this.toolbox = config.toolbox
		this.apiKey = config.apiKey
		this.cwd = config.cwd ?? tmpdir()
		this.systemPrompt = config.systemPrompt ?? defaultSystemPrompt
		this.initialEntries = config.initialEntries ?? []
	}

	async *ask(input: QueryAgentAsk): AsyncIterable<QueryAgentStreamEvent> {
		if (this.activeConversationId !== null) {
			yield {
				type: "error",
				message: "A query is already running",
			}
			return
		}

		this.activeConversationId = input.conversationId ?? ""
		this.activeUserMessageEntry = input.userMessageEntry ?? null

		let session: PiSession
		try {
			session = await this.getOrCreateSession()
		} catch (err) {
			this.activeConversationId = null
			this.activeUserMessageEntry = null
			yield {
				type: "error",
				message: `Failed to create query session: ${errorMessage(err)}`,
			}
			return
		}

		const events: QueryAgentStreamEvent[] = []
		let closed = false
		let wake: (() => void) | null = null

		function push(event: QueryAgentStreamEvent): void {
			events.push(event)
			if (wake) {
				wake()
				wake = null
			}
		}

		let runFailed = false
		function pushRunEvent(event: QueryAgentStreamEvent): void {
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

		input.signal?.addEventListener(
			"abort",
			async () => {
				await session.abort()
				close()
				unsubscribe()
			},
			{ once: true },
		)

		session
			.prompt(input.message)
			.then(() => {
				if (runFailed) return
				pushRunEvent({ type: "done" })
			})
			.catch((err: unknown) => {
				pushRunEvent({ type: "error", message: errorMessage(err) })
			})
			.finally(() => {
				unsubscribe()
				this.activeConversationId = null
				this.activeUserMessageEntry = null
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
		this.activeConversationId = null
		this.activeUserMessageEntry = null
		this.clearEventListeners()
	}

	addEventListener<T extends QueryAgentEvent>(
		type: T,
		listener: QueryAgentEventListener<T>,
	): () => void {
		const listeners = this.listenersFor(type)
		listeners.add(listener)
		return () => {
			listeners.delete(listener)
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
			authStorage.setRuntimeApiKey(PI_MODEL_PROVIDER, this.apiKey)
		}

		const modelRegistry = ModelRegistry.inMemory(authStorage)
		const model = modelRegistry.find(PI_MODEL_PROVIDER, PI_MODEL_ID)
		if (!model) {
			throw new Error(`Pi model not found: ${PI_MODEL_PROVIDER}/${PI_MODEL_ID}`)
		}

		const resourceLoader = new DefaultResourceLoader({
			cwd: this.cwd,
			agentDir: this.cwd,
			settingsManager,
			systemPrompt: this.systemPrompt,
			extensionFactories: [this.createCompactionExtension()],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		})
		await resourceLoader.reload()

		const sessionManager = this.createMappedSessionManager()

		const { session } = await createAgentSession({
			cwd: this.cwd,
			authStorage,
			modelRegistry,
			model,
			resourceLoader,
			settingsManager,
			sessionManager,
			noTools: "builtin",
			customTools: createFreyaAgentTools({
				toolbox: this.toolbox,
			}),
			tools: FREYA_AGENT_TOOL_NAMES,
		})

		return session
	}

	/**
	 * Creates Pi's SessionManager and records Pi-id -> Freya-sequence mappings.
	 *
	 * Hydrated DB messages are mapped through createSessionManager's callback.
	 * Live user messages are mapped by wrapping appendMessage(), because Pi owns
	 * the generated session entry id for messages written during prompt handling.
	 */
	private createMappedSessionManager(): PiSessionManager {
		this.piEntryConversationSequences.clear()
		const sessionManager = createSessionManager({
			cwd: this.cwd,
			entries: this.initialEntries,
			modelProvider: PI_MODEL_PROVIDER,
			modelId: PI_MODEL_ID,
			onMessageEntryAppended: (piEntryId, entry) => {
				this.piEntryConversationSequences.set(piEntryId, entry.sequence)
			},
		})
		const appendMessage = sessionManager.appendMessage.bind(sessionManager)

		sessionManager.appendMessage = (message: PiSessionMessage): string => {
			const piEntryId = appendMessage(message)
			const sequence = this.liveConversationSequenceForMessage(message)
			if (sequence !== null) {
				this.piEntryConversationSequences.set(piEntryId, sequence)
			}
			return piEntryId
		}

		return sessionManager
	}

	/**
	 * Returns the Freya sequence for Pi's persisted live user message.
	 *
	 * We only map user messages here because they are the messages Freya writes
	 * before invoking Pi. Assistant/tool entries are recorded from the stream
	 * outside Pi's SessionManager and do not have a stable live Pi id available
	 * at the storage boundary.
	 */
	private liveConversationSequenceForMessage(message: PiSessionMessage): number | null {
		if (message.role !== "user") return null

		const entry = this.activeUserMessageEntry
		this.activeUserMessageEntry = null
		if (!entry) return null

		return entry.sequence
	}

	/**
	 * Installs the minimal Pi extension used to observe compaction.
	 *
	 * session_before_compact gives us the full branch plus firstKeptEntryId, so
	 * we translate that boundary before Pi writes the compaction entry. The later
	 * session_compact event carries the saved summary, which we forward with the
	 * cached Freya compacted entry range.
	 */
	private createCompactionExtension(): ExtensionFactory {
		return (pi) => {
			/**
			 * Temporary handoff between Pi's before/after compaction hooks.
			 *
			 * session_compact receives the saved compaction entry, not the original
			 * branch entries needed for boundary translation.
			 */
			let pendingCompactedEntryRange: QueryAgentCompactedEntryRange | null = null

			pi.on("session_before_compact", async (event) => {
				pendingCompactedEntryRange = this.compactedEntryRangeBeforePiEntry(
					event.branchEntries,
					event.preparation.firstKeptEntryId,
				)
			})

			pi.on("session_compact", async (event) => {
				const conversationId = this.activeConversationId
				if (!conversationId) return

				const entry = event.compactionEntry
				const compactedEntryRange = pendingCompactedEntryRange
				pendingCompactedEntryRange = null
				const compactionEvent: QueryAgentCompactionEvent = {
					type: QueryAgentEvent.Compaction,
					conversationId,
					summary: entry.summary,
					firstKeptEntryId: entry.firstKeptEntryId,
					compactedEntryRange,
					tokensBefore: entry.tokensBefore,
					details: entry.details,
					fromExtension: event.fromExtension,
				}

				await this.emitEvent(compactionEvent)
			})
		}
	}

	/**
	 * Returns the Freya entry range compacted before a Pi session entry.
	 *
	 * Pi keeps firstKeptEntryId and everything after it as raw context. Therefore
	 * the summary covers only mapped entries before that Pi entry. If none of
	 * those entries map back to Freya, we return null so storage can avoid
	 * recording a summary with an unsafe coverage range.
	 */
	private compactedEntryRangeBeforePiEntry(
		branchEntries: SessionEntry[],
		piEntryId: string,
	): QueryAgentCompactedEntryRange | null {
		let endSequence: number | null = null
		for (const entry of branchEntries) {
			if (entry.id === piEntryId) {
				if (endSequence === null) return null

				return {
					startSequence: 1,
					endSequence,
				}
			}

			const sequence = this.piEntryConversationSequences.get(entry.id)
			if (typeof sequence === "number") {
				endSequence = sequence
			}
		}

		return null
	}

	private async emitEvent<T extends QueryAgentEvent>(event: QueryAgentEventMap[T]): Promise<void> {
		const listeners = this.listenersFor(event.type)
		for (const listener of listeners) {
			await listener(event)
		}
	}

	private listenersFor<T extends QueryAgentEvent>(type: T): QueryAgentEventListeners[T] {
		return this.eventListeners[type]
	}

	private clearEventListeners(): void {
		for (const listeners of Object.values(this.eventListeners)) {
			listeners.clear()
		}
	}

	private handlePiEvent(
		event: AgentSessionEvent,
		push: (event: QueryAgentStreamEvent) => void,
	): void {
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
		default:
			return null
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
