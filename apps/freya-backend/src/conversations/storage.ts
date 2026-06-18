import {
	AssistantMessagePayload,
	AttachmentPayload,
	ConversationEntryKind,
	ConversationEntryVisibility,
	ContextSummaryPayload,
	ConversationEntryMetadata,
	GenericObjectPayload,
	UserMessagePayload,
	type ConversationEntryPayload,
} from "@freya/core"
import { type } from "arktype"
import { and, asc, desc, eq } from "drizzle-orm"

import type { Database } from "../db/index.ts"

import {
	conversationEntries,
	conversations as conversationsTable,
	files,
	user,
} from "../db/schema.ts"
import { ConversationNotFoundError } from "./errors.ts"

const conversationEntryKind = type.enumerated(...Object.values(ConversationEntryKind))
const conversationEntryVisibility = type.enumerated(...Object.values(ConversationEntryVisibility))

/** Database row shape for a conversation owned by a user. */
export type ConversationRow = typeof conversationsTable.$inferSelect

/** Database row shape for an entry in a conversation timeline. */
export type ConversationEntryRow = typeof conversationEntries.$inferSelect

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

export function conversations(db: Database, userId: string) {
	const storage = {
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

		async getConversation(conversationId: string): Promise<ConversationRow | null> {
			const rows = await db
				.select()
				.from(conversationsTable)
				.where(
					and(eq(conversationsTable.id, conversationId), eq(conversationsTable.userId, userId)),
				)
				.limit(1)

			return rows[0] ?? null
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
			const kind = conversationEntryKind.assert(input.kind)
			const visibility = conversationEntryVisibility.assert(
				input.visibility ?? defaultVisibilityForKind(kind),
			)
			const payload = payloadForKind(kind, input.payload)
			const metadata = ConversationEntryMetadata.assert(input.metadata ?? {})
			let fileId: string | null = null

			if (input.kind === ConversationEntryKind.Attachment) {
				fileId = input.fileId
				await requireFile(db, userId, fileId)
			}

			const rows = await db.transaction(async (tx) => {
				if (!(await findConversationForUpdate(tx, userId, conversationId))) {
					throw new ConversationNotFoundError(conversationId, userId)
				}
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
			const payload = AttachmentPayload.assert(input.payload)
			const visibility = conversationEntryVisibility.assert(
				input.visibility ?? defaultVisibilityForKind(ConversationEntryKind.Attachment),
			)
			const metadata = ConversationEntryMetadata.assert(input.metadata ?? {})

			return db.transaction(async (tx) => {
				if (!(await findConversationForUpdate(tx, userId, conversationId))) {
					throw new ConversationNotFoundError(conversationId, userId)
				}

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
			if (!(await storage.getConversation(conversationId))) {
				throw new ConversationNotFoundError(conversationId, userId)
			}

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

	return storage
}

function payloadForKind(
	kind: ConversationEntryKind,
	payload: AppendConversationEntryInput["payload"],
): ConversationEntryPayload {
	switch (kind) {
		case ConversationEntryKind.UserMessage:
			return UserMessagePayload.assert(payload)
		case ConversationEntryKind.AssistantMessage:
			return AssistantMessagePayload.assert(payload)
		case ConversationEntryKind.Attachment:
			return AttachmentPayload.assert(payload)
		case ConversationEntryKind.ContextSummary:
			return ContextSummaryPayload.assert(payload)
		case ConversationEntryKind.ToolCall:
		case ConversationEntryKind.ToolResult:
		case ConversationEntryKind.SystemNote:
			return GenericObjectPayload.assert(payload)
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

async function findConversationForUpdate(
	db: Database,
	userId: string,
	conversationId: string,
): Promise<ConversationRow | null> {
	const rows = await db
		.select()
		.from(conversationsTable)
		.where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.userId, userId)))
		.limit(1)
		.for("update")

	return rows[0] ?? null
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

function defaultVisibilityForKind(kind: ConversationEntryKind): ConversationEntryVisibility {
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
