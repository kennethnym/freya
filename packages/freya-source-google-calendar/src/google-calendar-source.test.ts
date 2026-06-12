import { Context, TimeRelevance } from "@freya/core"
import { describe, expect, test } from "bun:test"

import type { ApiCalendarEvent, GoogleCalendarClient, ListEventsOptions } from "./types"

import fixture from "../fixtures/events.json"
import { NextEventKey, type NextEvent } from "./calendar-context"
import { CalendarFeedItemType } from "./feed-items"
import { GoogleCalendarSource } from "./google-calendar-source"

const NOW = new Date("2026-01-20T10:00:00Z")

function fixtureEvents(): ApiCalendarEvent[] {
	return fixture.items as unknown as ApiCalendarEvent[]
}

function createMockClient(
	eventsByCalendar: Record<string, ApiCalendarEvent[]>,
): GoogleCalendarClient {
	return {
		listCalendarIds: async () => Object.keys(eventsByCalendar),
		listEvents: async (options: ListEventsOptions) => {
			const events = eventsByCalendar[options.calendarId] ?? []
			return events.filter((e) => {
				const startRaw = e.start.dateTime ?? e.start.date ?? ""
				const endRaw = e.end.dateTime ?? e.end.date ?? ""
				return (
					new Date(startRaw).getTime() < options.timeMax.getTime() &&
					new Date(endRaw).getTime() > options.timeMin.getTime()
				)
			})
		},
	}
}

function defaultMockClient(): GoogleCalendarClient {
	return createMockClient({ primary: fixtureEvents() })
}

function createContext(time?: Date): Context {
	return new Context(time ?? NOW)
}

