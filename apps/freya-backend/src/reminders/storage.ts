import type {
	CreateReminderInput,
	Reminder,
	ReminderListParams,
	ReminderOccurrenceOverride,
	ReminderOccurrenceOverrideInput,
	ReminderOccurrenceOverrideListParams,
	ReminderOccurrencePatch,
	ReminderPatch,
	ReminderPriority,
	ReminderRecurrence,
	ReminderStorage,
} from "@freya/source-reminders"

import {
	ReminderOccurrencePatchInput,
	ReminderPriority as ReminderPriorityValue,
	ReminderPriorityInput,
	ReminderRecurrenceInput,
} from "@freya/source-reminders"
import { type } from "arktype"
import { and, eq, inArray } from "drizzle-orm"

import type { Database } from "../db/index.ts"

import { reminderOccurrenceOverrides, reminders } from "../db/schema.ts"

interface ArkSchema<T> {
	(value: unknown): T | InstanceType<typeof type.errors>
}

type ReminderRow = typeof reminders.$inferSelect
type ReminderInsert = typeof reminders.$inferInsert
type ReminderOccurrenceOverrideRow = typeof reminderOccurrenceOverrides.$inferSelect
type ReminderOccurrenceOverrideInsert = typeof reminderOccurrenceOverrides.$inferInsert

export class DrizzleReminderStorage implements ReminderStorage {
	private readonly db: Database
	private readonly userId: string

	constructor(db: Database, userId: string) {
		this.db = db
		this.userId = userId
	}

	async listReminders(_params: ReminderListParams): Promise<Reminder[]> {
		const rows = await this.db.select().from(reminders).where(eq(reminders.userId, this.userId))

		return rows.map(rowToReminder)
	}

	async getReminder(id: string): Promise<Reminder | null> {
		const rows = await this.db
			.select()
			.from(reminders)
			.where(and(eq(reminders.userId, this.userId), eq(reminders.id, id)))
			.limit(1)

		return rows[0] ? rowToReminder(rows[0]) : null
	}

	async createReminder(input: CreateReminderInput): Promise<Reminder> {
		const rows = await this.db
			.insert(reminders)
			.values({
				userId: this.userId,
				title: input.title,
				notes: input.notes ?? null,
				dueAt: input.dueAt,
				timeZone: input.timeZone ?? "UTC",
				recurrence: serializeRecurrence(input.recurrence ?? null),
				priority: input.priority ?? ReminderPriorityValue.Normal,
			})
			.returning()

		return rowToReminder(requireRow(rows))
	}

	async updateReminder(id: string, patch: ReminderPatch): Promise<Reminder> {
		const update: Partial<ReminderInsert> = { updatedAt: new Date() }

		if (hasOwn(patch, "title")) update.title = patch.title
		if (hasOwn(patch, "notes")) update.notes = patch.notes ?? null
		if (hasOwn(patch, "dueAt")) update.dueAt = patch.dueAt
		if (hasOwn(patch, "timeZone")) update.timeZone = patch.timeZone
		if (hasOwn(patch, "recurrence")) update.recurrence = serializeRecurrence(patch.recurrence)
		if (hasOwn(patch, "priority")) update.priority = patch.priority

		const rows = await this.db
			.update(reminders)
			.set(update)
			.where(and(eq(reminders.userId, this.userId), eq(reminders.id, id)))
			.returning()

		return rowToReminder(requireRow(rows, `Reminder not found: ${id}`))
	}

	async deleteReminder(id: string): Promise<void> {
		await this.db
			.delete(reminders)
			.where(and(eq(reminders.userId, this.userId), eq(reminders.id, id)))
	}

	async listOccurrenceOverrides(
		params: ReminderOccurrenceOverrideListParams,
	): Promise<ReminderOccurrenceOverride[]> {
		if (params.reminderIds.length === 0) return []

		const rows = await this.db
			.select()
			.from(reminderOccurrenceOverrides)
			.where(
				and(
					eq(reminderOccurrenceOverrides.userId, this.userId),
					inArray(reminderOccurrenceOverrides.reminderId, [...params.reminderIds]),
				),
			)

		return rows.map(rowToOccurrenceOverride)
	}

	async getOccurrenceOverride(
		reminderId: string,
		occurrenceId: string,
	): Promise<ReminderOccurrenceOverride | null> {
		const rows = await this.db
			.select()
			.from(reminderOccurrenceOverrides)
			.where(
				and(
					eq(reminderOccurrenceOverrides.userId, this.userId),
					eq(reminderOccurrenceOverrides.reminderId, reminderId),
					eq(reminderOccurrenceOverrides.occurrenceId, occurrenceId),
				),
			)
			.limit(1)

		return rows[0] ? rowToOccurrenceOverride(rows[0]) : null
	}

