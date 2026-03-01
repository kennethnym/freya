import type { Context, FeedEnhancement, FeedItem, FeedPostProcessor } from "@aris/core"

import type { CalDavEventData } from "@aris/source-caldav"
import type { CalendarEventData } from "@aris/source-google-calendar"
import type { CurrentWeatherData } from "@aris/source-weatherkit"

import { CalDavFeedItemType } from "@aris/source-caldav"
import { CalendarFeedItemType } from "@aris/source-google-calendar"
import { TflFeedItemType } from "@aris/source-tfl"
import { WeatherFeedItemType } from "@aris/source-weatherkit"


export const TimePeriod = {
	Morning: "morning",
	Afternoon: "afternoon",
	Evening: "evening",
	Night: "night",
} as const

export type TimePeriod = (typeof TimePeriod)[keyof typeof TimePeriod]

export const DayType = {
	Weekday: "weekday",
	Weekend: "weekend",
} as const

export type DayType = (typeof DayType)[keyof typeof DayType]


const PRE_MEETING_WINDOW_MS = 30 * 60 * 1000
const TRANSITION_WINDOW_MS = 30 * 60 * 1000

const PERIOD_BOUNDARIES = [
	{ hour: 6, period: TimePeriod.Morning },
	{ hour: 12, period: TimePeriod.Afternoon },
	{ hour: 17, period: TimePeriod.Evening },
	{ hour: 22, period: TimePeriod.Night },
] as const

/** All calendar event types across sources */
const CALENDAR_EVENT_TYPES: ReadonlySet<string> = new Set([
	CalendarFeedItemType.Event,
	CalDavFeedItemType.Event,
])

/**
 * Creates a post-processor that reranks feed items based on time of day.
 *
 * Prioritizes items that matter right now and pushes down items that don't:
 *
 * - Morning: weather and first meeting rise, hourly forecasts sink.
 *   Weekends flip — weather stays up but work calendar and commute alerts drop.
 * - Afternoon: imminent meetings rise. Stale weather sinks.
 * - Evening: work calendar is suppressed, tomorrow's forecast and personal
 *   events rise. Weekends suppress work more aggressively.
 * - Night: almost everything sinks except high-urgency alerts.
 * - Pre-meeting (30 min before any event): that meeting dominates, low-urgency
 *   noise is suppressed, commute/weather context rises if the meeting has a location.
 * - Wind-down (weekday 20–22h): work items progressively sink as night approaches.
 * - Transition lookahead (30 min before a period boundary): items relevant to
 *   the next period get a head start.
 * - Weather-time correlation: precipitation boosts morning weather, evening
 *   events with locations boost current weather, alerts always stay high.
 */
export interface TimeOfDayEnhancerOptions {
	/** Override clock for testing. Defaults to reading context.time. */
	clock?: () => Date
}

