import type { FeedItem } from "@freya/core"

import { type } from "arktype"

export const ReminderPriority = {
	Low: "low",
	Normal: "normal",
	High: "high",
} as const

export type ReminderPriority = (typeof ReminderPriority)[keyof typeof ReminderPriority]

export const ReminderRecurrenceFrequency = {
	Daily: "daily",
	Weekly: "weekly",
	Monthly: "monthly",
	Yearly: "yearly",
} as const

export type ReminderRecurrenceFrequency =
	(typeof ReminderRecurrenceFrequency)[keyof typeof ReminderRecurrenceFrequency]

export const ReminderWeekday = {
	Sunday: 0,
	Monday: 1,
	Tuesday: 2,
	Wednesday: 3,
	Thursday: 4,
	Friday: 5,
	Saturday: 6,
} as const

export type ReminderWeekday = (typeof ReminderWeekday)[keyof typeof ReminderWeekday]

export const ReminderEditScope = {
	ThisOccurrence: "this-occurrence",
	ThisAndFuture: "this-and-future",
	EntireSeries: "entire-series",
} as const

export type ReminderEditScope = (typeof ReminderEditScope)[keyof typeof ReminderEditScope]

export const ReminderAction = {
	CreateReminder: "create-reminder",
	UpdateReminder: "update-reminder",
	DeleteReminder: "delete-reminder",
	CompleteReminder: "complete-reminder",
	UncompleteReminder: "uncomplete-reminder",
} as const

export type ReminderAction = (typeof ReminderAction)[keyof typeof ReminderAction]

export const ReminderUpdateResultType = {
	UpdatedReminder: "updated-reminder",
	UpdatedOccurrence: "updated-occurrence",
	SplitReminder: "split-reminder",
} as const

export type ReminderUpdateResultType =
	(typeof ReminderUpdateResultType)[keyof typeof ReminderUpdateResultType]

export const ReminderDeleteResultType = {
	DeletedReminder: "deleted-reminder",
	DeletedOccurrence: "deleted-occurrence",
	EndedReminder: "ended-reminder",
} as const

export type ReminderDeleteResultType =
	(typeof ReminderDeleteResultType)[keyof typeof ReminderDeleteResultType]

export const ReminderDateInput = type.or("Date", "string.date.iso.parse")
export const ReminderTitleInput = type.pipe(
	type.string,
	function trimTitle(value) {
		return value.trim()
	},
	type.string.atLeastLength(1),
)
export const ReminderTimeZoneInput = type("string", ":", function isTimeZone(value, ctx) {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date())
		return true
	} catch {
		return ctx.reject("a valid IANA time zone")
	}
})

export const ReminderPriorityInput = type.enumerated(
	ReminderPriority.Low,
	ReminderPriority.Normal,
	ReminderPriority.High,
)

export const ReminderEditScopeInput = type.enumerated(
	ReminderEditScope.ThisOccurrence,
	ReminderEditScope.ThisAndFuture,
	ReminderEditScope.EntireSeries,
)

export const ReminderRecurrenceFrequencyInput = type.enumerated(
	ReminderRecurrenceFrequency.Daily,
	ReminderRecurrenceFrequency.Weekly,
	ReminderRecurrenceFrequency.Monthly,
	ReminderRecurrenceFrequency.Yearly,
)

export const ReminderWeekdayInput = type.enumerated(0, 1, 2, 3, 4, 5, 6)

export const ReminderRecurrenceInput = type({
	"+": "reject",
	frequency: ReminderRecurrenceFrequencyInput,
	interval: ["number.integer >= 1", "=", 1],
	"weekdays?": ReminderWeekdayInput.array().atLeastLength(1),
	"count?": "number.integer >= 1",
	"until?": ReminderDateInput,
})

const ReminderRecurrenceNullableInput = type.or(ReminderRecurrenceInput, "null")
const ReminderNotesInput = type.or("string", "null")

export const ReminderPatchInput = type({
	"+": "reject",
	"title?": ReminderTitleInput,
	"notes?": ReminderNotesInput,
	"dueAt?": ReminderDateInput,
	"timeZone?": ReminderTimeZoneInput,
	"recurrence?": ReminderRecurrenceNullableInput,
	"priority?": ReminderPriorityInput,
})

export const ReminderOccurrencePatchInput = type({
	"+": "reject",
	"title?": ReminderTitleInput,
	"notes?": ReminderNotesInput,
	"dueAt?": ReminderDateInput,
	"timeZone?": ReminderTimeZoneInput,
	"priority?": ReminderPriorityInput,
})

export function createReminderInputSchema(defaultTimeZone: string) {
	return type({
		"+": "reject",
		title: ReminderTitleInput,
		notes: [ReminderNotesInput, "=", null],
		dueAt: ReminderDateInput,
		timeZone: [ReminderTimeZoneInput, "=", defaultTimeZone],
		recurrence: [ReminderRecurrenceNullableInput, "=", null],
		priority: [ReminderPriorityInput, "=", ReminderPriority.Normal],
	})
}

export const UpdateReminderInput = type({
	"+": "reject",
	reminderId: ReminderTitleInput,
	scope: ReminderEditScopeInput,
	"occurrenceDueAt?": ReminderDateInput,
	patch: ReminderPatchInput,
})

export const DeleteReminderInput = type({
	"+": "reject",
	reminderId: ReminderTitleInput,
	scope: ReminderEditScopeInput,
	"occurrenceDueAt?": ReminderDateInput,
})

export const CompleteReminderInput = type({
	"+": "reject",
	reminderId: ReminderTitleInput,
	occurrenceDueAt: ReminderDateInput,
	"completedAt?": ReminderDateInput,
})

