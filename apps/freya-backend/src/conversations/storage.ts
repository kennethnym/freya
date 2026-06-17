import { and, asc, desc, eq } from "drizzle-orm"

import type { Database } from "../db/index.ts"
import type {
	AssistantMessagePayload,
	AttachmentPayload,
	ContextSummaryPayload,
	ConversationEntryKind as ConversationEntryKindType,
	ConversationEntryMetadata,
	ConversationEntryPayload,
	ConversationEntryVisibility as ConversationEntryVisibilityType,
	GenericObjectPayload,
	UserMessagePayload,
} from "./types.ts"

import {
	conversationEntries,
	conversations as conversationsTable,
	files,
	user,
} from "../db/schema.ts"
import {
	ConversationEntryMetadata as ConversationEntryMetadataSchema,
	AssistantMessagePayload as AssistantMessagePayloadSchema,
	AttachmentPayload as AttachmentPayloadSchema,
	ConversationEntryKind,
	ConversationEntryKindInput,
	ConversationEntryVisibility,
	ConversationEntryVisibilityInput,
	ContextSummaryPayload as ContextSummaryPayloadSchema,
	GenericObjectPayload as GenericObjectPayloadSchema,
	UserMessagePayload as UserMessagePayloadSchema,
} from "./types.ts"

export type ConversationRow = typeof conversationsTable.$inferSelect
export type ConversationEntryRow = typeof conversationEntries.$inferSelect
export type FileRow = typeof files.$inferSelect

export interface CreateFileInput {
	storageKey: string
	originalName?: string
	mimeType: string
	sizeBytes: number
	metadata?: Record<string, unknown>
}

export interface AppendAttachmentEntryInput {
	file: CreateFileInput
	payload: AttachmentPayload
	visibility?: ConversationEntryVisibilityType
	metadata?: ConversationEntryMetadata
}

export interface AppendAttachmentEntryResult {
	file: FileRow
	entry: ConversationEntryRow
}

interface AppendConversationEntryBase {
	visibility?: ConversationEntryVisibilityType
	metadata?: ConversationEntryMetadata
}

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

export interface ListConversationEntriesParams {
	visibility?: ConversationEntryVisibilityType
}

export function conversations(db: Database, userId: string) {
	return {
		async createConversation(): Promise<ConversationRow> {
			return insertConversation(db, userId)
		},

		async listConversations(): Promise<ConversationRow[]> {
			return db
				.select()
				.from(conversationsTable)
				.where(eq(conversationsTable.userId, userId))
				.orderBy(desc(conversationsTable.updatedAt), desc(conversationsTable.createdAt))
		},

		async getOrCreateConversation(): Promise<ConversationRow> {
			return db.transaction(async (tx) => {
				await requireUserForUpdate(tx, userId)
				const existing = await latestConversation(tx, userId)
				if (existing) return existing

				return insertConversation(tx, userId)
			})
		},

		async createFile(input: CreateFileInput): Promise<FileRow> {
			return insertFile(db, userId, input)
		},

		async appendEntry(
			conversationId: string,
			input: AppendConversationEntryInput,
		): Promise<ConversationEntryRow> {
			const kind = ConversationEntryKindInput.assert(input.kind)
			const visibility = ConversationEntryVisibilityInput.assert(
				input.visibility ?? defaultVisibilityForKind(kind),
			)
			const payload = payloadForKind(kind, input.payload)
			const metadata = ConversationEntryMetadataSchema.assert(input.metadata ?? {})
			let fileId: string | null = null

			if (input.kind === ConversationEntryKind.Attachment) {
				fileId = input.fileId
				await requireFile(db, userId, fileId)
			}

			const rows = await db.transaction(async (tx) => {
				await requireConversationForUpdate(tx, userId, conversationId)
				const sequence = await nextSequence(tx, conversationId)

				const rows = await tx
					.insert(conversationEntries)
					.values({
						conversationId,
						sequence,
						kind,
						visibility,
						fileId,
						payload,
						metadata,
					})
					.returning()

				await touchConversation(tx, userId, conversationId)
				return rows
			})

			return requireRow(rows)
		},

		async appendAttachmentEntry(
			conversationId: string,
			input: AppendAttachmentEntryInput,
		): Promise<AppendAttachmentEntryResult> {
			const payload = AttachmentPayloadSchema.assert(input.payload)
			const visibility = ConversationEntryVisibilityInput.assert(
				input.visibility ?? defaultVisibilityForKind(ConversationEntryKind.Attachment),
			)
			const metadata = ConversationEntryMetadataSchema.assert(input.metadata ?? {})

			return db.transaction(async (tx) => {
				await requireConversationForUpdate(tx, userId, conversationId)

				const file = await insertFile(tx, userId, input.file)
				const sequence = await nextSequence(tx, conversationId)
				const rows = await tx
					.insert(conversationEntries)
					.values({
						conversationId,
						sequence,
						kind: ConversationEntryKind.Attachment,
						visibility,
						fileId: file.id,
						payload,
						metadata,
					})
					.returning()

				await touchConversation(tx, userId, conversationId)
				return {
					file,
					entry: requireRow(rows),
				}
			})
		},

		async listEntries(
			conversationId: string,
			params: ListConversationEntriesParams = {},
		): Promise<ConversationEntryRow[]> {
			await requireConversation(db, userId, conversationId)

			if (params.visibility) {
				return db
					.select()
					.from(conversationEntries)
					.where(
						and(
							eq(conversationEntries.conversationId, conversationId),
							eq(conversationEntries.visibility, params.visibility),
						),
					)
					.orderBy(asc(conversationEntries.sequence))
			}

			return db
				.select()
				.from(conversationEntries)
				.where(eq(conversationEntries.conversationId, conversationId))
				.orderBy(asc(conversationEntries.sequence))
		},
	}
}