export function createTimeOfDayEnhancer(options?: TimeOfDayEnhancerOptions): FeedPostProcessor {
	const clock = options?.clock

	function timeOfDayEnhancer(items: FeedItem[], context: Context): Promise<FeedEnhancement> {
		if (items.length === 0) return Promise.resolve({})

		const now = clock ? clock() : context.time
		const period = getTimePeriod(now)
		const dayType = getDayType(now)
		const boost: Record<string, number> = {}
		const suppress: string[] = []

		// 1. Apply period-based rules
		const firstEventId = findFirstEventOfDay(items, now)

		switch (period) {
			case TimePeriod.Morning:
				if (dayType === DayType.Weekday) {
					applyMorningWeekday(items, boost, firstEventId)
				} else {
					applyMorningWeekend(items, boost)
				}
				break
			case TimePeriod.Afternoon:
				if (dayType === DayType.Weekday) {
					applyAfternoonWeekday(items, boost)
				} else {
					applyAfternoonWeekend(items, boost)
				}
				break
			case TimePeriod.Evening:
				if (dayType === DayType.Weekday) {
					applyEveningWeekday(items, boost, suppress)
				} else {
					applyEveningWeekend(items, boost, suppress)
				}
				break
			case TimePeriod.Night:
				applyNight(items, boost, suppress)
				break
		}

		// 2. Pre-meeting overrides (can override period rules)
		const preMeeting = detectPreMeetingItems(items, now)
		applyPreMeetingOverrides(items, preMeeting, boost, suppress)

		// 3. Wind-down gradient
		applyWindDown(items, now, dayType, boost)

		// 4. Transition lookahead
		applyTransitionLookahead(items, now, period, dayType, boost)

		// 5. Weather-time correlation
		const eveningLocation = hasEveningCalendarEventWithLocation(items, now)
		applyWeatherTimeCorrelation(items, period, dayType, eveningLocation, boost)

		// Clamp boost values to [-1, 1] — additive layers can exceed the range
		for (const id in boost) {
			boost[id] = Math.max(-1, Math.min(1, boost[id]!))
		}

		const result: FeedEnhancement = {}
		if (Object.keys(boost).length > 0) {
			result.boost = boost
		}
		const uniqueSuppress = [...new Set(suppress)]
		if (uniqueSuppress.length > 0) {
			result.suppress = uniqueSuppress
		}
		return Promise.resolve(result)
	}

	return timeOfDayEnhancer
}


export function getTimePeriod(date: Date): TimePeriod {
	const hour = date.getHours()
	if (hour >= 22 || hour < 6) return TimePeriod.Night
	if (hour >= 17) return TimePeriod.Evening
	if (hour >= 12) return TimePeriod.Afternoon
	return TimePeriod.Morning
}

export function getDayType(date: Date): DayType {
	const day = date.getDay()
	return day === 0 || day === 6 ? DayType.Weekend : DayType.Weekday
}

/**
 * Returns the next period boundary as { hour, period } and the ms until it.
 */
function getNextPeriodBoundary(date: Date): { period: TimePeriod; msUntil: number } {
	const hour = date.getHours()
	const minuteMs = date.getMinutes() * 60_000 + date.getSeconds() * 1000 + date.getMilliseconds()

	for (const boundary of PERIOD_BOUNDARIES) {
		if (hour < boundary.hour) {
			const msUntil = (boundary.hour - hour) * 3_600_000 - minuteMs
			return { period: boundary.period, msUntil }
		}
	}

	// Past 22:00 — next boundary is morning at 06:00
	const hoursUntil6 = (24 - hour + 6) * 3_600_000 - minuteMs
	return { period: TimePeriod.Morning, msUntil: hoursUntil6 }
}

/**
 * Extract start time from calendar event data.
 * Google Calendar uses `startTime`, CalDAV uses `startDate`.
 */
function getEventStartTime(data: CalendarEventData | CalDavEventData): Date {
	return "startTime" in data ? (data as CalendarEventData).startTime : (data as CalDavEventData).startDate
}

/**
 * Check if a current weather item indicates precipitation or extreme conditions.
 * Only meaningful for weather-current items.
 */
function hasPrecipitationOrExtreme(item: FeedItem): boolean {
	const data = item.data as CurrentWeatherData
	if (data.precipitationIntensity > 0) return true
	if (data.temperature < 0 || data.temperature > 35) return true
	return false
}


interface PreMeetingInfo {
	/** IDs of calendar items starting within the pre-meeting window */
	upcomingMeetingIds: Set<string>
	/** Whether any upcoming meeting has a location */
	hasLocationMeeting: boolean
}

