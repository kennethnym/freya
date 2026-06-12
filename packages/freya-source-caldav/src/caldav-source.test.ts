import type { ContextEntry } from "@freya/core"

import { Context, TimeRelevance } from "@freya/core"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type {
	CalDavDAVCalendar,
	CalDavDAVClient,
	CalDavDAVObject,
	CalDavEventData,
} from "./types.ts"

import { CalDavSource, computeSignals } from "./caldav-source.ts"
import { CalDavCalendarKey, type CalendarContext } from "./calendar-context.ts"

function loadFixture(name: string): string {
	return readFileSync(join(import.meta.dir, "..", "fixtures", name), "utf-8")
}

function createContext(time: Date): Context {
	return new Context(time)
}

/** Extract the CalendarContext value from fetchContext entries. */
function extractCalendar(entries: readonly ContextEntry[] | null): CalendarContext | undefined {
	if (!entries) return undefined
	const entry = entries.find(([key]) => key === CalDavCalendarKey)
	return entry?.[1] as CalendarContext | undefined
}

class MockDAVClient implements CalDavDAVClient {
	credentials: Record<string, unknown> = {}
	fetchCalendarsCallCount = 0
	lastTimeRange: { start: string; end: string } | null = null
	private calendars: CalDavDAVCalendar[]
	private objectsByCalendarUrl: Record<string, CalDavDAVObject[]>

	constructor(
		calendars: CalDavDAVCalendar[],
		objectsByCalendarUrl: Record<string, CalDavDAVObject[]>,
	) {
		this.calendars = calendars
		this.objectsByCalendarUrl = objectsByCalendarUrl
	}

	async login(): Promise<void> {}

	async fetchCalendars(): Promise<CalDavDAVCalendar[]> {
		this.fetchCalendarsCallCount++
		return this.calendars
	}

	async fetchCalendarObjects(params: {
		calendar: CalDavDAVCalendar
		timeRange: { start: string; end: string }
	}): Promise<CalDavDAVObject[]> {
		this.lastTimeRange = params.timeRange
		return this.objectsByCalendarUrl[params.calendar.url] ?? []
	}
}

function createSource(client: MockDAVClient, lookAheadDays?: number): CalDavSource {
	return new CalDavSource({
		serverUrl: "https://caldav.example.com",
		authMethod: "basic",
		username: "user",
		password: "pass",
		davClient: client,
		lookAheadDays,
	})
}

