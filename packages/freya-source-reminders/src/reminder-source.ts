import type {
	ActionDefinition,
	Context,
	ContextEntry,
	FeedItemSignals,
	FeedSource,
} from "@freya/core"

import { TimeRelevance, UnknownActionError } from "@freya/core"
import { type } from "arktype"

import type {
	CompleteReminderInput,
	CreateReminderInput,
	DeleteReminderInput,
	Reminder,
	ReminderDeleteResult,
	ReminderEditScope,
	ReminderFeedItem,
	ReminderOccurrence,
	ReminderOccurrenceOverride,
	ReminderOccurrenceOverrideInput,
	ReminderOccurrencePatch,
	ReminderPatch,
	ReminderPriority,
	ReminderStorage,
	ReminderUpdateResult,
	UncompleteReminderInput,
	UpdateReminderInput,
} from "./types.ts"

import {
	createReminderOccurrenceId,
	expandReminderOccurrences,
	findReminderOccurrenceIndex,
	recurrenceAfterSplit,
	stopRecurrenceAfterOccurrenceCount,
} from "./recurrence.ts"
import {
	CompleteReminderInput as CompleteReminderInputSchema,
	DeleteReminderInput as DeleteReminderInputSchema,
	ReminderAction,
	ReminderDeleteResultType,
	ReminderEditScope as ReminderEditScopeValue,
	ReminderFeedItemType,
	ReminderPriority as ReminderPriorityValue,
	ReminderRecurrenceFrequency,
	ReminderTimeZoneInput,
	ReminderUpdateResultType,
	ReminderWeekday,
	UncompleteReminderInput as UncompleteReminderInputSchema,
	UpdateReminderInput as UpdateReminderInputSchema,
	createReminderInputSchema,
} from "./types.ts"

interface ArkSchema<T> {
	(value: unknown): T | InstanceType<typeof type.errors>
}

export interface ReminderSourceOptions {
	storage: ReminderStorage
	/** Default: 24 hours. */
	lookAheadMs?: number
	/** Default: 24 hours, so earlier reminders from today remain visible. */
	lookBackMs?: number
	/** Default: false. */
	includeCompleted?: boolean
	/** Default: UTC. Used when create input omits timeZone. */
	defaultTimeZone?: string
}

const DEFAULT_LOOK_AHEAD_MS = 24 * 60 * 60 * 1000
const DEFAULT_LOOK_BACK_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIME_ZONE = "UTC"

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * FeedSource for one-off and recurring reminders.
 *
 * ReminderSource stores only canonical reminders plus occurrence overrides.
 * It owns recurrence expansion, edit-scope semantics, and feed item signals.
 */
export class ReminderSource implements FeedSource<ReminderFeedItem> {
	readonly id = "freya.reminders"

	private readonly storage: ReminderStorage
	private readonly lookAheadMs: number
	private readonly lookBackMs: number
	private readonly includeCompleted: boolean
	private readonly defaultTimeZone: string
	private readonly createReminderInput: ReturnType<typeof createReminderInputSchema>
	private readonly itemListeners = new Set<(items: ReminderFeedItem[]) => void>()

	constructor(options: ReminderSourceOptions) {
		this.storage = options.storage
		this.lookAheadMs = options.lookAheadMs ?? DEFAULT_LOOK_AHEAD_MS
		this.lookBackMs = options.lookBackMs ?? DEFAULT_LOOK_BACK_MS
		this.includeCompleted = options.includeCompleted ?? false
		this.defaultTimeZone = options.defaultTimeZone ?? DEFAULT_TIME_ZONE
		assertSchema(ReminderTimeZoneInput, this.defaultTimeZone)
		this.createReminderInput = createReminderInputSchema(this.defaultTimeZone)
	}

	async listActions(): Promise<Record<string, ActionDefinition>> {
		return {
			[ReminderAction.CreateReminder]: {
				id: ReminderAction.CreateReminder,
				description: "Create a reminder",
			},
			[ReminderAction.UpdateReminder]: {
				id: ReminderAction.UpdateReminder,
				description: "Update a reminder or scoped recurrence occurrence",
			},
			[ReminderAction.DeleteReminder]: {
				id: ReminderAction.DeleteReminder,
				description: "Delete a reminder or scoped recurrence occurrence",
			},
			[ReminderAction.CompleteReminder]: {
				id: ReminderAction.CompleteReminder,
				description: "Complete a reminder occurrence",
			},
			[ReminderAction.UncompleteReminder]: {
				id: ReminderAction.UncompleteReminder,
				description: "Clear completion for a reminder occurrence",
			},
		}
	}

