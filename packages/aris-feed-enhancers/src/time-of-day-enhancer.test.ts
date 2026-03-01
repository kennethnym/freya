import type { Context, FeedItem, FeedItemSignals } from "@aris/core"

import { TimeRelevance } from "@aris/core"
import { CalDavFeedItemType } from "@aris/source-caldav"
import { CalendarFeedItemType } from "@aris/source-google-calendar"
import { TflFeedItemType } from "@aris/source-tfl"
import { WeatherFeedItemType } from "@aris/source-weatherkit"
import { describe, expect, test } from "bun:test"

import {
	createTimeOfDayEnhancer,
	getTimePeriod,
	getDayType,
	TimePeriod,
	DayType,
} from "./time-of-day-enhancer"

// =============================================================================
// Helpers
// =============================================================================

function makeContext(date: Date): Context {
	return { time: date }
}

function makeDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
	return new Date(year, month - 1, day, hour, minute, 0, 0)
}

/** Tuesday 2025-07-08 at given hour:minute */
function tuesday(hour: number, minute = 0): Date {
	return makeDate(2025, 7, 8, hour, minute)
}

/** Saturday 2025-07-12 at given hour:minute */
function saturday(hour: number, minute = 0): Date {
	return makeDate(2025, 7, 12, hour, minute)
}

function weatherCurrent(id = "w-current"): FeedItem {
	return {
		id,
		type: WeatherFeedItemType.Current,
		timestamp: new Date(),
		data: { temperature: 18, precipitationIntensity: 0 },
	}
}

function weatherCurrentRainy(id = "w-current-rain"): FeedItem {
	return {
		id,
		type: WeatherFeedItemType.Current,
		timestamp: new Date(),
		data: { temperature: 12, precipitationIntensity: 2.5 },
	}
}

function weatherCurrentExtreme(id = "w-current-extreme"): FeedItem {
	return {
		id,
		type: WeatherFeedItemType.Current,
		timestamp: new Date(),
		data: { temperature: -5, precipitationIntensity: 0 },
	}
}

function weatherHourly(id = "w-hourly"): FeedItem {
	return {
		id,
		type: WeatherFeedItemType.Hourly,
		timestamp: new Date(),
		data: { forecastTime: new Date(), temperature: 20 },
	}
}

function weatherDaily(id = "w-daily"): FeedItem {
	return {
		id,
		type: WeatherFeedItemType.Daily,
		timestamp: new Date(),
		data: { forecastDate: new Date() },
	}
}

function weatherAlert(id = "w-alert", urgency = 0.9): FeedItem {
	return {
		id,
		type: WeatherFeedItemType.Alert,
		timestamp: new Date(),
		data: { severity: "extreme" },
		signals: { urgency, timeRelevance: TimeRelevance.Imminent },
	}
}

function calendarEvent(
	id: string,
	startTime: Date,
	options: { location?: string; signals?: FeedItemSignals } = {},
): FeedItem {
	return {
		id,
		type: CalendarFeedItemType.Event,
		timestamp: new Date(),
		data: {
			eventId: id,
			calendarId: "primary",
			title: `Event ${id}`,
			description: null,
			location: options.location ?? null,
			startTime,
			endTime: new Date(startTime.getTime() + 3_600_000),
			isAllDay: false,
			status: "confirmed",
			htmlLink: "",
		},
		signals: options.signals,
	}
}

function calendarAllDay(id: string): FeedItem {
	return {
		id,
		type: CalendarFeedItemType.AllDay,
		timestamp: new Date(),
		data: {
			eventId: id,
			calendarId: "primary",
			title: `All Day ${id}`,
			description: null,
			location: null,
			startTime: new Date(),
			endTime: new Date(),
			isAllDay: true,
			status: "confirmed",
			htmlLink: "",
		},
		signals: { timeRelevance: TimeRelevance.Ambient },
	}
}

function caldavEvent(
	id: string,
	startDate: Date,
	options: { location?: string; signals?: FeedItemSignals } = {},
): FeedItem {
	return {
		id,
		type: CalDavFeedItemType.Event,
		timestamp: new Date(),
		data: {
			uid: id,
			title: `CalDAV ${id}`,
			startDate,
			endDate: new Date(startDate.getTime() + 3_600_000),
			isAllDay: false,
			location: options.location ?? null,
			description: null,
			calendarName: null,
			status: "confirmed",
			url: null,
			organizer: null,
			attendees: [],
			alarms: [],
			recurrenceId: null,
		},
		signals: options.signals,
	}
}