describe("CalDavSource", () => {
	test("has correct id", () => {
		const client = new MockDAVClient([], {})
		const source = createSource(client)
		expect(source.id).toBe("freya.caldav")
	})

	test("returns empty array when no calendars exist", async () => {
		const client = new MockDAVClient([], {})
		const source = createSource(client)
		const items = await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))
		expect(items).toEqual([])
	})

	test("returns feed items from a single calendar", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		const items = await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))

		expect(items).toHaveLength(1)
		expect(items[0]!.type).toBe("caldav-event")
		expect(items[0]!.id).toBe("caldav-event-single-event-001@test")
		expect(items[0]!.data.title).toBe("Team Standup")
		expect(items[0]!.data.location).toBe("Conference Room A")
		expect(items[0]!.data.calendarName).toBe("Work")
		expect(items[0]!.data.attendees).toHaveLength(2)
		expect(items[0]!.data.alarms).toHaveLength(2)
	})

	test("returns feed items from multiple calendars", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
			"/cal/personal": [
				{
					url: "/cal/personal/event2.ics",
					data: loadFixture("all-day-event.ics"),
				},
			],
		}
		const client = new MockDAVClient(
			[
				{ url: "/cal/work", displayName: "Work" },
				{ url: "/cal/personal", displayName: "Personal" },
			],
			objects,
		)
		const source = createSource(client)

		const items = await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))

		expect(items).toHaveLength(2)

		const standup = items.find((i) => i.data.title === "Team Standup")
		const holiday = items.find((i) => i.data.title === "Company Holiday")

		expect(standup).toBeDefined()
		expect(standup!.data.calendarName).toBe("Work")

		expect(holiday).toBeDefined()
		expect(holiday!.data.calendarName).toBe("Personal")
		expect(holiday!.data.isAllDay).toBe(true)
	})

	test("skips objects with non-string data", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [
				{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") },
				{ url: "/cal/work/bad.ics", data: 12345 },
				{ url: "/cal/work/empty.ics" },
			],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		const items = await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))
		expect(items).toHaveLength(1)
		expect(items[0]!.data.title).toBe("Team Standup")
	})

	test("uses context time as feed item timestamp", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		const now = new Date("2026-01-15T12:00:00Z")
		const items = await source.fetchItems(createContext(now))
		expect(items[0]!.timestamp).toEqual(now)
	})

	test("assigns signals based on event proximity", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [
				{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") },
				{ url: "/cal/work/allday.ics", data: loadFixture("all-day-event.ics") },
			],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		// 2 hours before the event at 14:00
		const items = await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))

		const standup = items.find((i) => i.data.title === "Team Standup")
		const holiday = items.find((i) => i.data.title === "Company Holiday")

		expect(standup!.signals!.urgency).toBe(0.7) // within 2 hours
		expect(standup!.signals!.timeRelevance).toBe(TimeRelevance.Upcoming)
		expect(holiday!.signals!.urgency).toBe(0.3) // all-day
		expect(holiday!.signals!.timeRelevance).toBe(TimeRelevance.Ambient)
	})

	test("handles calendar with non-string displayName", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/weird": [
				{
					url: "/cal/weird/event1.ics",
					data: loadFixture("minimal-event.ics"),
				},
			],
		}
		const client = new MockDAVClient(
			[{ url: "/cal/weird", displayName: { _cdata: "Weird Calendar" } }],
			objects,
		)
		const source = createSource(client)

		const items = await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))
		expect(items[0]!.data.calendarName).toBeNull()
	})

	test("expands recurring events within the time range", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [
				{
					url: "/cal/work/recurring.ics",
					data: loadFixture("recurring-event.ics"),
				},
			],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		// lookAheadDays=0 → range is Jan 15 only
		const source = createSource(client)

		const items = await source.fetchItems(createContext(new Date("2026-01-15T08:00:00Z")))

		// Only the Jan 15 occurrence falls in the single-day window
		expect(items).toHaveLength(1)
		expect(items[0]!.data.title).toBe("Weekly Sync")
		expect(items[0]!.data.startDate).toEqual(new Date("2026-01-15T09:00:00Z"))
	})

	test("includes exception overrides when they fall in range", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [
				{
					url: "/cal/work/recurring.ics",
					data: loadFixture("recurring-event.ics"),
				},
			],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		// lookAheadDays=8 → range covers Jan 15 through Jan 23, includes the Jan 22 exception
		const source = createSource(client, 8)

		const items = await source.fetchItems(createContext(new Date("2026-01-15T08:00:00Z")))

		const base = items.filter((i) => i.data.title === "Weekly Sync")
		const exception = items.find((i) => i.data.title === "Weekly Sync (moved)")

		// Jan 15 base occurrence
		expect(base.length).toBeGreaterThanOrEqual(1)

		// Jan 22 exception replaces the base occurrence
		expect(exception).toBeDefined()
		expect(exception!.data.startDate).toEqual(new Date("2026-01-22T10:00:00Z"))
		expect(exception!.data.endDate).toEqual(new Date("2026-01-22T10:30:00Z"))
	})

	test("caches events within the same refresh cycle", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		const context = createContext(new Date("2026-01-15T12:00:00Z"))

		await source.fetchContext(context)
		await source.fetchItems(context)

		// Same context.time reference — fetchEvents should only hit the client once
		expect(client.fetchCalendarsCallCount).toBe(1)
	})

	test("uses timezone for time range when provided", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)

		// 2026-01-15T22:00:00Z = 2026-01-16T09:00:00 in Australia/Sydney (AEDT, UTC+11)
		const source = new CalDavSource({
			serverUrl: "https://caldav.example.com",
			authMethod: "basic",
			username: "user",
			password: "pass",
			davClient: client,
			timeZone: "Australia/Sydney",
		})

		await source.fetchItems(createContext(new Date("2026-01-15T22:00:00Z")))

		// "Today" in Sydney is Jan 16, so start should be Jan 15 13:00 UTC (midnight Jan 16 AEDT)
		expect(client.lastTimeRange).not.toBeNull()
		expect(client.lastTimeRange!.start).toBe("2026-01-15T13:00:00.000Z")
		// End should be Jan 16 13:00 UTC (midnight Jan 17 AEDT) — 1 day window
		expect(client.lastTimeRange!.end).toBe("2026-01-16T13:00:00.000Z")
	})

	test("defaults to UTC midnight when no timezone provided", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		await source.fetchItems(createContext(new Date("2026-01-15T22:00:00Z")))

		expect(client.lastTimeRange).not.toBeNull()
		expect(client.lastTimeRange!.start).toBe("2026-01-15T00:00:00.000Z")
		expect(client.lastTimeRange!.end).toBe("2026-01-16T00:00:00.000Z")
	})

	test("refetches events for a different context time", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))
		await source.fetchItems(createContext(new Date("2026-01-15T13:00:00Z")))

		// Different context.time references — should fetch twice
		expect(client.fetchCalendarsCallCount).toBe(2)
	})
})