function payloadForKind(
	kind: ConversationEntryKindType,
	payload: AppendConversationEntryInput["payload"],
): ConversationEntryPayload {
	switch (kind) {
		case ConversationEntryKind.UserMessage:
			return UserMessagePayloadSchema.assert(payload)
		case ConversationEntryKind.AssistantMessage:
			return AssistantMessagePayloadSchema.assert(payload)
		case ConversationEntryKind.Attachment:
			return AttachmentPayloadSchema.assert(payload)
		case ConversationEntryKind.ContextSummary:
			return ContextSummaryPayloadSchema.assert(payload)
		case ConversationEntryKind.ToolCall:
		case ConversationEntryKind.ToolResult:
		case ConversationEntryKind.SystemNote:
			return GenericObjectPayloadSchema.assert(payload)
	}
}

async function requireUserForUpdate(db: Database, userId: string): Promise<void> {
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1)
		.for("update")

	requireRow(rows, `User not found: ${userId}`)
}

async function requireConversation(
	db: Database,
	userId: string,
	conversationId: string,
): Promise<ConversationRow> {
	const rows = await db
		.select()
		.from(conversationsTable)
		.where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.userId, userId)))
		.limit(1)

	return requireRow(rows, `Conversation not found: ${conversationId}`)
}

async function requireConversationForUpdate(
	db: Database,
	userId: string,
	conversationId: string,
): Promise<ConversationRow> {
	const rows = await db
		.select()
		.from(conversationsTable)
		.where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.userId, userId)))
		.limit(1)
		.for("update")

	return requireRow(rows, `Conversation not found: ${conversationId}`)
}

async function latestConversation(db: Database, userId: string): Promise<ConversationRow | null> {
	const rows = await db
		.select()
		.from(conversationsTable)
		.where(eq(conversationsTable.userId, userId))
		.orderBy(desc(conversationsTable.updatedAt), desc(conversationsTable.createdAt))
		.limit(1)

	return rows[0] ?? null
}

async function insertConversation(db: Database, userId: string): Promise<ConversationRow> {
	const rows = await db
		.insert(conversationsTable)
		.values({
			userId,
		})
		.returning()

	return requireRow(rows)
}

async function requireFile(db: Database, userId: string, fileId: string): Promise<FileRow> {
	const rows = await db
		.select()
		.from(files)
		.where(and(eq(files.id, fileId), eq(files.userId, userId)))
		.limit(1)

	return requireRow(rows, `File not found: ${fileId}`)
}

async function insertFile(db: Database, userId: string, input: CreateFileInput): Promise<FileRow> {
	const rows = await db
		.insert(files)
		.values({
			userId,
			storageKey: input.storageKey,
			originalName: input.originalName ?? null,
			mimeType: input.mimeType,
			sizeBytes: input.sizeBytes,
			metadata: input.metadata ?? {},
		})
		.returning()

	return requireRow(rows)
}

async function touchConversation(
	db: Database,
	userId: string,
	conversationId: string,
): Promise<void> {
	await db
		.update(conversationsTable)
		.set({ updatedAt: new Date() })
		.where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.userId, userId)))
}

async function nextSequence(db: Database, conversationId: string): Promise<number> {
	const rows = await db
		.select({ sequence: conversationEntries.sequence })
		.from(conversationEntries)
		.where(eq(conversationEntries.conversationId, conversationId))
		.orderBy(desc(conversationEntries.sequence))
		.limit(1)

	return (rows[0]?.sequence ?? 0) + 1
}

function requireRow<T>(rows: T[], message = "Expected database row"): T {
	const row = rows[0]
	if (!row) throw new Error(message)
	return row
}

function defaultVisibilityForKind(
	kind: ConversationEntryKindType,
): ConversationEntryVisibilityType {
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