	async executeAction(actionId: string, params: unknown): Promise<unknown> {
		switch (actionId) {
			case ReminderAction.CreateReminder:
				return this.createReminder(assertSchema(this.createReminderInput, params))
			case ReminderAction.UpdateReminder:
				return this.updateReminder(assertSchema(UpdateReminderInputSchema, params))
			case ReminderAction.DeleteReminder:
				return this.deleteReminder(assertSchema(DeleteReminderInputSchema, params))
			case ReminderAction.CompleteReminder:
				return this.completeReminder(assertSchema(CompleteReminderInputSchema, params))
			case ReminderAction.UncompleteReminder:
				return this.uncompleteReminder(assertSchema(UncompleteReminderInputSchema, params))
			default:
				throw new UnknownActionError(actionId)
		}
	}

	async fetchContext(_context: Context): Promise<readonly ContextEntry[] | null> {
		return null
	}

	onItemsUpdate(callback: (items: ReminderFeedItem[]) => void): () => void {
		this.itemListeners.add(callback)
		const cleanupStorage = this.storage.subscribe?.(() => {
			this.notifyItemsChanged()
		})

		return () => {
			this.itemListeners.delete(callback)
			cleanupStorage?.()
		}
	}

	async fetchItems(context: Context): Promise<ReminderFeedItem[]> {
		const from = new Date(context.time.getTime() - this.lookBackMs)
		const to = new Date(context.time.getTime() + this.lookAheadMs)
		const reminders = await this.storage.listReminders({
			from,
			to,
			includeCompleted: this.includeCompleted,
		})

		if (reminders.length === 0) return []

		const reminderIds = reminders.map(function reminderId(reminder) {
			return reminder.id
		})
		const overrides = await this.storage.listOccurrenceOverrides({ reminderIds, from, to })
		const overridesByReminderId = groupOverridesByReminderId(overrides)

		const items: ReminderFeedItem[] = []
		for (const reminder of reminders) {
			const occurrences = expandReminderOccurrences(reminder, {
				from,
				to,
				includeCompleted: this.includeCompleted,
				overrides: overridesByReminderId.get(reminder.id),
			})

			for (const occurrence of occurrences) {
				items.push(createFeedItem(occurrence, context.time, this.id))
			}
		}

		return items.sort(compareFeedItems)
	}

	async createReminder(input: CreateReminderInput): Promise<Reminder> {
		const reminder = await this.storage.createReminder(
			assertSchema(this.createReminderInput, input),
		)
		this.notifyItemsChanged()
		return reminder
	}

	async updateReminder(input: UpdateReminderInput): Promise<ReminderUpdateResult> {
		const parsed = assertSchema(UpdateReminderInputSchema, input)
		const reminder = await this.requireReminder(parsed.reminderId)
		const result = await this.updateExistingReminder(reminder, parsed)
		this.notifyItemsChanged()
		return result
	}

	async deleteReminder(input: DeleteReminderInput): Promise<ReminderDeleteResult> {
		const parsed = assertSchema(DeleteReminderInputSchema, input)
		const reminder = await this.requireReminder(parsed.reminderId)
		const result = await this.deleteExistingReminder(reminder, parsed)
		this.notifyItemsChanged()
		return result
	}

	async completeReminder(input: CompleteReminderInput): Promise<ReminderOccurrenceOverride> {
		const parsed = assertSchema(CompleteReminderInputSchema, input)
		const reminder = await this.requireReminder(parsed.reminderId)
		const occurrenceDueAt = parsed.occurrenceDueAt
		this.requireKnownOccurrence(reminder, occurrenceDueAt)

		const override = await this.mergeOccurrenceOverride(reminder.id, occurrenceDueAt, {
			completedAt: parsed.completedAt ?? new Date(),
			deletedAt: null,
		})

		this.notifyItemsChanged()
		return override
	}

