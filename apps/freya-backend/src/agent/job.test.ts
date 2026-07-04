import { AgentEventKind, type AgentEvent } from "@freya/agent-protocol"
import {
	ConversationEntryKind,
	ConversationEntryVisibility,
	type ConversationEntry,
	type ConversationEntryVisibility as ConversationEntryVisibilityType,
} from "@freya/core"
import { describe, expect, test } from "bun:test"

import type {
	AppendAttachmentEntryInput,
	AppendAttachmentEntryResult,
	AppendConversationEntryInput,
	ConversationEntryRow,
	ConversationResponseStateRow,
	ConversationRow,
	ConversationStorage,
	CreateFileInput,
	FileRow,
	ListConversationEntriesParams,
	UpdateConversationResponseStateInput,
	UpsertConversationResponseStateInput,
} from "../conversations/storage.ts"
import type { ConversationResponseStateStatus } from "../db/schema.ts"
import type { Job } from "../lib/job.ts"
import type { UserSessionManager } from "../session/index.ts"
import type {
	QueryAgent,
	QueryAgentAsk,
	QueryAgentEvent,
	QueryAgentEventListener,
	QueryAgentStreamEvent,
} from "./query-agent.ts"

import { ConversationResponseStateStatus as ResponseStateStatus } from "../db/schema.ts"
import {
	NotificationCentral,
	type NotificationPayload,
} from "../notification/notification-central.ts"
import { AgentResponseJobExecutor, type AgentResponseJobPayload } from "./job.ts"

const ConversationId = "00000000-0000-4000-8000-000000000001"
const UserId = "user-1"
const UserEntryId = "00000000-0000-4000-8000-000000000002"
const Now = new Date("2026-07-03T00:00:00.000Z")

class FakeConversationStorage implements ConversationStorage {
	readonly appended: ConversationEntry[] = []
	readonly clearedConversationIds: string[] = []
	readonly markedStatuses: Array<{
		conversationIds: string[]
		status: ConversationResponseStateStatus
	}> = []

	private nextSequenceValue = 2

	async transaction<T>(tx: (storage: ConversationStorage) => T | Promise<T>): Promise<T> {
		return tx(this)
	}

	async createConversation(_userId: string): Promise<ConversationRow> {
		throw new Error("createConversation is not implemented")
	}

	async listUserConversations(_userId: string): Promise<ConversationRow[]> {
		throw new Error("listUserConversations is not implemented")
	}

	async findConversation(conversationId: string): Promise<ConversationRow | null> {
		if (conversationId !== ConversationId) return null
		return conversationRow()
	}

	async getOrCreateConversation(_userId: string): Promise<ConversationRow> {
		throw new Error("getOrCreateConversation is not implemented")
	}

	async createFile(_userId: string, _input: CreateFileInput): Promise<FileRow> {
		throw new Error("createFile is not implemented")
	}

	async appendEntry(
		conversationId: string,
		input: AppendConversationEntryInput,
	): Promise<ConversationEntry> {
		const entry = conversationEntryFromAppendInput(conversationId, this.nextSequenceValue, input)
		this.nextSequenceValue += 1
		this.appended.push(entry)
		return entry
	}

	async appendAttachmentEntry(
		_conversationId: string,
		_input: AppendAttachmentEntryInput,
	): Promise<AppendAttachmentEntryResult> {
		throw new Error("appendAttachmentEntry is not implemented")
	}

	async nextSequence(_conversationId: string): Promise<number> {
		return this.nextSequenceValue
	}

	async listUserConversationEntries(
		_userId: string,
		_conversationId: string,
		_params?: ListConversationEntriesParams,
	): Promise<ConversationEntryRow[]> {
		throw new Error("listUserConversationEntries is not implemented")
	}

	async listPendingUserConversationEntries(
		_userId: string,
		conversationId: string,
	): Promise<ConversationEntryRow[]> {
		return [pendingUserEntryRow(conversationId)]
	}

	async findConversationResponseState(
		_conversationId: string,
	): Promise<ConversationResponseStateRow | null> {
		throw new Error("findConversationResponseState is not implemented")
	}

	async listPendingResponseStates(): Promise<ConversationResponseStateRow[]> {
		throw new Error("listPendingResponseStates is not implemented")
	}

	async listRunningResponseStates(): Promise<ConversationResponseStateRow[]> {
		throw new Error("listRunningResponseStates is not implemented")
	}

	async upsertConversationResponseState(
		_conversationId: string,
		_input: UpsertConversationResponseStateInput,
	): Promise<ConversationResponseStateRow> {
		throw new Error("upsertConversationResponseState is not implemented")
	}

	async updateConversationResponseState(
		_conversationId: string,
		_input: UpdateConversationResponseStateInput,
	): Promise<ConversationResponseStateRow | null> {
		throw new Error("updateConversationResponseState is not implemented")
	}

	async markResponseStateStatus(
		conversationIds: string[],
		status: ConversationResponseStateStatus,
	): Promise<ConversationResponseStateRow[]> {
		this.markedStatuses.push({ conversationIds, status })
		return []
	}

	async claimPendingConversationResponseState(
		conversationId: string,
	): Promise<ConversationResponseStateRow | null> {
		if (conversationId !== ConversationId) return null
		return conversationResponseStateRow()
	}

	async clearConversationResponseState(conversationId: string): Promise<void> {
		this.clearedConversationIds.push(conversationId)
	}
}

class FakeQueryAgent implements QueryAgent {
	readonly inputs: QueryAgentAsk[] = []
	private readonly events: QueryAgentStreamEvent[]

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
		_type: T,
		_listener: QueryAgentEventListener<T>,
	): () => void {
		return () => {}
	}

	dispose(): void {}
}

