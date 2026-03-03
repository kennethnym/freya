import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { parseICalEvents } from "./ical-parser.ts"

function loadFixture(name: string): string {
	return readFileSync(join(import.meta.dir, "..", "fixtures", name), "utf-8")
}

describe("parseICalEvents", () => {
	test("parses a full event with all fields", () => {
		const events = parseICalEvents(loadFixture("single-event.ics"), "Work")

		expect(events).toHaveLength(1)
		const event = events[0]!

		expect(event.uid).toBe("single-event-001@test")
		expect(event.title).toBe("Team Standup")
		expect(event.startDate).toEqual(new Date("2026-01-15T14:00:00Z"))
		expect(event.endDate).toEqual(new Date("2026-01-15T15:00:00Z"))
		expect(event.isAllDay).toBe(false)
		expect(event.location).toBe("Conference Room A")
		expect(event.description).toBe("Daily standup meeting")
		expect(event.calendarName).toBe("Work")
		expect(event.status).toBe("confirmed")
		expect(event.url).toBe("https://example.com/meeting/123")
		expect(event.organizer).toBe("Alice Smith")
		expect(event.recurrenceId).toBeNull()

		expect(event.attendees).toHaveLength(2)
		expect(event.attendees[0]).toEqual({
			name: "Bob Jones",
			email: "bob@example.com",
			role: "required",
			status: "accepted",
		})
		expect(event.attendees[1]).toEqual({
			name: "Carol White",
			email: "carol@example.com",
			role: "optional",
			status: "tentative",
		})

		expect(event.alarms).toHaveLength(2)
		expect(event.alarms[0]).toEqual({ trigger: "-PT15M", action: "DISPLAY" })
		expect(event.alarms[1]).toEqual({ trigger: "-PT5M", action: "AUDIO" })
	})

	test("parses an all-day event with optional fields as null", () => {
		const events = parseICalEvents(loadFixture("all-day-event.ics"), null)

		expect(events).toHaveLength(1)
		const event = events[0]!

		expect(event.isAllDay).toBe(true)
		expect(event.title).toBe("Company Holiday")
		expect(event.calendarName).toBeNull()
		expect(event.location).toBeNull()
		expect(event.description).toBeNull()
		expect(event.url).toBeNull()
		expect(event.organizer).toBeNull()
		expect(event.attendees).toEqual([])
		expect(event.alarms).toEqual([])
	})

	test("parses recurring event with exception", () => {
		const events = parseICalEvents(loadFixture("recurring-event.ics"), "Team")

		expect(events).toHaveLength(2)
		expect(events[0]!.uid).toBe("recurring-001@test")
		expect(events[1]!.uid).toBe("recurring-001@test")

		const base = events.find((e) => e.title === "Weekly Sync")
		expect(base).toBeDefined()
		expect(base!.recurrenceId).toBeNull()

		const exception = events.find((e) => e.title === "Weekly Sync (moved)")
		expect(exception).toBeDefined()
		expect(exception!.recurrenceId).not.toBeNull()
	})

	test("parses minimal event with defaults", () => {
		const events = parseICalEvents(loadFixture("minimal-event.ics"), null)

		expect(events).toHaveLength(1)
		const event = events[0]!

		expect(event.uid).toBe("minimal-001@test")
		expect(event.title).toBe("Quick Chat")
		expect(event.startDate).toEqual(new Date("2026-01-15T18:00:00Z"))
		expect(event.endDate).toEqual(new Date("2026-01-15T19:00:00Z"))
		expect(event.location).toBeNull()
		expect(event.description).toBeNull()
		expect(event.status).toBeNull()
		expect(event.url).toBeNull()
		expect(event.organizer).toBeNull()
		expect(event.attendees).toEqual([])
		expect(event.alarms).toEqual([])
		expect(event.recurrenceId).toBeNull()
	})

	test("parses cancelled status", () => {
		const events = parseICalEvents(loadFixture("cancelled-event.ics"), null)
		expect(events[0]!.status).toBe("cancelled")
	})
})

