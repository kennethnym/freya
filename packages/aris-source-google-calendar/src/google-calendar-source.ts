import type { ActionDefinition, ContextEntry, FeedItemSignals, FeedSource } from "@aris/core"

import { Context, TimeRelevance, UnknownActionError } from "@aris/core"

import type {
	ApiCalendarEvent,
	CalendarEventData,
	GoogleCalendarClient,
	GoogleOAuthProvider,
} from "./types"

import { NextEventKey, type NextEvent } from "./calendar-context"

interface GoogleCalendarSourceBaseOptions {
	calendarIds?: string[]
	/** Default: 24 */
	lookaheadHours?: number
}

interface GoogleCalendarSourceWithProvider extends GoogleCalendarSourceBaseOptions {
	oauthProvider: GoogleOAuthProvider
	client?: never
}

interface GoogleCalendarSourceWithClient extends GoogleCalendarSourceBaseOptions {
	oauthProvider?: never
	client: GoogleCalendarClient
}

export type GoogleCalendarSourceOptions =
	| GoogleCalendarSourceWithProvider
	| GoogleCalendarSourceWithClient
import { CalendarFeedItemType, type CalendarFeedItem } from "./feed-items"
import { DefaultGoogleCalendarClient } from "./google-calendar-api"

const DEFAULT_LOOKAHEAD_HOURS = 24

const URGENCY_ONGOING = 1.0
const URGENCY_UPCOMING_MAX = 0.9
const URGENCY_UPCOMING_MIN = 0.3
const URGENCY_ALL_DAY = 0.4

/**
 * A FeedSource that provides Google Calendar events and next-event context.
 *
 * Fetches upcoming and all-day events within a configurable lookahead window.
 * Provides a NextEvent context for downstream sources to react to the user's schedule.
 *
 * @example
 * ```ts
 * const calendarSource = new GoogleCalendarSource({
 *   oauthProvider: myOAuthProvider,
 *   calendarIds: ["primary", "work@example.com"],
 *   lookaheadHours: 12,
 * })
 *
 * const engine = new FeedEngine()
 *   .register(calendarSource)
 *
 * // Access next-event context in downstream sources
 * const next = context.get(NextEventKey)
 * if (next && next.minutesUntilStart < 15) {
 *   // remind user
 * }
 * ```
 */
export class GoogleCalendarSource implements FeedSource<CalendarFeedItem> {
	readonly id = "aris.google-calendar"

	private readonly client: GoogleCalendarClient
	private readonly calendarIds: string[] | undefined
	private readonly lookaheadHours: number

	constructor(options: GoogleCalendarSourceOptions) {
		this.client = options.client ?? new DefaultGoogleCalendarClient(options.oauthProvider)
		this.calendarIds = options.calendarIds
		this.lookaheadHours = options.lookaheadHours ?? DEFAULT_LOOKAHEAD_HOURS
	}

	async listActions(): Promise<Record<string, ActionDefinition>> {
		return {}
	}

	async executeAction(actionId: string): Promise<void> {
		throw new UnknownActionError(actionId)
	}

	async fetchContext(context: Context): Promise<readonly ContextEntry[] | null> {
		const events = await this.fetchAllEvents(context.time)

		const now = context.time.getTime()
		const nextTimedEvent = events.find((e) => !e.isAllDay && e.startTime.getTime() > now)

		if (!nextTimedEvent) {
			return null
		}

		const minutesUntilStart = (nextTimedEvent.startTime.getTime() - now) / 60_000

		const nextEvent: NextEvent = {
			title: nextTimedEvent.title,
			startTime: nextTimedEvent.startTime,
			endTime: nextTimedEvent.endTime,
			minutesUntilStart,
			location: nextTimedEvent.location,
		}

		return [[NextEventKey, nextEvent]]
	}

	async fetchItems(context: Context): Promise<CalendarFeedItem[]> {
		const events = await this.fetchAllEvents(context.time)
		const now = context.time.getTime()
		const lookaheadMs = this.lookaheadHours * 60 * 60 * 1000

		return events.map((event) => createFeedItem(event, now, lookaheadMs))
	}

	private async resolveCalendarIds(): Promise<string[]> {
		if (this.calendarIds) {
			return this.calendarIds
		}
		return this.client.listCalendarIds()
	}

	private async fetchAllEvents(time: Date): Promise<CalendarEventData[]> {
		const timeMax = new Date(time.getTime() + this.lookaheadHours * 60 * 60 * 1000)
		const calendarIds = await this.resolveCalendarIds()

		const results = await Promise.all(
			calendarIds.map(async (calendarId) => {
				const raw = await this.client.listEvents({
					calendarId,
					timeMin: time,
					timeMax,
				})
				return raw.map((event) => parseEvent(event, calendarId))
			}),
		)

		const allEvents = results.flat()

		// Sort by start time ascending
		allEvents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())

		return allEvents
	}
}

function parseEvent(event: ApiCalendarEvent, calendarId: string): CalendarEventData {
	const startRaw = event.start.dateTime ?? event.start.date
	const endRaw = event.end.dateTime ?? event.end.date

	if (!startRaw || !endRaw) {
		throw new Error(`Event ${event.id} is missing start or end date`)
	}

	const isAllDay = !event.start.dateTime

	return {
		eventId: event.id,
		calendarId,
		title: event.summary ?? "(No title)",
		description: event.description ?? null,
		location: event.location ?? null,
		startTime: new Date(startRaw),
		endTime: new Date(endRaw),
		isAllDay,
		status: event.status,
		htmlLink: event.htmlLink,
	}
}

function computeSignals(
	event: CalendarEventData,
	nowMs: number,
	lookaheadMs: number,
): FeedItemSignals {
	if (event.isAllDay) {
		return { urgency: URGENCY_ALL_DAY, timeRelevance: TimeRelevance.Ambient }
	}

	const startMs = event.startTime.getTime()
	const endMs = event.endTime.getTime()

	// Ongoing: start <= now < end
	if (startMs <= nowMs && nowMs < endMs) {
		return { urgency: URGENCY_ONGOING, timeRelevance: TimeRelevance.Imminent }
	}

	// Upcoming: linear decay from URGENCY_UPCOMING_MAX to URGENCY_UPCOMING_MIN
	const msUntilStart = startMs - nowMs
	if (msUntilStart <= 0) {
		return { urgency: URGENCY_UPCOMING_MIN, timeRelevance: TimeRelevance.Ambient }
	}

	const ratio = Math.min(msUntilStart / lookaheadMs, 1)
	const urgency = URGENCY_UPCOMING_MAX - ratio * (URGENCY_UPCOMING_MAX - URGENCY_UPCOMING_MIN)

	// Within 30 minutes = imminent, otherwise upcoming
	const timeRelevance =
		msUntilStart <= 30 * 60 * 1000 ? TimeRelevance.Imminent : TimeRelevance.Upcoming

	return { urgency, timeRelevance }
}

function createFeedItem(
	event: CalendarEventData,
	nowMs: number,
	lookaheadMs: number,
): CalendarFeedItem {
	const itemType = event.isAllDay ? CalendarFeedItemType.AllDay : CalendarFeedItemType.Event

	return {
		id: `calendar-${event.calendarId}-${event.eventId}`,
		type: itemType,
		timestamp: new Date(nowMs),
		data: event,
		signals: computeSignals(event, nowMs, lookaheadMs),
	}
}