function tflAlert(id = "tfl-1", urgency = 0.8): FeedItem {
	return {
		id,
		type: TflFeedItemType.Alert,
		timestamp: new Date(),
		data: {
			line: "northern",
			lineName: "Northern",
			severity: "major-delays",
			description: "Delays",
		},
		signals: { urgency, timeRelevance: TimeRelevance.Imminent },
	}
}

function unknownItem(id = "unknown-1"): FeedItem {
	return {
		id,
		type: "some-future-type",
		timestamp: new Date(),
		data: { foo: "bar" },
	}
}

// =============================================================================
// Period detection
// =============================================================================

describe("getTimePeriod", () => {
	test("morning: 06:00–11:59", () => {
		expect(getTimePeriod(tuesday(6))).toBe(TimePeriod.Morning)
		expect(getTimePeriod(tuesday(8))).toBe(TimePeriod.Morning)
		expect(getTimePeriod(tuesday(11, 59))).toBe(TimePeriod.Morning)
	})

	test("afternoon: 12:00–16:59", () => {
		expect(getTimePeriod(tuesday(12))).toBe(TimePeriod.Afternoon)
		expect(getTimePeriod(tuesday(14))).toBe(TimePeriod.Afternoon)
		expect(getTimePeriod(tuesday(16, 59))).toBe(TimePeriod.Afternoon)
	})

	test("evening: 17:00–21:59", () => {
		expect(getTimePeriod(tuesday(17))).toBe(TimePeriod.Evening)
		expect(getTimePeriod(tuesday(19))).toBe(TimePeriod.Evening)
		expect(getTimePeriod(tuesday(21, 59))).toBe(TimePeriod.Evening)
	})

	test("night: 22:00–05:59", () => {
		expect(getTimePeriod(tuesday(22))).toBe(TimePeriod.Night)
		expect(getTimePeriod(tuesday(0))).toBe(TimePeriod.Night)
		expect(getTimePeriod(tuesday(3))).toBe(TimePeriod.Night)
		expect(getTimePeriod(tuesday(5, 59))).toBe(TimePeriod.Night)
	})
})

describe("getDayType", () => {
	test("weekday: Monday–Friday", () => {
		// 2025-07-07 is Monday, 2025-07-08 is Tuesday, 2025-07-11 is Friday
		expect(getDayType(makeDate(2025, 7, 7, 10))).toBe(DayType.Weekday)
		expect(getDayType(tuesday(10))).toBe(DayType.Weekday)
		expect(getDayType(makeDate(2025, 7, 11, 10))).toBe(DayType.Weekday)
	})

	test("weekend: Saturday–Sunday", () => {
		expect(getDayType(saturday(10))).toBe(DayType.Weekend)
		expect(getDayType(makeDate(2025, 7, 13, 10))).toBe(DayType.Weekend) // Sunday
	})
})

// =============================================================================
// Morning
// =============================================================================

describe("morning weekday", () => {
	const now = tuesday(8)
	const ctx = makeContext(now)

	test("boosts weather-current and weather-alert, demotes weather-hourly", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const items = [weatherCurrent(), weatherHourly(), weatherAlert()]
		const result = await enhancer(items, ctx)

		expect(result.boost!["w-current"]).toBeGreaterThan(0)
		expect(result.boost!["w-alert"]).toBeGreaterThan(0)
		expect(result.boost!["w-hourly"]).toBeLessThan(0)
	})

	test("boosts first calendar event of the day", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const event1 = calendarEvent("c1", tuesday(9))
		const event2 = calendarEvent("c2", tuesday(14))
		const result = await enhancer([event1, event2], ctx)

		expect(result.boost!["c1"]).toBeGreaterThan(0)
		// Second event should not get the first-event boost
		expect(result.boost?.["c2"] ?? 0).toBeLessThanOrEqual(0)
	})

	test("boosts TfL alerts", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const result = await enhancer([tflAlert()], ctx)

		expect(result.boost!["tfl-1"]).toBeGreaterThan(0)
	})
})

