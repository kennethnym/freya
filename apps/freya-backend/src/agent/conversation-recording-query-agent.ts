import type { ConversationEntryMetadata } from "@freya/core"

import { ConversationEntryKind } from "@freya/core"
import { randomUUID } from "node:crypto"

import type {
	AppendConversationEntryInput,
	ConversationEntryRow,
} from "../conversations/storage.ts"

import {
	createQueryAgentEventListeners,
	QueryAgentEvent,
	type QueryAgent,
	type QueryAgentAsk,
	type QueryAgentCompactionEvent,
	type QueryAgentEventListeners,
	type QueryAgentEventListener,
	type QueryAgentEventMap,
	type QueryAgentStreamEvent,
} from "./query-agent.ts"

/** Storage operations used to persist and replay query-agent conversation entries. */
export interface ConversationStorage {
	getOrCreateConversation(): Promise<{ id: string }>
	appendEntry(
		conversationId: string,
		input: AppendConversationEntryInput,
	): Promise<ConversationStorageEntry>
	listEntries(conversationId: string): Promise<ConversationStorageEntry[]>
}

/** Minimal persisted entry shape needed by recording and replay agents. */
export type ConversationStorageEntry = Pick<
	ConversationEntryRow,
	"id" | "sequence" | "kind" | "payload" | "metadata" | "createdAt"
>

/** Configuration for wrapping a QueryAgent with conversation recording. */
export interface ConversationRecordingQueryAgentConfig {
	agent: QueryAgent
	storage: ConversationStorage
	defaultConversationId?: string
	route?: string
	modelProvider: string
	modelId: string
}

const DefaultRoute = "agent_query"

export class ConversationRecordingQueryAgent implements QueryAgent {
	private readonly agent: QueryAgent
	private readonly storage: ConversationStorage
	private readonly defaultConversationId: string | undefined
	private readonly route: string
	private readonly modelProvider: string
	private readonly modelId: string
	private readonly eventListeners = createQueryAgentEventListeners()
	private readonly removeAgentCompactionListener: () => void

	constructor(config: ConversationRecordingQueryAgentConfig) {
		this.agent = config.agent
		this.storage = config.storage
		this.defaultConversationId = config.defaultConversationId
		this.route = config.route ?? DefaultRoute
		this.modelProvider = config.modelProvider
		this.modelId = config.modelId
		this.removeAgentCompactionListener = this.agent.addEventListener(
			QueryAgentEvent.Compaction,
			async (event) => {
				await this.appendCompactionSummary(event)
				await this.emitEvent(event)
			},
		)
	}

	async *ask(input: QueryAgentAsk): AsyncIterable<QueryAgentStreamEvent> {
		if (
			this.defaultConversationId &&
			input.conversationId &&
			input.conversationId !== this.defaultConversationId
		) {
			yield {
				type: "error",
				message: "Conversation switching is not supported for this session",
			}
			return
		}

		const conversationId =
			input.conversationId ??
			this.defaultConversationId ??
			(await this.storage.getOrCreateConversation()).id
		const runId = randomUUID()

		const userEntry = await this.storage.appendEntry(conversationId, {
			kind: ConversationEntryKind.UserMessage,
			payload: {
				role: "user",
				parts: [{ type: "text", text: input.message }],
			},
			metadata: { runId },
		})

		yield { type: "conversation", conversationId }

		const assistantText: string[] = []
		for await (const event of this.agent.ask({
			...input,
			conversationId,
			userMessageEntry: {
				id: userEntry.id,
				sequence: userEntry.sequence,
			},
		})) {
			switch (event.type) {
				case "conversation":
					break
				case "text_delta":
					assistantText.push(event.text)
					yield event
					break
				case "tool_start":
					await this.storage.appendEntry(conversationId, {
						kind: ConversationEntryKind.ToolCall,
						payload: {
							toolName: event.toolName,
							runId,
						},
						metadata: { runId },
					})
					yield event
					break
				case "tool_end":
					await this.storage.appendEntry(conversationId, {
						kind: ConversationEntryKind.ToolResult,
						payload: {
							toolName: event.toolName,
							ok: event.ok,
							runId,
						},
						metadata: { runId },
					})
					yield event
					break
				case "error":
					await this.storage.appendEntry(conversationId, {
						kind: ConversationEntryKind.SystemNote,
						payload: {
							type: "agent_error",
							message: event.message,
							runId,
						},
						metadata: { runId },
					})
					yield event
					return
				case "done":
					await this.appendAssistantMessage(conversationId, assistantText, runId)
					yield event
					return
			}
		}

		await this.appendAssistantMessage(conversationId, assistantText, runId)
	}

	dispose(): void {
		this.removeAgentCompactionListener()
		this.clearEventListeners()
		this.agent.dispose()
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

	private async appendAssistantMessage(
		conversationId: string,
		assistantText: string[],
		runId: string,
	): Promise<void> {
		const text = assistantText.join("")
		if (text.length === 0) return

		await this.storage.appendEntry(conversationId, {
			kind: ConversationEntryKind.AssistantMessage,
			payload: {
				role: "assistant",
				parts: [{ type: "text", text }],
			},
			metadata: this.modelRunMetadata(runId),
		})
	}

	private modelRunMetadata(runId: string): ConversationEntryMetadata {
		const metadata: ConversationEntryMetadata = { runId }
		metadata.modelRun = {
			route: this.route,
			provider: this.modelProvider,
			model: this.modelId,
		}
		return metadata
	}

	private async appendCompactionSummary(event: QueryAgentCompactionEvent): Promise<void> {
		if (event.compactedEntryRange === null) return

		await this.storage.appendEntry(event.conversationId, {
			kind: ConversationEntryKind.ContextSummary,
			payload: {
				covers: event.compactedEntryRange,
				summary: {
					durableFacts: [],
					preferences: [],
					decisions: [],
					openTasks: [],
					importantDetails: [event.summary],
				},
				promptVersion: "pi-sdk-compaction-v1",
			},
			metadata: {
				piCompaction: {
					firstKeptEntryId: event.firstKeptEntryId,
					tokensBefore: event.tokensBefore,
					fromExtension: event.fromExtension,
					details: event.details,
				},
			},
		})
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
}