describe("CalDavSource.fetchContext", () => {
	test("returns empty context when no calendars exist", async () => {
		const client = new MockDAVClient([], {})
		const source = createSource(client)
		const entries = await source.fetchContext(createContext(new Date("2026-01-15T12:00:00Z")))
		const calendar = extractCalendar(entries)

		expect(calendar).toBeDefined()
		expect(calendar!.inProgress).toEqual([])
		expect(calendar!.nextEvent).toBeNull()
		expect(calendar!.hasTodayEvents).toBe(false)
		expect(calendar!.todayEventCount).toBe(0)
	})

	test("identifies in-progress events", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		// 14:30 is during the 14:00-15:00 event
		const entries = await source.fetchContext(createContext(new Date("2026-01-15T14:30:00Z")))
		const calendar = extractCalendar(entries)

		expect(calendar!.inProgress).toHaveLength(1)
		expect(calendar!.inProgress[0]!.title).toBe("Team Standup")
	})

	test("identifies next upcoming event", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		// 12:00 is before the 14:00 event
		const entries = await source.fetchContext(createContext(new Date("2026-01-15T12:00:00Z")))
		const calendar = extractCalendar(entries)

		expect(calendar!.inProgress).toHaveLength(0)
		expect(calendar!.nextEvent).not.toBeNull()
		expect(calendar!.nextEvent!.title).toBe("Team Standup")
	})

	test("excludes all-day events from inProgress and nextEvent", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/allday.ics", data: loadFixture("all-day-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		const entries = await source.fetchContext(createContext(new Date("2026-01-15T12:00:00Z")))
		const calendar = extractCalendar(entries)

		expect(calendar!.inProgress).toHaveLength(0)
		expect(calendar!.nextEvent).toBeNull()
		expect(calendar!.hasTodayEvents).toBe(true)
		expect(calendar!.todayEventCount).toBe(1)
	})

	test("counts all events including all-day in todayEventCount", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [
				{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") },
				{ url: "/cal/work/allday.ics", data: loadFixture("all-day-event.ics") },
			],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		const entries = await source.fetchContext(createContext(new Date("2026-01-15T12:00:00Z")))
		const calendar = extractCalendar(entries)

		expect(calendar!.todayEventCount).toBe(2)
		expect(calendar!.hasTodayEvents).toBe(true)
	})
})

