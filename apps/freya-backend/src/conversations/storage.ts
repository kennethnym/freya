import {
	AssistantMessagePayload,
	AttachmentPayload,
	ConversationEntryKind,
	ConversationEntryMetadata,
	ConversationEntryVisibility,
	ContextSummaryPayload,
	GenericObjectPayload,
	UserMessagePayload,
} from "@freya/core"

import {
	conversationEntries,
	conversationResponseState as conversationResponseStateTable,
	conversations as conversationsTable,
	files,
	type ConversationResponseStateStatus,
} from "../db/schema.ts"

export interface ConversationStorage {
	transaction<T>(tx: (storage: ConversationStorage) => T | Promise<T>): Promise<T>
	createConversation(userId: string): Promise<ConversationRow>
	listUserConversations(userId: string): Promise<ConversationRow[]>
	findConversation(conversationId: string): Promise<ConversationRow | null>
	getOrCreateConversation(userId: string): Promise<ConversationRow>
	createFile(userId: string, input: CreateFileInput): Promise<FileRow>
	appendEntry(
		conversationId: string,
		input: AppendConversationEntryInput,
	): Promise<ConversationEntryRow>
	appendAttachmentEntry(
		conversationId: string,
		input: AppendAttachmentEntryInput,
	): Promise<AppendAttachmentEntryResult>
	nextSequence(conversationId: string): Promise<number>
	listUserConversationEntries(
		userId: string,
		conversationId: string,
		params?: ListConversationEntriesParams,
	): Promise<ConversationEntryRow[]>
	listPendingUserConversationEntries(
		userId: string,
		conversationId: string,
	): Promise<ConversationEntryRow[]>
	findConversationResponseState(
		conversationId: string,
	): Promise<ConversationResponseStateRow | null>
	// TODO: add pagination support
	listPendingResponseStates(): Promise<ConversationResponseStateRow[]>
	// TODO: add pagination support
	listRunningResponseStates(): Promise<ConversationResponseStateRow[]>
	upsertConversationResponseState(
		conversationId: string,
		input: UpsertConversationResponseStateInput,
	): Promise<ConversationResponseStateRow>
	updateConversationResponseState(
		conversationId: string,
		input: UpdateConversationResponseStateInput,
	): Promise<ConversationResponseStateRow | null>
	markResponseStateStatus(
		conversationIds: string[],
		status: ConversationResponseStateStatus,
	): Promise<ConversationResponseStateRow[]>
	claimPendingConversationResponseState(
		conversationId: string,
	): Promise<ConversationResponseStateRow | null>
	clearConversationResponseState(conversationId: string): Promise<void>
}

/** Database row shape for a conversation owned by a user. */
export type ConversationRow = typeof conversationsTable.$inferSelect

/** Database row shape for an entry in a conversation timeline. */
export type ConversationEntryRow = typeof conversationEntries.$inferSelect

/** Database row shape for pending assistant response state in a conversation. */
export type ConversationResponseStateRow = typeof conversationResponseStateTable.$inferSelect

/** Database row shape for an uploaded file referenced by conversations. */
export type FileRow = typeof files.$inferSelect

/** Input required to create a stored file record. */
export interface CreateFileInput {
	storageKey: string
	originalName?: string
	mimeType: string
	sizeBytes: number
	metadata?: Record<string, unknown>
}

/** Input for creating a file and appending its attachment entry together. */
export interface AppendAttachmentEntryInput {
	file: CreateFileInput
	payload: AttachmentPayload
	visibility?: ConversationEntryVisibility
	metadata?: ConversationEntryMetadata
}

/** Result returned after a file-backed attachment entry is appended. */
export interface AppendAttachmentEntryResult {
	file: FileRow
	entry: ConversationEntryRow
}

/** Common fields accepted when appending any conversation entry. */
interface AppendConversationEntryBase {
	visibility?: ConversationEntryVisibility
	metadata?: ConversationEntryMetadata
}

/** Discriminated input for appending any supported entry kind to a conversation. */
export type AppendConversationEntryInput =
	| (AppendConversationEntryBase & {
			kind: typeof ConversationEntryKind.UserMessage
			payload: UserMessagePayload
			fileId?: never
	  })
	| (AppendConversationEntryBase & {
			kind: typeof ConversationEntryKind.AssistantMessage
			payload: AssistantMessagePayload
			fileId?: never
	  })
	| (AppendConversationEntryBase & {
			kind: typeof ConversationEntryKind.Attachment
			payload: AttachmentPayload
			fileId: string
	  })
	| (AppendConversationEntryBase & {
			kind: typeof ConversationEntryKind.ContextSummary
			payload: ContextSummaryPayload
			fileId?: never
	  })
	| (AppendConversationEntryBase & {
			kind:
				| typeof ConversationEntryKind.ToolCall
				| typeof ConversationEntryKind.ToolResult
				| typeof ConversationEntryKind.SystemNote
			payload: GenericObjectPayload
			fileId?: never
	  })

/** Filters accepted when listing conversation entries. */
export interface ListConversationEntriesParams {
	visibility?: ConversationEntryVisibility
}

/** Input for creating or replacing pending assistant response state. */
export interface UpsertConversationResponseStateInput {
	status?: ConversationResponseStateStatus
	pendingSinceEntryId: string
	maxWaitUntil: Date
	runningSince?: Date | null
}

/** Input for patching pending assistant response state. */
export interface UpdateConversationResponseStateInput {
	status?: ConversationResponseStateStatus
	pendingSinceEntryId?: string
	maxWaitUntil?: Date
	runningSince?: Date | null
}

export {
	createConversationStorage,
	conversationResponse,
	conversations,
	DrizzleConversationStorage,
	findConversation,
} from "./db-storage.ts"
