import { describe, expect, test } from "bun:test"

import type { Reminder } from "./types.ts"

import { expandReminderOriginalDueAts, findReminderOccurrenceIndex } from "./recurrence.ts"
import { ReminderPriority, ReminderRecurrenceFrequency, ReminderWeekday } from "./types.ts"

describe("recurrence", () => {
	test("deduplicates weekly weekdays before applying recurrence count", () => {
		const reminder = weeklyReminder({
			recurrence: {
				frequency: ReminderRecurrenceFrequency.Weekly,
				interval: 1,
				weekdays: [ReminderWeekday.Monday, ReminderWeekday.Monday, ReminderWeekday.Wednesday],
				count: 3,
			},
		})

		const originalDueAts = expandReminderOriginalDueAts(
			reminder,
			new Date("2026-06-08T00:00:00Z"),
			new Date("2026-06-22T00:00:00Z"),
		)

		expect(originalDueAts.map(toIsoString)).toEqual([
			"2026-06-08T09:00:00.000Z",
			"2026-06-10T09:00:00.000Z",
			"2026-06-15T09:00:00.000Z",
		])
	})

	test("deduplicates weekly weekdays before calculating occurrence indexes", () => {
		const reminder = weeklyReminder({
			recurrence: {
				frequency: ReminderRecurrenceFrequency.Weekly,
				interval: 1,
				weekdays: [ReminderWeekday.Monday, ReminderWeekday.Monday, ReminderWeekday.Wednesday],
			},
		})

		expect(findReminderOccurrenceIndex(reminder, new Date("2026-06-10T09:00:00Z"))).toBe(1)
		expect(findReminderOccurrenceIndex(reminder, new Date("2026-06-15T09:00:00Z"))).toBe(2)
	})
})

function weeklyReminder(overrides: Partial<Reminder> = {}): Reminder {
	const now = new Date("2026-06-01T00:00:00Z")
	return {
		id: "r1",
		title: "Take vitamins",
		notes: null,
		dueAt: new Date("2026-06-08T09:00:00Z"),
		timeZone: "UTC",
		recurrence: {
			frequency: ReminderRecurrenceFrequency.Weekly,
			interval: 1,
			weekdays: [ReminderWeekday.Monday],
		},
		priority: ReminderPriority.Normal,
		createdAt: now,
		updatedAt: now,
		...overrides,
	}
}

function toIsoString(date: Date): string {
	return date.toISOString()
}