export const UncompleteReminderInput = type({
	"+": "reject",
	reminderId: ReminderTitleInput,
	occurrenceDueAt: ReminderDateInput,
})

export interface ReminderRecurrence {
	frequency: ReminderRecurrenceFrequency
	/** Repeat every N frequency units. Defaults to 1 when parsed from actions. */
	interval: number
	/** Weekly recurrences only. Defaults to the weekday of dueAt. */
	weekdays?: ReminderWeekday[]
	/** Maximum number of generated occurrences, including the first one. */
	count?: number
	/** Last allowed occurrence instant, inclusive. */
	until?: Date
}

export interface Reminder {
	id: string
	title: string
	notes: string | null
	dueAt: Date
	timeZone: string
	recurrence: ReminderRecurrence | null
	priority: ReminderPriority
	createdAt: Date
	updatedAt: Date
}

export interface CreateReminderInput {
	title: string
	notes?: string | null
	dueAt: Date
	timeZone?: string
	recurrence?: ReminderRecurrence | null
	priority?: ReminderPriority
}

export interface ReminderPatch {
	title?: string
	notes?: string | null
	dueAt?: Date
	timeZone?: string
	recurrence?: ReminderRecurrence | null
	priority?: ReminderPriority
}

export interface ReminderOccurrencePatch {
	title?: string
	notes?: string | null
	dueAt?: Date
	timeZone?: string
	priority?: ReminderPriority
}

export interface ReminderOccurrenceOverrideInput {
	reminderId: string
	occurrenceId: string
	originalDueAt: Date
	patch?: ReminderOccurrencePatch
	completedAt?: Date | null
	deletedAt?: Date | null
}

export interface ReminderOccurrenceOverride extends ReminderOccurrenceOverrideInput {
	createdAt?: Date
	updatedAt?: Date
}

export interface ReminderOccurrence {
	reminderId: string
	occurrenceId: string
	title: string
	notes: string | null
	originalDueAt: Date
	dueAt: Date
	timeZone: string
	recurrence: ReminderRecurrence | null
	priority: ReminderPriority
	completedAt: Date | null
}

export interface ReminderListParams {
	from: Date
	to: Date
	includeCompleted: boolean
}

export interface ReminderOccurrenceOverrideListParams {
	reminderIds: readonly string[]
	from: Date
	to: Date
}

/**
 * Storage adapters should return reminders that may produce occurrences in the
 * requested window. For recurring reminders this can include records whose
 * first dueAt is before `from`. Returning a superset is valid; ReminderSource
 * performs final recurrence expansion, override application, and filtering.
 */
export interface ReminderStorage {
	listReminders(params: ReminderListParams): Promise<Reminder[]>
	getReminder(id: string): Promise<Reminder | null>
	createReminder(input: CreateReminderInput): Promise<Reminder>
	updateReminder(id: string, patch: ReminderPatch): Promise<Reminder>
	deleteReminder(id: string): Promise<void>
	/**
	 * Return overrides whose originalDueAt or patched dueAt may affect the
	 * requested window. Returning a superset is valid.
	 */
	listOccurrenceOverrides(
		params: ReminderOccurrenceOverrideListParams,
	): Promise<ReminderOccurrenceOverride[]>
	getOccurrenceOverride(
		reminderId: string,
		occurrenceId: string,
	): Promise<ReminderOccurrenceOverride | null>
	upsertOccurrenceOverride(
		input: ReminderOccurrenceOverrideInput,
	): Promise<ReminderOccurrenceOverride>
	deleteOccurrenceOverride(reminderId: string, occurrenceId: string): Promise<void>
	subscribe?(callback: () => void): () => void
}

export interface UpdateReminderInput {
	reminderId: string
	scope: ReminderEditScope
	occurrenceDueAt?: Date
	patch: ReminderPatch
}

export interface DeleteReminderInput {
	reminderId: string
	scope: ReminderEditScope
	occurrenceDueAt?: Date
}

export interface CompleteReminderInput {
	reminderId: string
	occurrenceDueAt: Date
	completedAt?: Date
}

export interface UncompleteReminderInput {
	reminderId: string
	occurrenceDueAt: Date
}

export type ReminderUpdateResult =
	| {
			type: typeof ReminderUpdateResultType.UpdatedReminder
			reminder: Reminder
	  }
	| {
			type: typeof ReminderUpdateResultType.UpdatedOccurrence
			override: ReminderOccurrenceOverride
	  }
	| {
			type: typeof ReminderUpdateResultType.SplitReminder
			previousReminder: Reminder
			newReminder: Reminder
	  }

export type ReminderDeleteResult =
	| {
			type: typeof ReminderDeleteResultType.DeletedReminder
	  }
	| {
			type: typeof ReminderDeleteResultType.DeletedOccurrence
			override: ReminderOccurrenceOverride
	  }
	| {
			type: typeof ReminderDeleteResultType.EndedReminder
			reminder: Reminder
	  }

export const ReminderFeedItemType = {
	Reminder: "reminder",
} as const

export type ReminderFeedItemType = (typeof ReminderFeedItemType)[keyof typeof ReminderFeedItemType]

export interface ReminderOccurrenceData extends Record<string, unknown> {
	reminderId: string
	occurrenceId: string
	title: string
	notes: string | null
	originalDueAt: Date
	dueAt: Date
	timeZone: string
	recurrence: ReminderRecurrence | null
	priority: ReminderPriority
	completedAt: Date | null
}

export type ReminderFeedItem = FeedItem<
	typeof ReminderFeedItemType.Reminder,
	ReminderOccurrenceData
>