	async uncompleteReminder(input: UncompleteReminderInput): Promise<ReminderOccurrenceOverride> {
		const parsed = assertSchema(UncompleteReminderInputSchema, input)
		const reminder = await this.requireReminder(parsed.reminderId)
		const occurrenceDueAt = parsed.occurrenceDueAt
		this.requireKnownOccurrence(reminder, occurrenceDueAt)

		const override = await this.mergeOccurrenceOverride(reminder.id, occurrenceDueAt, {
			completedAt: null,
		})

		this.notifyItemsChanged()
		return override
	}

	private async updateExistingReminder(
		reminder: Reminder,
		input: UpdateReminderInput,
	): Promise<ReminderUpdateResult> {
		if (input.scope === ReminderEditScopeValue.EntireSeries) {
			const updated = await this.storage.updateReminder(reminder.id, input.patch)
			return {
				type: ReminderUpdateResultType.UpdatedReminder,
				reminder: updated,
			}
		}

		const occurrenceDueAt = requireOccurrenceDueAt(input)
		this.requireKnownOccurrence(reminder, occurrenceDueAt)

		if (!reminder.recurrence) {
			const updated = await this.storage.updateReminder(reminder.id, input.patch)
			return {
				type: ReminderUpdateResultType.UpdatedReminder,
				reminder: updated,
			}
		}

		if (input.scope === ReminderEditScopeValue.ThisOccurrence) {
			if (hasOwn(input.patch, "recurrence")) {
				throw new Error("recurrence cannot be changed for a single occurrence")
			}

			const { recurrence: _recurrence, ...occurrencePatch } = input.patch
			const override = await this.mergeOccurrenceOverride(reminder.id, occurrenceDueAt, {
				patch: occurrencePatch,
			})
			return {
				type: ReminderUpdateResultType.UpdatedOccurrence,
				override,
			}
		}

		return this.splitReminder(reminder, occurrenceDueAt, input.patch)
	}

	private async deleteExistingReminder(
		reminder: Reminder,
		input: DeleteReminderInput,
	): Promise<ReminderDeleteResult> {
		if (input.scope === ReminderEditScopeValue.EntireSeries) {
			await this.storage.deleteReminder(reminder.id)
			return { type: ReminderDeleteResultType.DeletedReminder }
		}

		const occurrenceDueAt = requireOccurrenceDueAt(input)
		this.requireKnownOccurrence(reminder, occurrenceDueAt)

		if (!reminder.recurrence) {
			await this.storage.deleteReminder(reminder.id)
			return { type: ReminderDeleteResultType.DeletedReminder }
		}

		if (input.scope === ReminderEditScopeValue.ThisOccurrence) {
			const override = await this.mergeOccurrenceOverride(reminder.id, occurrenceDueAt, {
				deletedAt: new Date(),
			})
			return {
				type: ReminderDeleteResultType.DeletedOccurrence,
				override,
			}
		}

		const occurrenceIndex = findReminderOccurrenceIndex(reminder, occurrenceDueAt)
		if (occurrenceIndex === null) {
			throw new Error("occurrenceDueAt does not match this reminder")
		}
		if (occurrenceIndex === 0) {
			await this.storage.deleteReminder(reminder.id)
			return { type: ReminderDeleteResultType.DeletedReminder }
		}

		const recurrence = stopRecurrenceAfterOccurrenceCount(reminder.recurrence, occurrenceIndex)
		const updated = await this.storage.updateReminder(reminder.id, { recurrence })
		return {
			type: ReminderDeleteResultType.EndedReminder,
			reminder: updated,
		}
	}