describe("morning weekend", () => {
	const now = saturday(9)
	const ctx = makeContext(now)

	test("boosts weather-current and weather-daily", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const items = [weatherCurrent(), weatherDaily()]
		const result = await enhancer(items, ctx)

		expect(result.boost!["w-current"]).toBeGreaterThan(0)
		expect(result.boost!["w-daily"]).toBeGreaterThan(0)
	})

	test("demotes calendar events and TfL alerts", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const event = calendarEvent("c1", saturday(10))
		const items = [event, tflAlert()]
		const result = await enhancer(items, ctx)

		expect(result.boost!["c1"]).toBeLessThan(0)
		expect(result.boost!["tfl-1"]).toBeLessThan(0)
	})
})

// =============================================================================
// Afternoon
// =============================================================================

describe("afternoon weekday", () => {
	const now = tuesday(14)
	const ctx = makeContext(now)

	test("boosts imminent calendar events", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const event = calendarEvent("c1", tuesday(14, 10), {
			signals: { timeRelevance: TimeRelevance.Imminent },
		})
		const result = await enhancer([event], ctx)

		expect(result.boost!["c1"]).toBeGreaterThan(0)
	})

	test("demotes weather-current and weather-hourly", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const items = [weatherCurrent(), weatherHourly()]
		const result = await enhancer(items, ctx)

		expect(result.boost!["w-current"]).toBeLessThan(0)
		expect(result.boost!["w-hourly"]).toBeLessThan(0)
	})
})

describe("afternoon weekend", () => {
	const now = saturday(14)
	const ctx = makeContext(now)

	test("boosts weather-current, demotes calendar events", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const event = calendarEvent("c1", saturday(15))
		const items = [weatherCurrent(), event]
		const result = await enhancer(items, ctx)

		expect(result.boost!["w-current"]).toBeGreaterThan(0)
		expect(result.boost!["c1"]).toBeLessThan(0)
	})
})

// =============================================================================
// Evening
// =============================================================================

describe("evening weekday", () => {
	const now = tuesday(19)
	const ctx = makeContext(now)

	test("suppresses ambient work calendar events", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const event = calendarEvent("c1", tuesday(9), {
			signals: { timeRelevance: TimeRelevance.Ambient },
		})
		const result = await enhancer([event], ctx)

		expect(result.suppress).toContain("c1")
	})

	test("demotes TfL alerts", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const result = await enhancer([tflAlert()], ctx)

		expect(result.boost!["tfl-1"]).toBeLessThan(0)
	})

	test("boosts weather-daily and all-day calendar events", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const items = [weatherDaily(), calendarAllDay("ad1")]
		const result = await enhancer(items, ctx)

		expect(result.boost!["w-daily"]).toBeGreaterThan(0)
		expect(result.boost!["ad1"]).toBeGreaterThan(0)
	})
})

describe("evening weekend", () => {
	const now = saturday(19)
	const ctx = makeContext(now)

	test("boosts weather-current, suppresses ambient calendar events", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const event = calendarEvent("c1", saturday(9), {
			signals: { timeRelevance: TimeRelevance.Ambient },
		})
		const items = [weatherCurrent(), event]
		const result = await enhancer(items, ctx)

		expect(result.boost!["w-current"]).toBeGreaterThan(0)
		expect(result.suppress).toContain("c1")
	})

	test("demotes TfL alerts more aggressively", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const result = await enhancer([tflAlert()], ctx)

		expect(result.boost!["tfl-1"]).toBeLessThan(-0.3)
	})
})

// =============================================================================
// Night
// =============================================================================

describe("night", () => {
	const now = tuesday(23)
	const ctx = makeContext(now)

	test("suppresses ambient items", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const event = calendarEvent("c1", tuesday(9), {
			signals: { timeRelevance: TimeRelevance.Ambient },
		})
		const result = await enhancer([event], ctx)

		expect(result.suppress).toContain("c1")
	})

	test("demotes calendar events and weather-current", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const event = calendarEvent("c1", makeDate(2025, 7, 9, 9)) // tomorrow
		const items = [event, weatherCurrent()]
		const result = await enhancer(items, ctx)

		expect(result.boost!["c1"]).toBeLessThan(0)
		expect(result.boost!["w-current"]).toBeLessThan(0)
	})

	test("high-urgency alerts survive unboosted", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const alert = weatherAlert("w-alert", 0.9)
		const result = await enhancer([alert], ctx)

		// Should not be demoted — either no boost entry or >= 0
		const alertBoost = result.boost?.["w-alert"] ?? 0
		expect(alertBoost).toBeGreaterThanOrEqual(0)
	})
})

