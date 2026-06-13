import type {
	Reminder,
	ReminderOccurrence,
	ReminderOccurrenceOverride,
	ReminderOccurrencePatch,
	ReminderRecurrence,
	ReminderWeekday,
} from "./types.ts"

import { ReminderRecurrenceFrequency } from "./types.ts"

interface ZonedDateTimeParts {
	year: number
	month: number
	day: number
	hour: number
	minute: number
	second: number
	millisecond: number
}

interface ExpandReminderOccurrencesOptions {
	from: Date
	to: Date
	includeCompleted: boolean
	overrides?: readonly ReminderOccurrenceOverride[]
}

export function createReminderOccurrenceId(originalDueAt: Date): string {
	return originalDueAt.toISOString()
}

export function expandReminderOccurrences(
	reminder: Reminder,
	options: ExpandReminderOccurrencesOptions,
): ReminderOccurrence[] {
	const originalDueAts = new Map<string, Date>()
	for (const dueAt of expandReminderOriginalDueAts(reminder, options.from, options.to)) {
		originalDueAts.set(createReminderOccurrenceId(dueAt), dueAt)
	}

	const overrideById = new Map<string, ReminderOccurrenceOverride>()
	for (const override of options.overrides ?? []) {
		if (override.reminderId !== reminder.id) continue
		if (!isCurrentOriginalDueAt(reminder, override.originalDueAt)) continue
		overrideById.set(override.occurrenceId, override)
		originalDueAts.set(override.occurrenceId, override.originalDueAt)
	}

	const occurrences: ReminderOccurrence[] = []
	const originals = Array.from(originalDueAts.values()).sort(compareDates)

	for (const originalDueAt of originals) {
		const occurrenceId = createReminderOccurrenceId(originalDueAt)
		const override = overrideById.get(occurrenceId)
		if (override?.deletedAt) continue

		const occurrence = createOccurrence(reminder, originalDueAt, override)
		if (occurrence.dueAt < options.from || occurrence.dueAt > options.to) continue
		if (!options.includeCompleted && occurrence.completedAt) continue

		occurrences.push(occurrence)
	}

	return occurrences.sort(compareOccurrences)
}

export function expandReminderOriginalDueAts(reminder: Reminder, from: Date, to: Date): Date[] {
	if (to < reminder.dueAt) return []

	if (!reminder.recurrence) {
		return reminder.dueAt >= from && reminder.dueAt <= to ? [reminder.dueAt] : []
	}

	switch (reminder.recurrence.frequency) {
		case ReminderRecurrenceFrequency.Daily:
			return expandDaily(reminder, from, to)
		case ReminderRecurrenceFrequency.Weekly:
			return expandWeekly(reminder, from, to)
		case ReminderRecurrenceFrequency.Monthly:
			return expandMonthly(reminder, from, to)
		case ReminderRecurrenceFrequency.Yearly:
			return expandYearly(reminder, from, to)
	}
}

export function findReminderOccurrenceIndex(
	reminder: Reminder,
	occurrenceDueAt: Date,
): number | null {
	if (!reminder.recurrence) {
		return reminder.dueAt.getTime() === occurrenceDueAt.getTime() ? 0 : null
	}

	const originals = expandReminderOriginalDueAts(reminder, reminder.dueAt, occurrenceDueAt)
	for (let index = 0; index < originals.length; index++) {
		if (originals[index]!.getTime() === occurrenceDueAt.getTime()) {
			return index
		}
	}

	return null
}

function isCurrentOriginalDueAt(reminder: Reminder, originalDueAt: Date): boolean {
	return findReminderOccurrenceIndex(reminder, originalDueAt) !== null
}

export function stopRecurrenceAfterOccurrenceCount(
	recurrence: ReminderRecurrence,
	count: number,
): ReminderRecurrence | null {
	if (count <= 0) return null
	return { ...recurrence, count }
}

export function recurrenceAfterSplit(
	recurrence: ReminderRecurrence,
	occurrenceIndex: number,
): ReminderRecurrence | null {
	if (recurrence.count === undefined) {
		return { ...recurrence }
	}

	const remainingCount = recurrence.count - occurrenceIndex
	if (remainingCount <= 1) return null

	return { ...recurrence, count: remainingCount }
}

function expandDaily(reminder: Reminder, from: Date, to: Date): Date[] {
	return expandStepped(reminder, from, to, function addDaily(parts, step) {
		return addDays(parts, step)
	})
}

function expandMonthly(reminder: Reminder, from: Date, to: Date): Date[] {
	const anchor = getZonedParts(reminder.dueAt, reminder.timeZone).day
	return expandStepped(reminder, from, to, function addMonthly(parts, step) {
		return addMonths(parts, step, anchor)
	})
}

function expandYearly(reminder: Reminder, from: Date, to: Date): Date[] {
	const anchor = getZonedParts(reminder.dueAt, reminder.timeZone).day
	return expandStepped(reminder, from, to, function addYearly(parts, step) {
		return addMonths(parts, step * 12, anchor)
	})
}