function detectPreMeetingItems(items: FeedItem[], now: Date): PreMeetingInfo {
	const nowMs = now.getTime()
	const upcomingMeetingIds = new Set<string>()
	let hasLocationMeeting = false

	for (const item of items) {
		if (!CALENDAR_EVENT_TYPES.has(item.type)) continue

		const data = item.data as CalendarEventData | CalDavEventData
		const msUntil = getEventStartTime(data).getTime() - nowMs
		if (msUntil > 0 && msUntil <= PRE_MEETING_WINDOW_MS) {
			upcomingMeetingIds.add(item.id)
			if (data.location) {
				hasLocationMeeting = true
			}
		}
	}

	return { upcomingMeetingIds, hasLocationMeeting }
}


function findFirstEventOfDay(items: FeedItem[], now: Date): string | null {
	let earliest: { id: string; time: number } | null = null

	for (const item of items) {
		if (!CALENDAR_EVENT_TYPES.has(item.type)) continue

		const data = item.data as CalendarEventData | CalDavEventData
		const startTime = getEventStartTime(data)
		const startMs = startTime.getTime()

		// Must be today and in the future
		const sameDay =
			startTime.getFullYear() === now.getFullYear() &&
			startTime.getMonth() === now.getMonth() &&
			startTime.getDate() === now.getDate()
		if (!sameDay) continue
		if (startMs <= now.getTime()) continue

		if (!earliest || startMs < earliest.time) {
			earliest = { id: item.id, time: startMs }
		}
	}

	return earliest?.id ?? null
}


function applyMorningWeekday(
	items: FeedItem[],
	boost: Record<string, number>,
	firstEventId: string | null,
): void {
	for (const item of items) {
		switch (item.type) {
			case WeatherFeedItemType.Current:
				boost[item.id] = (boost[item.id] ?? 0) + 0.7
				break
			case WeatherFeedItemType.Alert:
				boost[item.id] = (boost[item.id] ?? 0) + 0.8
				break
			case WeatherFeedItemType.Hourly:
			case WeatherFeedItemType.Daily:
				boost[item.id] = (boost[item.id] ?? 0) - 0.3
				break
			case TflFeedItemType.Alert:
				boost[item.id] = (boost[item.id] ?? 0) + 0.6
				break
		}
	}

	if (firstEventId) {
		boost[firstEventId] = (boost[firstEventId] ?? 0) + 0.6
	}
}

function applyMorningWeekend(items: FeedItem[], boost: Record<string, number>): void {
	for (const item of items) {
		switch (item.type) {
			case WeatherFeedItemType.Current:
				boost[item.id] = (boost[item.id] ?? 0) + 0.5
				break
			case WeatherFeedItemType.Daily:
				boost[item.id] = (boost[item.id] ?? 0) + 0.4
				break
			case CalendarFeedItemType.Event:
			case CalDavFeedItemType.Event:
				boost[item.id] = (boost[item.id] ?? 0) - 0.4
				break
			case TflFeedItemType.Alert:
				boost[item.id] = (boost[item.id] ?? 0) - 0.3
				break
		}
	}
}

function applyAfternoonWeekday(items: FeedItem[], boost: Record<string, number>): void {
	for (const item of items) {
		switch (item.type) {
			case CalendarFeedItemType.Event:
			case CalDavFeedItemType.Event:
				if (item.signals?.timeRelevance === "imminent") {
					boost[item.id] = (boost[item.id] ?? 0) + 0.5
				}
				break
			case WeatherFeedItemType.Current:
			case WeatherFeedItemType.Hourly:
				boost[item.id] = (boost[item.id] ?? 0) - 0.2
				break
		}
	}
}

function applyAfternoonWeekend(items: FeedItem[], boost: Record<string, number>): void {
	for (const item of items) {
		switch (item.type) {
			case WeatherFeedItemType.Current:
				boost[item.id] = (boost[item.id] ?? 0) + 0.3
				break
			case CalendarFeedItemType.Event:
			case CalDavFeedItemType.Event:
				boost[item.id] = (boost[item.id] ?? 0) - 0.5
				break
			case TflFeedItemType.Alert:
				boost[item.id] = (boost[item.id] ?? 0) - 0.2
				break
		}
	}
}