describe("parseICalEvents with timeRange (recurrence expansion)", () => {
	test("expands weekly recurring event into occurrences within range", () => {
		// weekly-recurring.ics: DTSTART 2026-01-01 (Thu), FREQ=WEEKLY;BYDAY=TH;COUNT=10
		// Occurrences: Jan 1, 8, 15, 22, 29, Feb 5, 12, 19, 26, Mar 5
		// Query window: Jan 14 – Jan 23 → should get Jan 15 and Jan 22
		const events = parseICalEvents(loadFixture("weekly-recurring.ics"), "Work", {
			start: new Date("2026-01-14T00:00:00Z"),
			end: new Date("2026-01-23T00:00:00Z"),
		})

		expect(events).toHaveLength(2)
		expect(events[0]!.startDate).toEqual(new Date("2026-01-15T10:00:00Z"))
		expect(events[0]!.endDate).toEqual(new Date("2026-01-15T11:00:00Z"))
		expect(events[1]!.startDate).toEqual(new Date("2026-01-22T10:00:00Z"))
		expect(events[1]!.endDate).toEqual(new Date("2026-01-22T11:00:00Z"))

		// All occurrences share the same UID and metadata
		for (const event of events) {
			expect(event.uid).toBe("weekly-001@test")
			expect(event.title).toBe("Weekly Team Meeting")
			expect(event.location).toBe("Room B")
			expect(event.calendarName).toBe("Work")
		}
	})

	test("returns empty array when no occurrences fall in range", () => {
		// Query window: Dec 2025 — before the first occurrence
		const events = parseICalEvents(loadFixture("weekly-recurring.ics"), null, {
			start: new Date("2025-12-01T00:00:00Z"),
			end: new Date("2025-12-31T00:00:00Z"),
		})

		expect(events).toHaveLength(0)
	})

	test("applies exception overrides during expansion", () => {
		// weekly-recurring-with-exception.ics:
		//   Master: DTSTART 2026-01-01 (Thu) 14:00, FREQ=WEEKLY;BYDAY=TH;COUNT=8
		//   Exception: RECURRENCE-ID 2026-01-15T14:00 → moved to 16:00-17:00, title changed
		// Query window: Jan 14 – Jan 16 → should get the exception occurrence for Jan 15
		const events = parseICalEvents(loadFixture("weekly-recurring-with-exception.ics"), "Work", {
			start: new Date("2026-01-14T00:00:00Z"),
			end: new Date("2026-01-16T00:00:00Z"),
		})

		expect(events).toHaveLength(1)
		expect(events[0]!.title).toBe("Standup (rescheduled)")
		expect(events[0]!.startDate).toEqual(new Date("2026-01-15T16:00:00Z"))
		expect(events[0]!.endDate).toEqual(new Date("2026-01-15T17:00:00Z"))
	})

	test("expands recurring all-day events", () => {
		// daily-recurring-allday.ics: DTSTART 2026-01-12, FREQ=DAILY;COUNT=7
		// Occurrences: Jan 12, 13, 14, 15, 16, 17, 18
		// Query window: Jan 14 – Jan 17 → should get Jan 14, 15, 16
		const events = parseICalEvents(loadFixture("daily-recurring-allday.ics"), null, {
			start: new Date("2026-01-14T00:00:00Z"),
			end: new Date("2026-01-17T00:00:00Z"),
		})

		expect(events).toHaveLength(3)
		for (const event of events) {
			expect(event.isAllDay).toBe(true)
			expect(event.title).toBe("Daily Reminder")
		}
	})

	test("non-recurring events are filtered by range", () => {
		// single-event.ics: 2026-01-15T14:00 – 15:00
		// Query window that includes it
		const included = parseICalEvents(loadFixture("single-event.ics"), null, {
			start: new Date("2026-01-15T00:00:00Z"),
			end: new Date("2026-01-16T00:00:00Z"),
		})
		expect(included).toHaveLength(1)

		// Query window that excludes it
		const excluded = parseICalEvents(loadFixture("single-event.ics"), null, {
			start: new Date("2026-01-16T00:00:00Z"),
			end: new Date("2026-01-17T00:00:00Z"),
		})
		expect(excluded).toHaveLength(0)
	})

	test("without timeRange, recurring events return raw VEVENTs (legacy)", () => {
		// Legacy behavior: no expansion, just returns the VEVENT components as-is
		const events = parseICalEvents(loadFixture("recurring-event.ics"), "Team")
		expect(events).toHaveLength(2)
	})
})