// =============================================================================
// Pre-meeting window
// =============================================================================

describe("pre-meeting window", () => {
	test("boosts upcoming meeting to +0.9", async () => {
		const now = tuesday(9, 45)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const meeting = calendarEvent("c1", tuesday(10))
		const result = await enhancer([meeting], makeContext(now))

		expect(result.boost!["c1"]).toBe(0.9)
	})

	test("suppresses low-urgency items during pre-meeting", async () => {
		const now = tuesday(9, 45)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const meeting = calendarEvent("c1", tuesday(10))
		const lowPriority = weatherHourly()
		lowPriority.signals = { urgency: 0.1 }
		const result = await enhancer([meeting, lowPriority], makeContext(now))

		expect(result.suppress).toContain("w-hourly")
	})

	test("does not suppress items without signals during pre-meeting", async () => {
		const now = tuesday(9, 45)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const meeting = calendarEvent("c1", tuesday(10))
		const noSignals = weatherDaily()
		const result = await enhancer([meeting, noSignals], makeContext(now))

		expect(result.suppress ?? []).not.toContain("w-daily")
	})

	test("boosts TfL alerts during pre-meeting", async () => {
		const now = tuesday(9, 45)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const meeting = calendarEvent("c1", tuesday(10))
		const result = await enhancer([meeting, tflAlert()], makeContext(now))

		expect(result.boost!["tfl-1"]).toBeGreaterThan(0)
	})

	test("boosts weather-current if meeting has a location", async () => {
		const now = tuesday(9, 45)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const meeting = calendarEvent("c1", tuesday(10), { location: "Office, London" })
		const result = await enhancer([meeting, weatherCurrent()], makeContext(now))

		expect(result.boost!["w-current"]).toBeGreaterThan(0)
	})

	test("works with CalDAV events", async () => {
		const now = tuesday(9, 45)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const meeting = caldavEvent("cd1", tuesday(10))
		const result = await enhancer([meeting], makeContext(now))

		expect(result.boost!["cd1"]).toBe(0.9)
	})

	test("does not trigger for events more than 30 minutes away", async () => {
		const now = tuesday(9)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const meeting = calendarEvent("c1", tuesday(10))
		const result = await enhancer([meeting], makeContext(now))

		// Should not get the +0.9 pre-meeting boost
		expect(result.boost?.["c1"] ?? 0).not.toBe(0.9)
	})
})

// =============================================================================
// Wind-down gradient
// =============================================================================

describe("wind-down gradient", () => {
	test("20:00 weekday: additional -0.1 on work items", async () => {
		const now = tuesday(20)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		// Non-ambient calendar event — evening rules don't boost or suppress it,
		// so the only demotion comes from wind-down at 20:00 (-0.1).
		const event = calendarEvent("c1", makeDate(2025, 7, 9, 9))
		const result = await enhancer([event], makeContext(now))

		expect(result.boost!["c1"]).toBe(-0.1)
	})

	test("21:00 weekday: additional -0.2 on work items", async () => {
		const now = tuesday(21)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const alert = tflAlert("tfl-1", 0.5)
		const result = await enhancer([alert], makeContext(now))

		// Evening demotes TfL by -0.4, wind-down adds -0.2 = -0.6
		expect(result.boost!["tfl-1"]).toBeLessThanOrEqual(-0.6)
	})

	test("21:30 weekday: additional -0.3 on work items", async () => {
		const now = tuesday(21, 30)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const alert = tflAlert("tfl-1", 0.5)
		const result = await enhancer([alert], makeContext(now))

		// Evening demotes TfL by -0.4, wind-down adds -0.3 = -0.7
		expect(result.boost!["tfl-1"]).toBeLessThanOrEqual(-0.7)
	})

	test("does not apply on weekends", async () => {
		const now = saturday(21)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const alert = tflAlert("tfl-1", 0.5)
		const result = await enhancer([alert], makeContext(now))

		// Weekend evening demotes TfL by -0.5, but no wind-down
		expect(result.boost!["tfl-1"]).toBe(-0.5)
	})
})

// =============================================================================
// Transition lookahead
// =============================================================================