	private async splitReminder(
		reminder: Reminder,
		occurrenceDueAt: Date,
		patch: ReminderPatch,
	): Promise<ReminderUpdateResult> {
		if (!reminder.recurrence) {
			const updated = await this.storage.updateReminder(reminder.id, patch)
			return {
				type: ReminderUpdateResultType.UpdatedReminder,
				reminder: updated,
			}
		}

		const occurrenceIndex = findReminderOccurrenceIndex(reminder, occurrenceDueAt)
		if (occurrenceIndex === null) {
			throw new Error("occurrenceDueAt does not match this reminder")
		}

		if (occurrenceIndex === 0) {
			const updated = await this.storage.updateReminder(reminder.id, patch)
			return {
				type: ReminderUpdateResultType.UpdatedReminder,
				reminder: updated,
			}
		}

		const previousRecurrence = stopRecurrenceAfterOccurrenceCount(
			reminder.recurrence,
			occurrenceIndex,
		)
		const previousReminder = await this.storage.updateReminder(reminder.id, {
			recurrence: previousRecurrence,
		})
		const newReminder = await this.storage.createReminder(
			createSplitReminderInput(reminder, occurrenceDueAt, occurrenceIndex, patch),
		)

		return {
			type: ReminderUpdateResultType.SplitReminder,
			previousReminder,
			newReminder,
		}
	}

	private requireKnownOccurrence(reminder: Reminder, occurrenceDueAt: Date): void {
		const occurrenceIndex = findReminderOccurrenceIndex(reminder, occurrenceDueAt)
		if (occurrenceIndex === null) {
			throw new Error("occurrenceDueAt does not match this reminder")
		}
	}

	private async requireReminder(id: string): Promise<Reminder> {
		const reminder = await this.storage.getReminder(id)
		if (!reminder) {
			throw new Error(`Reminder not found: ${id}`)
		}
		return reminder
	}

	private async mergeOccurrenceOverride(
		reminderId: string,
		originalDueAt: Date,
		patch: Partial<ReminderOccurrenceOverrideInput>,
	): Promise<ReminderOccurrenceOverride> {
		const occurrenceId = createReminderOccurrenceId(originalDueAt)
		const existing = await this.storage.getOccurrenceOverride(reminderId, occurrenceId)

		const input: ReminderOccurrenceOverrideInput = {
			reminderId,
			occurrenceId,
			originalDueAt,
			patch: mergeOccurrencePatch(existing?.patch, patch.patch),
			completedAt: hasOwn(patch, "completedAt")
				? (patch.completedAt ?? null)
				: existing?.completedAt,
			deletedAt: hasOwn(patch, "deletedAt") ? (patch.deletedAt ?? null) : existing?.deletedAt,
		}

		return this.storage.upsertOccurrenceOverride(input)
	}

	private notifyItemsChanged(): void {
		for (const listener of this.itemListeners) {
			listener([])
		}
	}
}

function createFeedItem(
	occurrence: ReminderOccurrence,
	now: Date,
	sourceId: string,
): ReminderFeedItem {
	return {
		id: `reminder-${occurrence.reminderId}-${occurrence.occurrenceId}`,
		sourceId,
		type: ReminderFeedItemType.Reminder,
		timestamp: now,
		data: {
			reminderId: occurrence.reminderId,
			occurrenceId: occurrence.occurrenceId,
			title: occurrence.title,
			notes: occurrence.notes,
			originalDueAt: occurrence.originalDueAt,
			dueAt: occurrence.dueAt,
			timeZone: occurrence.timeZone,
			recurrence: occurrence.recurrence,
			priority: occurrence.priority,
			completedAt: occurrence.completedAt,
		},
		signals: computeSignals(occurrence, now),
	}
}

function computeSignals(occurrence: ReminderOccurrence, now: Date): FeedItemSignals {
	if (occurrence.completedAt) {
		return { urgency: 0, timeRelevance: TimeRelevance.Ambient }
	}

	const msUntilDue = occurrence.dueAt.getTime() - now.getTime()
	let urgency: number
	let timeRelevance: TimeRelevance

	if (msUntilDue < 0) {
		urgency = 1
		timeRelevance = TimeRelevance.Imminent
	} else if (msUntilDue <= FIFTEEN_MINUTES_MS) {
		urgency = 0.95
		timeRelevance = TimeRelevance.Imminent
	} else if (msUntilDue <= ONE_HOUR_MS) {
		urgency = 0.8
		timeRelevance = TimeRelevance.Imminent
	} else if (msUntilDue <= ONE_DAY_MS) {
		urgency = 0.5
		timeRelevance = TimeRelevance.Upcoming
	} else {
		urgency = 0.2
		timeRelevance = TimeRelevance.Ambient
	}

	return {
		urgency: clamp01(urgency + priorityUrgencyAdjustment(occurrence.priority)),
		timeRelevance,
	}
}