function expandStepped(
	reminder: Reminder,
	from: Date,
	to: Date,
	addStep: (parts: ZonedDateTimeParts, step: number) => ZonedDateTimeParts,
): Date[] {
	const recurrence = reminder.recurrence
	if (!recurrence) return []

	const dates: Date[] = []
	const start = getZonedParts(reminder.dueAt, reminder.timeZone)
	let emitted = 0
	let index = 0

	while (true) {
		const parts = addStep(start, index * recurrence.interval)
		const dueAt = zonedPartsToDate(parts, reminder.timeZone)
		if (isAfterRecurrenceEnd(dueAt, recurrence, emitted)) break
		if (dueAt > to) break

		if (dueAt >= from) {
			dates.push(dueAt)
		}

		emitted++
		index++
	}

	return dates
}

function expandWeekly(reminder: Reminder, from: Date, to: Date): Date[] {
	const recurrence = reminder.recurrence
	if (!recurrence) return []

	const start = getZonedParts(reminder.dueAt, reminder.timeZone)
	const startWeekday = weekdayForParts(start)
	const weekStart = addDays(start, -startWeekday)
	const weekdays = recurrence.weekdays?.length
		? Array.from(new Set(recurrence.weekdays)).sort(compareNumbers)
		: [startWeekday as ReminderWeekday]

	const dates: Date[] = []
	let emitted = 0
	let weekIndex = 0

	while (true) {
		let weekHadFutureDate = false

		for (const weekday of weekdays) {
			const parts = addDays(weekStart, weekIndex * recurrence.interval * 7 + weekday)
			const dueAt = zonedPartsToDate(parts, reminder.timeZone)
			if (dueAt < reminder.dueAt) continue
			if (isAfterRecurrenceEnd(dueAt, recurrence, emitted)) return dates
			if (dueAt > to) {
				weekHadFutureDate = true
				continue
			}

			if (dueAt >= from) {
				dates.push(dueAt)
			}

			emitted++
		}

		if (weekHadFutureDate) break
		weekIndex++
	}

	return dates.sort(compareDates)
}

function createOccurrence(
	reminder: Reminder,
	originalDueAt: Date,
	override: ReminderOccurrenceOverride | undefined,
): ReminderOccurrence {
	const patch = override?.patch

	return {
		reminderId: reminder.id,
		occurrenceId: createReminderOccurrenceId(originalDueAt),
		title: patch?.title ?? reminder.title,
		notes: valueWithNullableOverride(reminder.notes, patch, "notes"),
		originalDueAt,
		dueAt: patch?.dueAt ?? originalDueAt,
		timeZone: patch?.timeZone ?? reminder.timeZone,
		recurrence: reminder.recurrence,
		priority: patch?.priority ?? reminder.priority,
		completedAt: override?.completedAt ?? null,
	}
}

function valueWithNullableOverride(
	fallback: string | null,
	patch: ReminderOccurrencePatch | undefined,
	key: "notes",
): string | null {
	if (!patch) return fallback
	if (Object.prototype.hasOwnProperty.call(patch, key)) {
		return patch[key] ?? null
	}
	return fallback
}

function isAfterRecurrenceEnd(
	dueAt: Date,
	recurrence: ReminderRecurrence,
	emittedCount: number,
): boolean {
	if (recurrence.count !== undefined && emittedCount >= recurrence.count) {
		return true
	}
	if (recurrence.until !== undefined && dueAt > recurrence.until) {
		return true
	}
	return false
}

function getZonedParts(date: Date, timeZone: string): ZonedDateTimeParts {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	})

	const parts = formatter.formatToParts(date)
	return {
		year: numberPart(parts, "year"),
		month: numberPart(parts, "month"),
		day: numberPart(parts, "day"),
		hour: numberPart(parts, "hour"),
		minute: numberPart(parts, "minute"),
		second: numberPart(parts, "second"),
		millisecond: date.getUTCMilliseconds(),
	}
}

function zonedPartsToDate(parts: ZonedDateTimeParts, timeZone: string): Date {
	const localAsUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
		parts.millisecond,
	)
	let timestamp = localAsUtc

	for (let i = 0; i < 3; i++) {
		const offset = getTimeZoneOffsetMs(new Date(timestamp), timeZone)
		const next = localAsUtc - offset
		if (next === timestamp) break
		timestamp = next
	}

	return new Date(timestamp)
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
	const parts = getZonedParts(date, timeZone)
	const zonedAsUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
		parts.millisecond,
	)

	return zonedAsUtc - date.getTime()
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
	const part = parts.find(function matchesType(value) {
		return value.type === type
	})
	if (!part) {
		throw new Error(`Missing ${type} part while formatting zoned date`)
	}
	return Number(part.value)
}

function addDays(parts: ZonedDateTimeParts, days: number): ZonedDateTimeParts {
	const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
	return {
		...parts,
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
	}
}

function addMonths(
	parts: ZonedDateTimeParts,
	months: number,
	anchorDay: number,
): ZonedDateTimeParts {
	const monthIndex = parts.year * 12 + parts.month - 1 + months
	const year = Math.floor(monthIndex / 12)
	const month = positiveModulo(monthIndex, 12) + 1
	const day = Math.min(anchorDay, daysInMonth(year, month))

	return {
		...parts,
		year,
		month,
		day,
	}
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function weekdayForParts(parts: ZonedDateTimeParts): number {
	return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

function positiveModulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor
}

function compareDates(a: Date, b: Date): number {
	return a.getTime() - b.getTime()
}

function compareNumbers(a: number, b: number): number {
	return a - b
}

function compareOccurrences(a: ReminderOccurrence, b: ReminderOccurrence): number {
	return a.dueAt.getTime() - b.dueAt.getTime()
}