describe("transition lookahead", () => {
	test("Saturday 11:40 boosts afternoon-relevant weather-current", async () => {
		const now = saturday(11, 40)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const items = [weatherCurrent()]
		const result = await enhancer(items, makeContext(now))

		// Weekend morning boosts weather-current by +0.5.
		// Transition to afternoon adds +0.2 (weekend afternoon boosts weather-current).
		expect(result.boost!["w-current"]).toBe(0.7)
	})

	test("16:40 weekday boosts evening-relevant items (weather-daily)", async () => {
		const now = tuesday(16, 40)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const items = [weatherDaily()]
		const result = await enhancer(items, makeContext(now))

		// Afternoon weekday doesn't boost weather-daily, but transition to evening does (+0.2)
		expect(result.boost!["w-daily"]).toBeGreaterThan(0)
	})

	test("does not apply when far from boundary", async () => {
		const now = tuesday(14)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const items = [weatherDaily()]
		const result = await enhancer(items, makeContext(now))

		// Afternoon weekday doesn't boost or demote weather-daily, and no transition
		expect(result.boost?.["w-daily"]).toBeUndefined()
	})
})

// =============================================================================
// Weather-time correlation
// =============================================================================

describe("weather-time correlation", () => {
	test("morning weekday: extra boost for precipitation", async () => {
		const now = tuesday(8)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const rainy = weatherCurrentRainy()
		const dry = weatherCurrent("w-dry")
		const result = await enhancer([rainy, dry], makeContext(now))

		// Both get morning boost, but rainy gets extra +0.1
		expect(result.boost!["w-current-rain"]).toBeGreaterThan(result.boost!["w-dry"] ?? 0)
	})

	test("morning weekday: extra boost for extreme temperature", async () => {
		const now = tuesday(8)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const extreme = weatherCurrentExtreme()
		const normal = weatherCurrent("w-normal")
		const result = await enhancer([extreme, normal], makeContext(now))

		expect(result.boost!["w-current-extreme"]).toBeGreaterThan(result.boost!["w-normal"] ?? 0)
	})

	test("evening with location event: extra boost for weather-current", async () => {
		const now = tuesday(19)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const event = calendarEvent("c1", tuesday(19, 30), { location: "The Ivy, London" })
		const items = [weatherCurrent(), event]
		const result = await enhancer(items, makeContext(now))

		// Weather-current gets evening weather-time correlation boost (+0.2)
		// Note: evening weekday doesn't normally boost weather-current
		expect(result.boost!["w-current"]).toBeGreaterThan(0)
	})

	test("weather-alert always gets at least +0.5", async () => {
		const now = tuesday(14) // afternoon — no special weather boost
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const alert = weatherAlert("w-alert", 0.5)
		const result = await enhancer([alert], makeContext(now))

		expect(result.boost!["w-alert"]).toBeGreaterThanOrEqual(0.5)
	})
})

// =============================================================================
// Edge cases
// =============================================================================

describe("edge cases", () => {
	test("empty items returns empty enhancement", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => tuesday(8) })
		const result = await enhancer([], makeContext(tuesday(8)))

		expect(result).toEqual({})
	})

	test("unknown item types get no boost", async () => {
		const enhancer = createTimeOfDayEnhancer({ clock: () => tuesday(8) })
		const result = await enhancer([unknownItem()], makeContext(tuesday(8)))

		expect(result.boost?.["unknown-1"]).toBeUndefined()
		expect(result.suppress).toBeUndefined()
	})

	test("uses context.time when no clock provided", async () => {
		const enhancer = createTimeOfDayEnhancer()
		const morningCtx = makeContext(tuesday(8))
		const items = [weatherCurrent()]
		const result = await enhancer(items, morningCtx)

		// Should apply morning rules — weather-current boosted
		expect(result.boost!["w-current"]).toBeGreaterThan(0)
	})

	test("suppress list is deduplicated", async () => {
		// An item that would be suppressed by both evening rules and pre-meeting low-urgency
		const now = tuesday(19, 45)
		const enhancer = createTimeOfDayEnhancer({ clock: () => now })
		const meeting = calendarEvent("c1", tuesday(20))
		const ambientEvent = calendarEvent("c2", tuesday(9), {
			signals: { urgency: 0.1, timeRelevance: TimeRelevance.Ambient },
		})
		const result = await enhancer([meeting, ambientEvent], makeContext(now))

		if (result.suppress) {
			const c2Count = result.suppress.filter((id) => id === "c2").length
			expect(c2Count).toBeLessThanOrEqual(1)
		}
	})
})