function applyEveningWeekday(
	items: FeedItem[],
	boost: Record<string, number>,
	suppress: string[],
): void {
	for (const item of items) {
		switch (item.type) {
			case CalendarFeedItemType.Event:
			case CalDavFeedItemType.Event:
				if (item.signals?.timeRelevance === "ambient") {
					suppress.push(item.id)
				}
				break
			case TflFeedItemType.Alert:
				boost[item.id] = (boost[item.id] ?? 0) - 0.4
				break
			case WeatherFeedItemType.Daily:
				boost[item.id] = (boost[item.id] ?? 0) + 0.3
				break
			case CalendarFeedItemType.AllDay:
				boost[item.id] = (boost[item.id] ?? 0) + 0.3
				break
		}
	}
}

function applyEveningWeekend(
	items: FeedItem[],
	boost: Record<string, number>,
	suppress: string[],
): void {
	for (const item of items) {
		switch (item.type) {
			case WeatherFeedItemType.Current:
				boost[item.id] = (boost[item.id] ?? 0) + 0.3
				break
			case CalendarFeedItemType.Event:
			case CalDavFeedItemType.Event:
				if (item.signals?.timeRelevance === "ambient") {
					suppress.push(item.id)
				}
				break
			case TflFeedItemType.Alert:
				boost[item.id] = (boost[item.id] ?? 0) - 0.5
				break
		}
	}
}

function applyNight(items: FeedItem[], boost: Record<string, number>, suppress: string[]): void {
	for (const item of items) {
		// Suppress all ambient items
		if (item.signals?.timeRelevance === "ambient") {
			suppress.push(item.id)
			continue
		}

		// High-urgency alerts survive unboosted
		if (
			(item.type === WeatherFeedItemType.Alert || item.type === TflFeedItemType.Alert) &&
			(item.signals?.urgency ?? 0) >= 0.8
		) {
			continue
		}

		// Demote everything else
		switch (item.type) {
			case CalendarFeedItemType.Event:
			case CalendarFeedItemType.AllDay:
			case CalDavFeedItemType.Event:
				boost[item.id] = (boost[item.id] ?? 0) - 0.6
				break
			case WeatherFeedItemType.Current:
			case WeatherFeedItemType.Hourly:
				boost[item.id] = (boost[item.id] ?? 0) - 0.5
				break
		}
	}
}


function applyPreMeetingOverrides(
	items: FeedItem[],
	preMeeting: PreMeetingInfo,
	boost: Record<string, number>,
	suppress: string[],
): void {
	if (preMeeting.upcomingMeetingIds.size === 0) return

	// Intentional override, not additive — the upcoming meeting should dominate
	// regardless of what period rules assigned. Don't reorder this before period rules.
	for (const meetingId of preMeeting.upcomingMeetingIds) {
		boost[meetingId] = 0.9
	}

	for (const item of items) {
		if (preMeeting.upcomingMeetingIds.has(item.id)) continue

		switch (item.type) {
			case TflFeedItemType.Alert:
				boost[item.id] = (boost[item.id] ?? 0) + 0.5
				break
			case WeatherFeedItemType.Current:
				if (preMeeting.hasLocationMeeting) {
					boost[item.id] = (boost[item.id] ?? 0) + 0.4
				}
				break
		}

		// Suppress items that explicitly declare low urgency.
		// Items without signals are left alone — absence of urgency is not low urgency.
		if (item.signals && item.signals.urgency !== undefined && item.signals.urgency < 0.3) {
			suppress.push(item.id)
		}
	}
}

