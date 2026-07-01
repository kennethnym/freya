import {
	AssistantMessagePayload,
	AttachmentPayload,
	ConversationEntryKind,
	ConversationEntryMetadata,
	ConversationEntryVisibility,
	ContextSummaryPayload,
	GenericObjectPayload,
	UserMessagePayload,
	type ConversationEntryPayload,
} from "@freya/core"
import { type } from "arktype"
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import type { Database } from "../db/index.ts"
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
} from "./storage.ts"

import {
	conversationEntries,
	ConversationResponseStateStatus,
	conversationResponseState as conversationResponseStateTable,
	conversations as conversationsTable,
	files,
	user,
} from "../db/schema.ts"
import { ConversationNotFoundError } from "./errors.ts"

const conversationEntryKind = type.enumerated(...Object.values(ConversationEntryKind))
const conversationEntryVisibility = type.enumerated(...Object.values(ConversationEntryVisibility))
const pendingSinceEntry = alias(conversationEntries, "pending_since_entry")

export class DrizzleConversationStorage implements ConversationStorage {
	private readonly db: Database
	private readonly inTransaction: boolean

	constructor(db: Database, inTransaction = false) {
		this.db = db
		this.inTransaction = inTransaction
	}

	async transaction<T>(tx: (storage: ConversationStorage) => T | Promise<T>): Promise<T> {
		if (this.inTransaction) return tx(this)

		return this.db.transaction(async (transactionDb) =>
			tx(new DrizzleConversationStorage(transactionDb, true)),
		)
	}

	async createConversation(userId: string): Promise<ConversationRow> {
		return insertConversation(this.db, userId)
	}

	async listUserConversations(userId: string): Promise<ConversationRow[]> {
		return this.db
			.select()
			.from(conversationsTable)
			.where(eq(conversationsTable.userId, userId))
			.orderBy(desc(conversationsTable.updatedAt), desc(conversationsTable.createdAt))
	}

	async findConversation(conversationId: string): Promise<ConversationRow | null> {
		return findConversation(this.db, conversationId)
	}

	async getOrCreateConversation(userId: string): Promise<ConversationRow> {
		return this.write(async (db) => {
			await requireUserForUpdate(db, userId)
			const existing = await latestConversation(db, userId)
			if (existing) return existing

			return insertConversation(db, userId)
		})
	}

	async createFile(userId: string, input: CreateFileInput): Promise<FileRow> {
		return insertFile(this.db, userId, input)
	}

	async appendEntry(
		conversationId: string,
		input: AppendConversationEntryInput,
	): Promise<ConversationEntryRow> {
		return this.write((db) => appendEntryToConversation(db, null, conversationId, input))
	}

	async appendAttachmentEntry(
		conversationId: string,
		input: AppendAttachmentEntryInput,
	): Promise<AppendAttachmentEntryResult> {
		return this.write((db) => appendAttachmentEntryToConversation(db, null, conversationId, input))
	}

	async nextSequence(conversationId: string): Promise<number> {
		return nextSequence(this.db, conversationId)
	}

