import { describe, expect, test } from "bun:test"

import type { AppendConversationEntryInput } from "../conversations/storage.ts"
import type {
	ConversationStorage,
	ConversationStorageEntry,
} from "./conversation-recording-query-agent.ts"

import { ConversationEntryKind } from "../conversations/types.ts"
import { ConversationRecordingQueryAgent } from "./conversation-recording-query-agent.ts"
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

interface RecordedEntry {
	conversationId: string
	input: AppendConversationEntryInput
}

class FakeQueryAgent implements QueryAgent {
	readonly inputs: QueryAgentAsk[] = []
	private readonly events: QueryAgentStreamEvent[]
	private readonly eventListeners = createQueryAgentEventListeners()

	constructor(events: QueryAgentStreamEvent[]) {
		this.events = events
	}

	async *ask(input: QueryAgentAsk): AsyncIterable<QueryAgentStreamEvent> {
		this.inputs.push(input)
		for (const event of this.events) {
			yield event
		}
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

	async emitCompaction(event: QueryAgentCompactionEvent): Promise<void> {
		await this.emitEvent(event)
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

	dispose(): void {}
}

class FakeConversationStorage implements ConversationStorage {
	getOrCreateCount = 0
	readonly entries: RecordedEntry[] = []
	conversationId = "conversation-1"

	async getOrCreateConversation(): Promise<{ id: string }> {
		this.getOrCreateCount += 1
		return { id: this.conversationId }
	}

	async appendEntry(
		conversationId: string,
		input: AppendConversationEntryInput,
	): Promise<ConversationStorageEntry> {
		this.entries.push({ conversationId, input })
		return {
			id: `entry-${this.entries.length}`,
			sequence: this.entries.length,
			kind: input.kind,
			payload: input.payload,
			metadata: input.metadata ?? {},
			createdAt: new Date("2026-06-15T00:00:00.000Z"),
		}
	}

	async listEntries(_conversationId: string): Promise<ConversationStorageEntry[]> {
		return this.entries.map((entry, index) => ({
			id: `entry-${index + 1}`,
			sequence: index + 1,
			kind: entry.input.kind,
			payload: entry.input.payload,
			metadata: entry.input.metadata ?? {},
			createdAt: new Date("2026-06-15T00:00:00.000Z"),
		}))
	}
}

describe("ConversationRecordingQueryAgent", () => {
	test("records user and assistant messages in the conversation timeline", async () => {
		const queryAgent = new FakeQueryAgent([
			{ type: "text_delta", text: "Hello " },
			{ type: "text_delta", text: "there." },
			{ type: "done" },
		])
		const storage = new FakeConversationStorage()
		const agent = new ConversationRecordingQueryAgent({
			agent: queryAgent,
			storage,
			modelProvider: "openrouter",
			modelId: "test-model",
		})

		const events = await collectEvents(
			agent.ask({
				message: "hi",
			}),
		)

		expect(events[0]).toEqual({ type: "conversation", conversationId: "conversation-1" })
		expect(queryAgent.inputs[0]?.conversationId).toBe("conversation-1")
		expect(storage.getOrCreateCount).toBe(1)
		expect(storage.entries).toHaveLength(2)

		const userEntry = storage.entries[0]!.input
		if (userEntry.kind !== ConversationEntryKind.UserMessage) {
			throw new Error("Expected user message entry")
		}
		expect(userEntry.payload.parts).toEqual([{ type: "text", text: "hi" }])

		const assistantEntry = storage.entries[1]!.input
		if (assistantEntry.kind !== ConversationEntryKind.AssistantMessage) {
			throw new Error("Expected assistant message entry")
		}
		expect(assistantEntry.payload.parts).toEqual([{ type: "text", text: "Hello there." }])
		expect(assistantEntry.metadata?.modelRun?.provider).toBe("openrouter")
		expect(assistantEntry.metadata?.modelRun?.model).toBe("test-model")
	})

	test("uses a provided conversation id without creating a default conversation", async () => {
		const queryAgent = new FakeQueryAgent([{ type: "done" }])
		const storage = new FakeConversationStorage()
		const agent = new ConversationRecordingQueryAgent({
			agent: queryAgent,
			storage,
			modelProvider: "openrouter",
			modelId: "test-model",
		})

		const events = await collectEvents(
			agent.ask({
				conversationId: "conversation-existing",
				message: "continue",
			}),
		)

		expect(events[0]).toEqual({
			type: "conversation",
			conversationId: "conversation-existing",
		})
		expect(storage.getOrCreateCount).toBe(0)
		expect(storage.entries[0]?.conversationId).toBe("conversation-existing")
		expect(queryAgent.inputs[0]?.conversationId).toBe("conversation-existing")
	})

	test("uses the eager default conversation id without reading storage on ask", async () => {
		const queryAgent = new FakeQueryAgent([{ type: "done" }])
		const storage = new FakeConversationStorage()
		const agent = new ConversationRecordingQueryAgent({
			agent: queryAgent,
			storage,
			defaultConversationId: "conversation-eager",
			modelProvider: "openrouter",
			modelId: "test-model",
		})

		const events = await collectEvents(
			agent.ask({
				message: "continue",
			}),
		)

		expect(events[0]).toEqual({
			type: "conversation",
			conversationId: "conversation-eager",
		})
		expect(storage.getOrCreateCount).toBe(0)
		expect(storage.entries[0]?.conversationId).toBe("conversation-eager")
		expect(queryAgent.inputs[0]?.conversationId).toBe("conversation-eager")
	})

	test("rejects switching away from the eager default conversation", async () => {
		const queryAgent = new FakeQueryAgent([{ type: "done" }])
		const storage = new FakeConversationStorage()
		const agent = new ConversationRecordingQueryAgent({
			agent: queryAgent,
			storage,
			defaultConversationId: "conversation-eager",
			modelProvider: "openrouter",
			modelId: "test-model",
		})

		const events = await collectEvents(
			agent.ask({
				conversationId: "conversation-other",
				message: "continue",
			}),
		)

		expect(events).toEqual([
			{
				type: "error",
				message: "Conversation switching is not supported for this session",
			},
		])
		expect(storage.entries).toHaveLength(0)
		expect(queryAgent.inputs).toHaveLength(0)
	})

	test("records tool activity and agent errors as internal entries", async () => {
		const queryAgent = new FakeQueryAgent([
			{ type: "tool_start", toolName: "freya_get_feed" },
			{ type: "tool_end", toolName: "freya_get_feed", ok: true },
			{ type: "error", message: "model unavailable" },
		])
		const storage = new FakeConversationStorage()
		const agent = new ConversationRecordingQueryAgent({
			agent: queryAgent,
			storage,
			modelProvider: "openrouter",
			modelId: "test-model",
		})

		await collectEvents(
			agent.ask({
				message: "what now?",
			}),
		)

		expect(storage.entries.map((entry) => entry.input.kind)).toEqual([
			ConversationEntryKind.UserMessage,
			ConversationEntryKind.ToolCall,
			ConversationEntryKind.ToolResult,
			ConversationEntryKind.SystemNote,
		])

		const toolCall = storage.entries[1]!.input
		if (toolCall.kind !== ConversationEntryKind.ToolCall) {
			throw new Error("Expected tool call entry")
		}
		expect(toolCall.payload.toolName).toBe("freya_get_feed")

		const toolResult = storage.entries[2]!.input
		if (toolResult.kind !== ConversationEntryKind.ToolResult) {
			throw new Error("Expected tool result entry")
		}
		expect(toolResult.payload.ok).toBe(true)

		const systemNote = storage.entries[3]!.input
		if (systemNote.kind !== ConversationEntryKind.SystemNote) {
			throw new Error("Expected system note entry")
		}
		expect(systemNote.payload).toMatchObject({
			type: "agent_error",
			message: "model unavailable",
		})
	})

	test("records compaction events as context summaries", async () => {
		const queryAgent = new FakeQueryAgent([
			{ type: "text_delta", text: "Kept answer." },
			{ type: "done" },
		])
		const storage = new FakeConversationStorage()
		const agent = new ConversationRecordingQueryAgent({
			agent: queryAgent,
			storage,
			defaultConversationId: "conversation-1",
			modelProvider: "openrouter",
			modelId: "test-model",
		})
		const forwardedCompactions: QueryAgentCompactionEvent[] = []
		agent.addEventListener(QueryAgentEvent.Compaction, (event) => {
			forwardedCompactions.push(event)
		})

		await collectEvents(
			agent.ask({
				message: "remember this",
			}),
		)

		await queryAgent.emitCompaction({
			type: QueryAgentEvent.Compaction,
			conversationId: "conversation-1",
			summary: "The user prefers compact summaries.",
			firstKeptEntryId: "pi-entry-7",
			compactedEntryRange: {
				startSequence: 1,
				endSequence: 1,
			},
			tokensBefore: 1234,
			details: { reason: "threshold" },
			fromExtension: false,
		})

		const summaryEntry = storage.entries.at(-1)?.input
		if (summaryEntry?.kind !== ConversationEntryKind.ContextSummary) {
			throw new Error("Expected context summary entry")
		}
		expect(summaryEntry.payload.covers).toEqual({
			startSequence: 1,
			endSequence: 1,
		})
		expect(summaryEntry.payload.summary.importantDetails).toEqual([
			"The user prefers compact summaries.",
		])
		expect(summaryEntry.metadata?.piCompaction).toMatchObject({
			firstKeptEntryId: "pi-entry-7",
			tokensBefore: 1234,
			fromExtension: false,
			details: { reason: "threshold" },
		})
		expect(forwardedCompactions).toHaveLength(1)
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