function applyWindDown(
	items: FeedItem[],
	now: Date,
	dayType: DayType,
	boost: Record<string, number>,
): void {
	if (dayType !== DayType.Weekday) return

	const hour = now.getHours()
	const minutes = now.getMinutes()

	if (hour < 20 || hour >= 22) return

	// Gradient: 20:00 → -0.1, 21:00 → -0.2, 21:30+ → -0.3
	let additionalDemotion: number
	if (hour === 20) {
		additionalDemotion = -0.1
	} else if (hour === 21 && minutes < 30) {
		additionalDemotion = -0.2
	} else {
		additionalDemotion = -0.3
	}

	for (const item of items) {
		switch (item.type) {
			case CalendarFeedItemType.Event:
			case CalendarFeedItemType.AllDay:
			case CalDavFeedItemType.Event:
			case TflFeedItemType.Alert:
				boost[item.id] = (boost[item.id] ?? 0) + additionalDemotion
				break
		}
	}
}


function applyTransitionLookahead(
	items: FeedItem[],
	now: Date,
	currentPeriod: TimePeriod,
	dayType: DayType,
	boost: Record<string, number>,
): void {
	const next = getNextPeriodBoundary(now)
	if (next.msUntil > TRANSITION_WINDOW_MS) return

	// Apply a +0.2 secondary boost to items that would be boosted in the next period
	const nextPeriodBoost = getNextPeriodBoostTargets(next.period, dayType)

	for (const item of items) {
		if (nextPeriodBoost.has(item.type)) {
			boost[item.id] = (boost[item.id] ?? 0) + 0.2
		}
	}
}

/**
 * Returns the set of item types that get boosted in a given period+dayType.
 */
function getNextPeriodBoostTargets(period: TimePeriod, dayType: DayType): ReadonlySet<string> {
	const targets = new Set<string>()

	switch (period) {
		case TimePeriod.Morning:
			targets.add(WeatherFeedItemType.Current)
			if (dayType === DayType.Weekday) {
				targets.add(WeatherFeedItemType.Alert)
				targets.add(TflFeedItemType.Alert)
			} else {
				targets.add(WeatherFeedItemType.Daily)
			}
			break
		case TimePeriod.Afternoon:
			if (dayType === DayType.Weekend) {
				targets.add(WeatherFeedItemType.Current)
			}
			break
		case TimePeriod.Evening:
			targets.add(WeatherFeedItemType.Daily)
			if (dayType === DayType.Weekend) {
				targets.add(WeatherFeedItemType.Current)
			}
			break
		case TimePeriod.Night:
			// Night doesn't boost much — transition toward night means demoting,
			// which is handled by wind-down. No positive targets here.
			break
	}

	return targets
}


function applyWeatherTimeCorrelation(
	items: FeedItem[],
	period: TimePeriod,
	dayType: DayType,
	hasEveningEventWithLocation: boolean,
	boost: Record<string, number>,
): void {
	for (const item of items) {
		switch (item.type) {
			case WeatherFeedItemType.Alert: {
				const current = boost[item.id] ?? 0
				if (current < 0.5) {
					boost[item.id] = 0.5
				}
				break
			}
			case WeatherFeedItemType.Current:
				if (period === TimePeriod.Morning && dayType === DayType.Weekday && hasPrecipitationOrExtreme(item)) {
					boost[item.id] = (boost[item.id] ?? 0) + 0.1
				}
				if (period === TimePeriod.Evening && hasEveningEventWithLocation) {
					boost[item.id] = (boost[item.id] ?? 0) + 0.2
				}
				break
		}
	}
}

function hasEveningCalendarEventWithLocation(items: FeedItem[], now: Date): boolean {
	const todayEvening17 = new Date(now)
	todayEvening17.setHours(17, 0, 0, 0)
	const todayNight22 = new Date(now)
	todayNight22.setHours(22, 0, 0, 0)

	for (const item of items) {
		if (!CALENDAR_EVENT_TYPES.has(item.type)) continue

		const data = item.data as CalendarEventData | CalDavEventData
		const startMs = getEventStartTime(data).getTime()
		if (startMs >= todayEvening17.getTime() && startMs < todayNight22.getTime()) {
			if (data.location) return true
		}
	}

	return false
}