	async listUserConversationEntries(
		userId: string,
		conversationId: string,
		params: ListConversationEntriesParams = {},
	): Promise<ConversationEntryRow[]> {
		if (!(await findUserConversation(this.db, userId, conversationId))) {
			throw new ConversationNotFoundError(conversationId, userId)
		}

		if (params.visibility) {
			return this.db
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

		return this.db
			.select()
			.from(conversationEntries)
			.where(eq(conversationEntries.conversationId, conversationId))
			.orderBy(asc(conversationEntries.sequence))
	}

	async listPendingUserConversationEntries(
		userId: string,
		conversationId: string,
	): Promise<ConversationEntryRow[]> {
		const entries = await this.db
			.select({ entry: conversationEntries })
			.from(conversationResponseStateTable)
			.innerJoin(
				conversationsTable,
				and(
					eq(conversationsTable.id, conversationResponseStateTable.conversationId),
					eq(conversationsTable.userId, userId),
				),
			)
			.innerJoin(
				pendingSinceEntry,
				and(
					eq(pendingSinceEntry.id, conversationResponseStateTable.pendingSinceEntryId),
					eq(pendingSinceEntry.conversationId, conversationResponseStateTable.conversationId),
				),
			)
			.innerJoin(
				conversationEntries,
				and(
					eq(conversationEntries.conversationId, conversationResponseStateTable.conversationId),
					eq(conversationEntries.kind, ConversationEntryKind.UserMessage),
					gte(conversationEntries.sequence, pendingSinceEntry.sequence),
				),
			)
			.where(
				and(
					eq(conversationResponseStateTable.conversationId, conversationId),
					eq(conversationEntries.conversationId, conversationId),
				),
			)
			.orderBy(asc(conversationEntries.sequence))

		if (entries.length > 0) return entries.map(({ entry }) => entry)
		if (await findUserConversation(this.db, userId, conversationId)) return []

		throw new ConversationNotFoundError(conversationId, userId)
	}

	async findConversationResponseState(
		conversationId: string,
	): Promise<ConversationResponseStateRow | null> {
		const rows = await this.db
			.select()
			.from(conversationResponseStateTable)
			.where(eq(conversationResponseStateTable.conversationId, conversationId))
			.limit(1)

		return rows[0] ?? null
	}

	async listPendingResponseStates(): Promise<ConversationResponseStateRow[]> {
		const rows = await this.db
			.select()
			.from(conversationResponseStateTable)
			.where(eq(conversationResponseStateTable.status, ConversationResponseStateStatus.Pending))

		return rows
	}

	async listRunningResponseStates(): Promise<ConversationResponseStateRow[]> {
		const rows = await this.db
			.select()
			.from(conversationResponseStateTable)
			.where(eq(conversationResponseStateTable.status, ConversationResponseStateStatus.Running))

		return rows
	}

	async upsertConversationResponseState(
		conversationId: string,
		input: UpsertConversationResponseStateInput,
	): Promise<ConversationResponseStateRow> {
		const now = new Date()

		return this.write(async (db) => {
			if (!(await findConversationByIdForUpdate(db, conversationId))) {
				throw new ConversationNotFoundError(conversationId, "")
			}

			const rows = await db
				.insert(conversationResponseStateTable)
				.values({
					conversationId,
					status: input.status ?? ConversationResponseStateStatus.Pending,
					pendingSinceEntryId: input.pendingSinceEntryId,
					maxWaitUntil: input.maxWaitUntil,
					runningSince: input.runningSince ?? null,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: conversationResponseStateTable.conversationId,
					set: {
						status: input.status ?? ConversationResponseStateStatus.Pending,
						maxWaitUntil: input.maxWaitUntil,
						runningSince: input.runningSince ?? null,
						updatedAt: now,
					},
				})
				.returning()

			return requireRow(rows)
		})
	}

	async updateConversationResponseState(
		conversationId: string,
		input: UpdateConversationResponseStateInput,
	): Promise<ConversationResponseStateRow | null> {
		return this.write(async (db) => {
			if (!(await findConversationByIdForUpdate(db, conversationId))) {
				throw new ConversationNotFoundError(conversationId, "")
			}

			const rows = await db
				.update(conversationResponseStateTable)
				.set({
					status: input.status,
					pendingSinceEntryId: input.pendingSinceEntryId,
					maxWaitUntil: input.maxWaitUntil,
					runningSince: input.runningSince,
					updatedAt: new Date(),
				})
				.where(eq(conversationResponseStateTable.conversationId, conversationId))
				.returning()

			return rows[0] ?? null
		})
	}

	async markResponseStateStatus(
		conversationIds: string[],
		status: ConversationResponseStateStatus,
	): Promise<ConversationResponseStateRow[]> {
		return this.write(async (db) => {
			const now = new Date()

			let runningSince: Date | null
			switch (status) {
				case "pending":
				case "failed":
					runningSince = null
					break
				case "running":
					runningSince = now
					break
			}

			const rows = await db
				.update(conversationResponseStateTable)
				.set({
					status,
					runningSince,
					updatedAt: now,
				})
				.where(inArray(conversationResponseStateTable.conversationId, conversationIds))
				.returning()

			return rows
		})
	}

	async claimPendingConversationResponseState(
		conversationId: string,
	): Promise<ConversationResponseStateRow | null> {
		return this.write(async (db) => {
			const now = new Date()
			const rows = await db
				.update(conversationResponseStateTable)
				.set({
					status: "running",
					runningSince: now,
					updatedAt: now,
				})
				.where(
					and(
						eq(conversationResponseStateTable.conversationId, conversationId),
						eq(conversationResponseStateTable.status, "pending"),
					),
				)
				.returning()

			return rows[0] ?? null
		})
	}

	async clearConversationResponseState(conversationId: string): Promise<void> {
		await this.write(async (db) => {
			if (!(await findConversationByIdForUpdate(db, conversationId))) {
				throw new ConversationNotFoundError(conversationId, "")
			}

			await db
				.delete(conversationResponseStateTable)
				.where(eq(conversationResponseStateTable.conversationId, conversationId))
		})
	}

	private async write<T>(fn: (db: Database) => Promise<T>): Promise<T> {
		if (this.inTransaction) return fn(this.db)

		return this.db.transaction(fn)
	}
}

export function createConversationStorage(db: Database): ConversationStorage {
	return new DrizzleConversationStorage(db)
}

export function conversations(db: Database, userId: string) {
	const storage = createConversationStorage(db)

	return {
		createConversation(): Promise<ConversationRow> {
			return storage.createConversation(userId)
		},

		listConversations(): Promise<ConversationRow[]> {
			return storage.listUserConversations(userId)
		},

		getConversation(conversationId: string): Promise<ConversationRow | null> {
			return findUserConversation(db, userId, conversationId)
		},

		getOrCreateConversation(): Promise<ConversationRow> {
			return storage.getOrCreateConversation(userId)
		},

		createFile(input: CreateFileInput): Promise<FileRow> {
			return storage.createFile(userId, input)
		},

		appendEntry(
			conversationId: string,
			input: AppendConversationEntryInput,
		): Promise<ConversationEntryRow> {
			return db.transaction((tx) => appendEntryToConversation(tx, userId, conversationId, input))
		},

		appendAttachmentEntry(
			conversationId: string,
			input: AppendAttachmentEntryInput,
		): Promise<AppendAttachmentEntryResult> {
			return db.transaction((tx) =>
				appendAttachmentEntryToConversation(tx, userId, conversationId, input),
			)
		},

		listEntries(
			conversationId: string,
			params: ListConversationEntriesParams = {},
		): Promise<ConversationEntryRow[]> {
			return storage.listUserConversationEntries(userId, conversationId, params)
		},
	}
}

export function conversationResponse(db: Database, _userId: string, conversationId: string) {
	const storage = createConversationStorage(db)

	return {
		get(): Promise<ConversationResponseStateRow | null> {
			return storage.findConversationResponseState(conversationId)
		},

		upsert(input: UpsertConversationResponseStateInput): Promise<ConversationResponseStateRow> {
			return storage.upsertConversationResponseState(conversationId, input)
		},

		update(
			input: UpdateConversationResponseStateInput,
		): Promise<ConversationResponseStateRow | null> {
			return storage.updateConversationResponseState(conversationId, input)
		},

		clear(): Promise<void> {
			return storage.clearConversationResponseState(conversationId)
		},
	}
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

async function appendEntryToConversation(
	db: Database,
	userId: string | null,
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
	}

	const conversation = userId
		? await findConversationForUpdate(db, userId, conversationId)
		: await findConversationByIdForUpdate(db, conversationId)
	if (!conversation) {
		throw new ConversationNotFoundError(conversationId, userId ?? "")
	}
	if (fileId) await requireFile(db, conversation.userId, fileId)

	const sequence = await nextSequence(db, conversationId)
	const rows = await db
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

	await touchConversation(db, conversation.userId, conversationId)
	return requireRow(rows)
}

async function appendAttachmentEntryToConversation(
	db: Database,
	userId: string | null,
	conversationId: string,
	input: AppendAttachmentEntryInput,
): Promise<AppendAttachmentEntryResult> {
	const payload = AttachmentPayload.assert(input.payload)
	const visibility = conversationEntryVisibility.assert(
		input.visibility ?? defaultVisibilityForKind(ConversationEntryKind.Attachment),
	)
	const metadata = ConversationEntryMetadata.assert(input.metadata ?? {})
	const conversation = userId
		? await findConversationForUpdate(db, userId, conversationId)
		: await findConversationByIdForUpdate(db, conversationId)

	if (!conversation) {
		throw new ConversationNotFoundError(conversationId, userId ?? "")
	}

	const file = await insertFile(db, conversation.userId, input.file)
	const sequence = await nextSequence(db, conversationId)
	const rows = await db
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

	await touchConversation(db, conversation.userId, conversationId)
	return {
		file,
		entry: requireRow(rows),
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

export async function findConversation(
	db: Database,
	conversationId: string,
): Promise<ConversationRow | null> {
	const rows = await db
		.select()
		.from(conversationsTable)
		.where(eq(conversationsTable.id, conversationId))
		.limit(1)

	return rows[0] ?? null
}

async function findUserConversation(
	db: Database,
	userId: string,
	conversationId: string,
): Promise<ConversationRow | null> {
	const rows = await db
		.select()
		.from(conversationsTable)
		.where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.userId, userId)))
		.limit(1)

	return rows[0] ?? null
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

async function findConversationByIdForUpdate(
	db: Database,
	conversationId: string,
): Promise<ConversationRow | null> {
	const rows = await db
		.select()
		.from(conversationsTable)
		.where(eq(conversationsTable.id, conversationId))
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