describe("computeSignals", () => {
	const now = new Date("2026-01-15T12:00:00Z")

	function makeEvent(overrides: Partial<CalDavEventData>): CalDavEventData {
		return {
			uid: "test-uid",
			title: "Test",
			startDate: new Date("2026-01-15T14:00:00Z"),
			endDate: new Date("2026-01-15T15:00:00Z"),
			isAllDay: false,
			location: null,
			description: null,
			calendarName: null,
			status: null,
			url: null,
			organizer: null,
			attendees: [],
			alarms: [],
			recurrenceId: null,
			...overrides,
		}
	}

	test("all-day events get urgency 0.3 and ambient relevance", () => {
		const event = makeEvent({ isAllDay: true })
		const signals = computeSignals(event, now)
		expect(signals.urgency).toBe(0.3)
		expect(signals.timeRelevance).toBe(TimeRelevance.Ambient)
	})

	test("events starting within 30 minutes get urgency 0.9 and imminent relevance", () => {
		const event = makeEvent({
			startDate: new Date("2026-01-15T12:20:00Z"),
		})
		const signals = computeSignals(event, now)
		expect(signals.urgency).toBe(0.9)
		expect(signals.timeRelevance).toBe(TimeRelevance.Imminent)
	})

	test("events starting exactly at 30 minutes get urgency 0.9", () => {
		const event = makeEvent({
			startDate: new Date("2026-01-15T12:30:00Z"),
		})
		expect(computeSignals(event, now).urgency).toBe(0.9)
	})

	test("events starting within 2 hours get urgency 0.7 and upcoming relevance", () => {
		const event = makeEvent({
			startDate: new Date("2026-01-15T13:00:00Z"),
		})
		const signals = computeSignals(event, now)
		expect(signals.urgency).toBe(0.7)
		expect(signals.timeRelevance).toBe(TimeRelevance.Upcoming)
	})

	test("events later today get urgency 0.5", () => {
		const event = makeEvent({
			startDate: new Date("2026-01-15T20:00:00Z"),
		})
		expect(computeSignals(event, now).urgency).toBe(0.5)
	})

	test("in-progress events get urgency 0.8 and imminent relevance", () => {
		const event = makeEvent({
			startDate: new Date("2026-01-15T11:00:00Z"),
			endDate: new Date("2026-01-15T13:00:00Z"),
		})
		const signals = computeSignals(event, now)
		expect(signals.urgency).toBe(0.8)
		expect(signals.timeRelevance).toBe(TimeRelevance.Imminent)
	})

	test("fully past events get urgency 0.2 and ambient relevance", () => {
		const event = makeEvent({
			startDate: new Date("2026-01-15T09:00:00Z"),
			endDate: new Date("2026-01-15T10:00:00Z"),
		})
		const signals = computeSignals(event, now)
		expect(signals.urgency).toBe(0.2)
		expect(signals.timeRelevance).toBe(TimeRelevance.Ambient)
	})

	test("events on future days get urgency 0.2", () => {
		const event = makeEvent({
			startDate: new Date("2026-01-16T10:00:00Z"),
		})
		expect(computeSignals(event, now).urgency).toBe(0.2)
	})

	test("urgency boundaries are correct", () => {
		// 31 minutes from now should be 0.7 (within 2 hours, not within 30 min)
		const event31min = makeEvent({
			startDate: new Date("2026-01-15T12:31:00Z"),
		})
		expect(computeSignals(event31min, now).urgency).toBe(0.7)

		// 2 hours 1 minute from now should be 0.5 (later today, not within 2 hours)
		const event2h1m = makeEvent({
			startDate: new Date("2026-01-15T14:01:00Z"),
		})
		expect(computeSignals(event2h1m, now).urgency).toBe(0.5)
	})

	test("cancelled events get urgency 0.1 regardless of timing", () => {
		const event = makeEvent({
			status: "cancelled",
			startDate: new Date("2026-01-15T12:20:00Z"), // would be 0.9 if not cancelled
		})
		const signals = computeSignals(event, now)
		expect(signals.urgency).toBe(0.1)
		expect(signals.timeRelevance).toBe(TimeRelevance.Ambient)
	})

	test("uses timezone for 'later today' boundary", () => {
		// now = 2026-01-15T12:00:00Z = 2026-01-15T21:00:00 JST (UTC+9)
		// event at 2026-01-15T15:30:00Z = 2026-01-16T00:30:00 JST — next day in JST
		const event = makeEvent({
			startDate: new Date("2026-01-15T15:30:00Z"),
		})

		// Without timezone: UTC day ends at 2026-01-16T00:00:00Z, event is before that → "later today"
		expect(computeSignals(event, now).urgency).toBe(0.5)

		// With Asia/Tokyo: local day ends at 2026-01-15T15:00:00Z (midnight Jan 16 JST),
		// event is after that → "future days"
		expect(computeSignals(event, now, "Asia/Tokyo").urgency).toBe(0.2)
	})
})

describe("CalDavSource feed item slots", () => {
	const EXPECTED_SLOT_NAMES = ["insight", "preparation", "crossSource"]

	test("timed event has all three slots with null content", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/event1.ics", data: loadFixture("single-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		const items = await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))

		expect(items).toHaveLength(1)
		const item = items[0]!
		expect(item.slots).toBeDefined()
		expect(Object.keys(item.slots!).sort()).toEqual([...EXPECTED_SLOT_NAMES].sort())

		for (const name of EXPECTED_SLOT_NAMES) {
			const slot = item.slots![name]!
			expect(slot.content).toBeNull()
			expect(typeof slot.description).toBe("string")
			expect(slot.description.length).toBeGreaterThan(0)
		}
	})

	test("all-day event has all three slots with null content", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/allday.ics", data: loadFixture("all-day-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		const items = await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))

		expect(items).toHaveLength(1)
		const item = items[0]!
		expect(item.data.isAllDay).toBe(true)
		expect(item.slots).toBeDefined()
		expect(Object.keys(item.slots!).sort()).toEqual([...EXPECTED_SLOT_NAMES].sort())

		for (const name of EXPECTED_SLOT_NAMES) {
			expect(item.slots![name]!.content).toBeNull()
		}
	})

	test("cancelled event has all three slots with null content", async () => {
		const objects: Record<string, CalDavDAVObject[]> = {
			"/cal/work": [{ url: "/cal/work/cancelled.ics", data: loadFixture("cancelled-event.ics") }],
		}
		const client = new MockDAVClient([{ url: "/cal/work", displayName: "Work" }], objects)
		const source = createSource(client)

		const items = await source.fetchItems(createContext(new Date("2026-01-15T12:00:00Z")))

		expect(items).toHaveLength(1)
		const item = items[0]!
		expect(item.data.status).toBe("cancelled")
		expect(item.slots).toBeDefined()
		expect(Object.keys(item.slots!).sort()).toEqual([...EXPECTED_SLOT_NAMES].sort())

		for (const name of EXPECTED_SLOT_NAMES) {
			expect(item.slots![name]!.content).toBeNull()
		}
	})
})