	async upsertOccurrenceOverride(
		input: ReminderOccurrenceOverrideInput,
	): Promise<ReminderOccurrenceOverride> {
		const values: ReminderOccurrenceOverrideInsert = {
			userId: this.userId,
			reminderId: input.reminderId,
			occurrenceId: input.occurrenceId,
			originalDueAt: input.originalDueAt,
			patch: serializeOccurrencePatch(input.patch),
			completedAt: input.completedAt ?? null,
			deletedAt: input.deletedAt ?? null,
		}

		const rows = await this.db
			.insert(reminderOccurrenceOverrides)
			.values(values)
			.onConflictDoUpdate({
				target: [reminderOccurrenceOverrides.reminderId, reminderOccurrenceOverrides.occurrenceId],
				set: {
					originalDueAt: values.originalDueAt,
					patch: values.patch,
					completedAt: values.completedAt,
					deletedAt: values.deletedAt,
					updatedAt: new Date(),
				},
			})
			.returning()

		return rowToOccurrenceOverride(requireRow(rows))
	}

	async deleteOccurrenceOverride(reminderId: string, occurrenceId: string): Promise<void> {
		await this.db
			.delete(reminderOccurrenceOverrides)
			.where(
				and(
					eq(reminderOccurrenceOverrides.userId, this.userId),
					eq(reminderOccurrenceOverrides.reminderId, reminderId),
					eq(reminderOccurrenceOverrides.occurrenceId, occurrenceId),
				),
			)
	}
}

function rowToReminder(row: ReminderRow): Reminder {
	return {
		id: row.id,
		title: row.title,
		notes: row.notes,
		dueAt: row.dueAt,
		timeZone: row.timeZone,
		recurrence: parseRecurrence(row.recurrence),
		priority: assertSchema<ReminderPriority>(ReminderPriorityInput, row.priority),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}

function rowToOccurrenceOverride(row: ReminderOccurrenceOverrideRow): ReminderOccurrenceOverride {
	return {
		reminderId: row.reminderId,
		occurrenceId: row.occurrenceId,
		originalDueAt: row.originalDueAt,
		patch: parseOccurrencePatch(row.patch),
		completedAt: row.completedAt,
		deletedAt: row.deletedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}

function parseRecurrence(value: unknown): ReminderRecurrence | null {
	if (value === null || value === undefined) return null
	return assertSchema<ReminderRecurrence>(ReminderRecurrenceInput, value)
}

function parseOccurrencePatch(value: unknown): ReminderOccurrencePatch | undefined {
	if (value === null || value === undefined) return undefined
	return assertSchema<ReminderOccurrencePatch>(ReminderOccurrencePatchInput, value)
}

function serializeRecurrence(recurrence: ReminderRecurrence | null | undefined): unknown {
	if (!recurrence) return null

	const value: Record<string, unknown> = {
		frequency: recurrence.frequency,
		interval: recurrence.interval,
	}

	if (recurrence.weekdays !== undefined) value.weekdays = recurrence.weekdays
	if (recurrence.count !== undefined) value.count = recurrence.count
	if (recurrence.until !== undefined) value.until = recurrence.until.toISOString()

	return value
}

function serializeOccurrencePatch(patch: ReminderOccurrencePatch | undefined): unknown {
	if (!patch) return null

	const value: Record<string, unknown> = {}
	if (hasOwn(patch, "title")) value.title = patch.title
	if (hasOwn(patch, "notes")) value.notes = patch.notes
	if (hasOwn(patch, "dueAt") && patch.dueAt !== undefined) {
		value.dueAt = patch.dueAt.toISOString()
	}
	if (hasOwn(patch, "timeZone")) value.timeZone = patch.timeZone
	if (hasOwn(patch, "priority")) value.priority = patch.priority

	return value
}

function requireRow<TRow>(
	rows: TRow[],
	message = "Reminder storage mutation returned no rows",
): TRow {
	const row = rows[0]
	if (!row) {
		throw new Error(message)
	}
	return row
}

function assertSchema<T>(schema: ArkSchema<T>, value: unknown): T {
	const result = schema(value)
	if (result instanceof type.errors) {
		throw new Error(result.summary)
	}
	return result
}

function hasOwn<TObject extends object, TKey extends PropertyKey>(
	object: TObject,
	key: TKey,
): object is TObject & Record<TKey, unknown> {
	return Object.prototype.hasOwnProperty.call(object, key)
}