describe("AgentResponseJobExecutor", () => {
	test("notifies persisted conversation entries for streamed response events", async () => {
		const storage = new FakeConversationStorage()
		const agent = new FakeQueryAgent([
			{ type: "text_delta", text: "I'll check\n" },
			{ type: "tool_start", toolName: "calendar" },
			{ type: "tool_end", toolName: "calendar", ok: true },
			{ type: "text_delta", text: "All set" },
			{ type: "done" },
		])
		const notifications: NotificationPayload[] = []
		const notificationCentral = new NotificationCentral()
		notificationCentral.registerListenerForUser(UserId, async (notification) => {
			notifications.push(notification)
		})
		const executor = new AgentResponseJobExecutor({
			conversationStorage: storage,
			userSessionManager: fakeUserSessionManager(agent),
			notificationCentral,
		})

		await executor.execute(agentResponseJob())

		expect(agent.inputs).toHaveLength(1)
		expect(agent.inputs[0]?.message).toContain("What's next?")
		expect(agent.inputs[0]?.conversationId).toBe(ConversationId)
		expect(agent.inputs[0]?.signal).toBeInstanceOf(AbortSignal)
		expect(storage.appended.map((entry) => entry.kind)).toEqual([
			ConversationEntryKind.AssistantMessage,
			ConversationEntryKind.ToolCall,
			ConversationEntryKind.ToolResult,
			ConversationEntryKind.AssistantMessage,
		])
		expect(notifications.map((notification) => notification.payload.kind)).toEqual([
			AgentEventKind.ConversationEntryCreated,
			AgentEventKind.ConversationEntryCreated,
			AgentEventKind.ConversationEntryCreated,
			AgentEventKind.ConversationEntryCreated,
			AgentEventKind.ResponseFinished,
		])
		expect(conversationEntryNotifications(notifications).map((event) => event.entry)).toEqual(
			storage.appended,
		)
		expect(storage.clearedConversationIds).toEqual([ConversationId])
		expect(storage.markedStatuses).toEqual([])
	})
})

function fakeUserSessionManager(agent: QueryAgent): UserSessionManager {
	return {
		async getOrCreate(userId: string) {
			expect(userId).toBe(UserId)
			return { agent }
		},
	} as unknown as UserSessionManager
}

function agentResponseJob(): Job<AgentResponseJobPayload> {
	const controller = new AbortController()
	return {
		id: 1,
		payload: { conversationId: ConversationId },
		signal: controller.signal,
	}
}

function conversationEntryNotifications(
	notifications: NotificationPayload[],
): Array<Extract<AgentEvent, { kind: typeof AgentEventKind.ConversationEntryCreated }>> {
	return notifications
		.map((notification) => notification.payload)
		.filter(isConversationEntryCreatedEvent)
}

function isConversationEntryCreatedEvent(
	event: AgentEvent,
): event is Extract<AgentEvent, { kind: typeof AgentEventKind.ConversationEntryCreated }> {
	return event.kind === AgentEventKind.ConversationEntryCreated
}

function conversationRow(): ConversationRow {
	return {
		id: ConversationId,
		userId: UserId,
		createdAt: Now,
		updatedAt: Now,
	}
}

function conversationResponseStateRow(): ConversationResponseStateRow {
	return {
		conversationId: ConversationId,
		status: ResponseStateStatus.Running,
		pendingSinceEntryId: UserEntryId,
		maxWaitUntil: Now,
		runningSince: Now,
		createdAt: Now,
		updatedAt: Now,
	}
}

function pendingUserEntryRow(conversationId: string): ConversationEntryRow {
	return {
		id: UserEntryId,
		conversationId,
		sequence: 1,
		kind: ConversationEntryKind.UserMessage,
		visibility: ConversationEntryVisibility.UserVisible,
		fileId: null,
		payload: {
			role: "user",
			parts: [{ type: "text", text: "What's next?" }],
		},
		metadata: {},
		createdAt: Now,
	}
}

function conversationEntryFromAppendInput(
	conversationId: string,
	sequence: number,
	input: AppendConversationEntryInput,
): ConversationEntry {
	const base = {
		id: entryId(sequence),
		conversationId,
		sequence,
		visibility: input.visibility ?? defaultVisibilityForKind(input.kind),
		fileId: null,
		metadata: input.metadata ?? {},
		createdAt: Now.toISOString(),
	}

	switch (input.kind) {
		case ConversationEntryKind.UserMessage:
			return {
				...base,
				kind: input.kind,
				payload: input.payload,
			}
		case ConversationEntryKind.AssistantMessage:
			return {
				...base,
				kind: input.kind,
				payload: input.payload,
			}
		case ConversationEntryKind.ToolCall:
		case ConversationEntryKind.ToolResult:
		case ConversationEntryKind.SystemNote:
			return {
				...base,
				kind: input.kind,
				payload: input.payload,
			}
		case ConversationEntryKind.ContextSummary:
			return {
				...base,
				kind: input.kind,
				payload: input.payload,
			}
		case ConversationEntryKind.Attachment:
			return {
				...base,
				kind: input.kind,
				fileId: input.fileId,
				payload: input.payload,
			}
	}
}

function defaultVisibilityForKind(kind: ConversationEntryKind): ConversationEntryVisibilityType {
	switch (kind) {
		case ConversationEntryKind.UserMessage:
		case ConversationEntryKind.AssistantMessage:
		case ConversationEntryKind.Attachment:
			return ConversationEntryVisibility.UserVisible
		case ConversationEntryKind.ToolCall:
		case ConversationEntryKind.ToolResult:
		case ConversationEntryKind.ContextSummary:
		case ConversationEntryKind.SystemNote:
			return ConversationEntryVisibility.Internal
	}
}

function entryId(sequence: number): string {
	return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`
}
