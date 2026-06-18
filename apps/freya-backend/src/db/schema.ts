import {
	ConversationEntryVisibility,
	type ConversationEntryKind,
	type ConversationEntryMetadata,
	type ConversationEntryPayload,
	type ConversationEntryVisibility as ConversationEntryVisibilityType,
} from "@freya/core"
import { sql } from "drizzle-orm"
import {
	boolean,
	check,
	customType,
	integer,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core"

// ---------------------------------------------------------------------------
// Better Auth core tables
// Re-exported from CLI-generated schema.
// Regenerate with: bunx --bun auth@latest generate --config auth.ts --output src/db/auth-schema.ts
// ---------------------------------------------------------------------------

export {
	user,
	session,
	account,
	verification,
	userRelations,
	sessionRelations,
	accountRelations,
} from "./auth-schema.ts"

import { user } from "./auth-schema.ts"

// ---------------------------------------------------------------------------
// FREYA — per-user source configuration
// ---------------------------------------------------------------------------

const bytea = customType<{ data: Buffer }>({
	dataType() {
		return "bytea"
	},
})

export const userSources = pgTable(
	"user_sources",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sourceId: text("source_id").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		config: jsonb("config").default({}),
		credentials: bytea("credentials"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		unique("user_sources_user_id_source_id_unique").on(t.userId, t.sourceId),
		index("user_sources_user_id_enabled_idx").on(t.userId, t.enabled),
	],
)

// ---------------------------------------------------------------------------
// FREYA — conversations
// ---------------------------------------------------------------------------

export const conversations = pgTable(
	"conversations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("conversations_user_id_updated_at_idx").on(t.userId, t.updatedAt)],
)

export const files = pgTable(
	"files",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		storageKey: text("storage_key").notNull(),
		originalName: text("original_name"),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		unique("files_storage_key_unique").on(t.storageKey),
		index("files_user_id_created_at_idx").on(t.userId, t.createdAt),
	],
)

export const conversationEntries = pgTable(
	"conversation_entries",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		kind: text("kind").$type<ConversationEntryKind>().notNull(),
		visibility: text("visibility")
			.$type<ConversationEntryVisibilityType>()
			.notNull()
			.default(ConversationEntryVisibility.Internal),
		fileId: uuid("file_id").references(() => files.id, { onDelete: "restrict" }),
		payload: jsonb("payload").$type<ConversationEntryPayload>().notNull(),
		metadata: jsonb("metadata").$type<ConversationEntryMetadata>().notNull().default({}),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		unique("conversation_entries_conversation_id_sequence_unique").on(t.conversationId, t.sequence),
		index("conversation_entries_conversation_id_sequence_idx").on(t.conversationId, t.sequence),
		index("conversation_entries_conversation_id_visibility_sequence_idx").on(
			t.conversationId,
			t.visibility,
			t.sequence,
		),
		index("conversation_entries_kind_idx").on(t.kind),
		index("conversation_entries_file_id_idx").on(t.fileId),
		check(
			"conversation_entries_attachment_file_id_check",
			sql`(${t.kind} = 'attachment' and ${t.fileId} is not null) or (${t.kind} <> 'attachment' and ${t.fileId} is null)`,
		),
	],
)

// ---------------------------------------------------------------------------
// FREYA — reminders source storage
// ---------------------------------------------------------------------------

export const reminders = pgTable(
	"reminders",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		notes: text("notes"),
		dueAt: timestamp("due_at").notNull(),
		timeZone: text("time_zone").notNull().default("UTC"),
		recurrence: jsonb("recurrence"),
		priority: text("priority").notNull().default("normal"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		index("reminders_user_id_due_at_idx").on(t.userId, t.dueAt),
		index("reminders_user_id_updated_at_idx").on(t.userId, t.updatedAt),
	],
)

export const reminderOccurrenceOverrides = pgTable(
	"reminder_occurrence_overrides",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		reminderId: uuid("reminder_id")
			.notNull()
			.references(() => reminders.id, { onDelete: "cascade" }),
		occurrenceId: text("occurrence_id").notNull(),
		originalDueAt: timestamp("original_due_at").notNull(),
		patch: jsonb("patch"),
		completedAt: timestamp("completed_at"),
		deletedAt: timestamp("deleted_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		unique("reminder_occurrence_overrides_reminder_id_occurrence_id_unique").on(
			t.reminderId,
			t.occurrenceId,
		),
		index("reminder_occurrence_overrides_user_id_reminder_id_idx").on(t.userId, t.reminderId),
		index("reminder_occurrence_overrides_user_id_original_due_at_idx").on(
			t.userId,
			t.originalDueAt,
		),
	],
)