function createSplitReminderInput(
	reminder: Reminder,
	occurrenceDueAt: Date,
	occurrenceIndex: number,
	patch: ReminderPatch,
): CreateReminderInput {
	const dueAt = patch.dueAt ?? occurrenceDueAt
	const timeZone = patch.timeZone ?? reminder.timeZone
	const recurrence = hasOwn(patch, "recurrence")
		? (patch.recurrence ?? null)
		: alignSplitRecurrence(
				recurrenceAfterSplit(reminder.recurrence!, occurrenceIndex),
				occurrenceDueAt,
				reminder.timeZone,
				dueAt,
				timeZone,
			)

	return {
		title: patch.title ?? reminder.title,
		notes: hasOwn(patch, "notes") ? (patch.notes ?? null) : reminder.notes,
		dueAt,
		timeZone,
		recurrence,
		priority: patch.priority ?? reminder.priority,
	}
}

function alignSplitRecurrence(
	recurrence: Reminder["recurrence"],
	occurrenceDueAt: Date,
	occurrenceTimeZone: string,
	dueAt: Date,
	timeZone: string,
): Reminder["recurrence"] {
	if (
		!recurrence ||
		recurrence.frequency !== ReminderRecurrenceFrequency.Weekly ||
		!recurrence.weekdays?.length
	) {
		return recurrence
	}

	const previousWeekday = weekdayForDate(occurrenceDueAt, occurrenceTimeZone)
	const nextWeekday = weekdayForDate(dueAt, timeZone)
	if (previousWeekday === nextWeekday || recurrence.weekdays.includes(nextWeekday)) {
		return recurrence
	}

	const weekdays = recurrence.weekdays
		.filter(function keepOtherWeekdays(weekday) {
			return weekday !== previousWeekday
		})
		.concat(nextWeekday)
		.sort(compareWeekdays)

	return { ...recurrence, weekdays }
}

function weekdayForDate(date: Date, timeZone: string): ReminderWeekday {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date)

	const year = numberDatePart(parts, "year")
	const month = numberDatePart(parts, "month")
	const day = numberDatePart(parts, "day")
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as ReminderWeekday
}

function numberDatePart(
	parts: Intl.DateTimeFormatPart[],
	type: Intl.DateTimeFormatPartTypes,
): number {
	const part = parts.find(function matchesType(value) {
		return value.type === type
	})
	if (!part) {
		throw new Error(`Missing ${type} part while formatting reminder date`)
	}
	return Number(part.value)
}

function compareWeekdays(a: ReminderWeekday, b: ReminderWeekday): number {
	return a - b
}

function mergeOccurrencePatch(
	existing: ReminderOccurrencePatch | undefined,
	next: ReminderOccurrencePatch | undefined,
): ReminderOccurrencePatch | undefined {
	if (!existing) return next
	if (!next) return existing
	return { ...existing, ...next }
}

function groupOverridesByReminderId(
	overrides: readonly ReminderOccurrenceOverride[],
): Map<string, ReminderOccurrenceOverride[]> {
	const grouped = new Map<string, ReminderOccurrenceOverride[]>()
	for (const override of overrides) {
		const list = grouped.get(override.reminderId) ?? []
		list.push(override)
		grouped.set(override.reminderId, list)
	}
	return grouped
}

function priorityUrgencyAdjustment(priority: ReminderPriority): number {
	switch (priority) {
		case ReminderPriorityValue.High:
			return 0.1
		case ReminderPriorityValue.Low:
			return -0.1
		case ReminderPriorityValue.Normal:
			return 0
	}
}

function requireOccurrenceDueAt(input: { scope: ReminderEditScope; occurrenceDueAt?: Date }): Date {
	if (!input.occurrenceDueAt) {
		throw new Error(`${input.scope} requires occurrenceDueAt`)
	}
	return input.occurrenceDueAt
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

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value))
}

function compareFeedItems(a: ReminderFeedItem, b: ReminderFeedItem): number {
	return a.data.dueAt.getTime() - b.data.dueAt.getTime()
}