describe("GoogleCalendarSource", () => {
	describe("constructor", () => {
		test("has correct id", () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			expect(source.id).toBe("freya.google-calendar")
		})
	})

	describe("fetchItems", () => {
		test("returns empty array when no events", async () => {
			const source = new GoogleCalendarSource({
				client: createMockClient({ primary: [] }),
			})
			const items = await source.fetchItems(createContext())
			expect(items).toEqual([])
		})

		test("returns feed items for all events in window", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const items = await source.fetchItems(createContext())

			expect(items.length).toBe(fixture.items.length)
		})

		test("assigns calendar-event type to timed events", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const items = await source.fetchItems(createContext())

			const timedItems = items.filter((i) => i.type === CalendarFeedItemType.Event)
			expect(timedItems.length).toBe(4)
		})

		test("assigns calendar-all-day type to all-day events", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const items = await source.fetchItems(createContext())

			const allDayItems = items.filter((i) => i.type === CalendarFeedItemType.AllDay)
			expect(allDayItems.length).toBe(1)
		})

		test("ongoing events get highest urgency (1.0)", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const items = await source.fetchItems(createContext())

			const ongoing = items.find((i) => i.data.eventId === "evt-ongoing")
			expect(ongoing).toBeDefined()
			expect(ongoing!.signals!.urgency).toBe(1.0)
			expect(ongoing!.signals!.timeRelevance).toBe(TimeRelevance.Imminent)
		})

		test("upcoming events get higher urgency when sooner", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const items = await source.fetchItems(createContext())

			const soon = items.find((i) => i.data.eventId === "evt-soon")
			const later = items.find((i) => i.data.eventId === "evt-later")

			expect(soon).toBeDefined()
			expect(later).toBeDefined()
			expect(soon!.signals!.urgency).toBeGreaterThan(later!.signals!.urgency!)
		})

		test("all-day events get flat urgency (0.4)", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const items = await source.fetchItems(createContext())

			const allDay = items.find((i) => i.data.eventId === "evt-allday")
			expect(allDay).toBeDefined()
			expect(allDay!.signals!.urgency).toBe(0.4)
			expect(allDay!.signals!.timeRelevance).toBe(TimeRelevance.Ambient)
		})

		test("generates unique IDs for each item", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const items = await source.fetchItems(createContext())

			const ids = items.map((i) => i.id)
			const uniqueIds = new Set(ids)
			expect(uniqueIds.size).toBe(ids.length)
		})

		test("sets timestamp from context.time", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const items = await source.fetchItems(createContext())

			for (const item of items) {
				expect(item.timestamp).toEqual(NOW)
			}
		})

		test("respects lookaheadHours", async () => {
			// Only 2 hours lookahead from 10:00 → events before 12:00
			const source = new GoogleCalendarSource({
				client: defaultMockClient(),
				lookaheadHours: 2,
			})
			const items = await source.fetchItems(createContext())

			// Should include: ongoing (09:30-10:15), soon (10:10-10:40), allday (00:00-next day)
			// Should exclude: later (14:00), tentative lunch (12:00)
			const eventIds = items.map((i) => i.data.eventId)
			expect(eventIds).toContain("evt-ongoing")
			expect(eventIds).toContain("evt-soon")
			expect(eventIds).toContain("evt-allday")
			expect(eventIds).not.toContain("evt-later")
			expect(eventIds).not.toContain("evt-tentative")
		})

		test("defaults to all user calendars via listCalendarIds", async () => {
			const workEvent: ApiCalendarEvent = {
				id: "evt-work",
				status: "confirmed",
				htmlLink: "https://calendar.google.com/event?eid=evt-work",
				summary: "Work Meeting",
				start: { dateTime: "2026-01-20T11:00:00Z" },
				end: { dateTime: "2026-01-20T12:00:00Z" },
			}

			const client = createMockClient({
				primary: fixtureEvents(),
				"work@example.com": [workEvent],
			})

			// No calendarIds provided — should discover both calendars
			const source = new GoogleCalendarSource({ client })
			const items = await source.fetchItems(createContext())

			const eventIds = items.map((i) => i.data.eventId)
			expect(eventIds).toContain("evt-work")
			expect(eventIds).toContain("evt-ongoing")
		})

		test("fetches from explicit calendar IDs", async () => {
			const workEvent: ApiCalendarEvent = {
				id: "evt-work",
				status: "confirmed",
				htmlLink: "https://calendar.google.com/event?eid=evt-work",
				summary: "Work Meeting",
				start: { dateTime: "2026-01-20T11:00:00Z" },
				end: { dateTime: "2026-01-20T12:00:00Z" },
			}

			const client = createMockClient({
				primary: fixtureEvents(),
				"work@example.com": [workEvent],
			})

			const source = new GoogleCalendarSource({
				client,
				calendarIds: ["primary", "work@example.com"],
			})
			const items = await source.fetchItems(createContext())

			const eventIds = items.map((i) => i.data.eventId)
			expect(eventIds).toContain("evt-work")
			expect(eventIds).toContain("evt-ongoing")
		})
	})

	describe("fetchContext", () => {
		test("returns null when no events", async () => {
			const source = new GoogleCalendarSource({
				client: createMockClient({ primary: [] }),
			})
			const result = await source.fetchContext(createContext())
			expect(result).toBeNull()
		})

		test("returns null when only all-day events", async () => {
			const allDayOnly: ApiCalendarEvent[] = [
				{
					id: "evt-allday",
					status: "confirmed",
					htmlLink: "https://calendar.google.com/event?eid=evt-allday",
					summary: "Holiday",
					start: { date: "2026-01-20" },
					end: { date: "2026-01-21" },
				},
			]
			const source = new GoogleCalendarSource({
				client: createMockClient({ primary: allDayOnly }),
			})
			const result = await source.fetchContext(createContext())
			expect(result).toBeNull()
		})

		test("returns next upcoming timed event (not ongoing)", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const entries = await source.fetchContext(createContext())

			expect(entries).not.toBeNull()
			expect(entries).toHaveLength(1)
			const [key, nextEvent] = entries![0]! as [typeof NextEventKey, NextEvent]
			expect(key).toEqual(NextEventKey)
			// evt-soon starts at 10:10, which is the nearest future timed event
			expect(nextEvent.title).toBe("1:1 with Manager")
			expect(nextEvent.minutesUntilStart).toBe(10)
			expect(nextEvent.location).toBeNull()
		})

		test("includes location when available", async () => {
			const events: ApiCalendarEvent[] = [
				{
					id: "evt-loc",
					status: "confirmed",
					htmlLink: "https://calendar.google.com/event?eid=evt-loc",
					summary: "Offsite",
					location: "123 Main St",
					start: { dateTime: "2026-01-20T11:00:00Z" },
					end: { dateTime: "2026-01-20T12:00:00Z" },
				},
			]
			const source = new GoogleCalendarSource({
				client: createMockClient({ primary: events }),
			})
			const entries = await source.fetchContext(createContext())

			expect(entries).not.toBeNull()
			const [, nextEvent] = entries![0]! as [typeof NextEventKey, NextEvent]
			expect(nextEvent.location).toBe("123 Main St")
		})

		test("skips ongoing events for next-event context", async () => {
			const events: ApiCalendarEvent[] = [
				{
					id: "evt-now",
					status: "confirmed",
					htmlLink: "https://calendar.google.com/event?eid=evt-now",
					summary: "Current Meeting",
					start: { dateTime: "2026-01-20T09:30:00Z" },
					end: { dateTime: "2026-01-20T10:30:00Z" },
				},
			]
			const source = new GoogleCalendarSource({
				client: createMockClient({ primary: events }),
			})
			const result = await source.fetchContext(createContext())
			expect(result).toBeNull()
		})
	})

	describe("urgency ordering", () => {
		test("ongoing > upcoming > all-day", async () => {
			const source = new GoogleCalendarSource({ client: defaultMockClient() })
			const items = await source.fetchItems(createContext())

			const ongoing = items.find((i) => i.data.eventId === "evt-ongoing")!
			const upcoming = items.find((i) => i.data.eventId === "evt-soon")!
			const allDay = items.find((i) => i.data.eventId === "evt-allday")!

			expect(ongoing.signals!.urgency).toBeGreaterThan(upcoming.signals!.urgency!)
			expect(upcoming.signals!.urgency).toBeGreaterThan(allDay.signals!.urgency!)
		})
	})
})
