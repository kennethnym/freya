import type { ActionDefinition, ContextEntry, FeedItemSignals, FeedSource, Slot } from "@aelis/core"

import { Context, TimeRelevance, UnknownActionError } from "@aelis/core"
import { DAVClient } from "tsdav"

import type { CalDavDAVClient, CalDavEventData, CalDavFeedItem } from "./types.ts"

import { CalDavCalendarKey, type CalendarContext } from "./calendar-context.ts"
import { parseICalEvents } from "./ical-parser.ts"
import crossSourcePrompt from "./prompts/cross-source.txt"
import insightPrompt from "./prompts/insight.txt"
import preparationPrompt from "./prompts/preparation.txt"
import { CalDavEventStatus, CalDavFeedItemType } from "./types.ts"

// -- Source options --

interface CalDavSourceBaseOptions {
	serverUrl: string
	/** Number of additional days beyond today to fetch. Default: 0 (today only). */
	lookAheadDays?: number
	/** IANA timezone for determining "today" (e.g. "America/New_York"). Default: UTC. */
	timeZone?: string
	/** Optional DAV client for testing. */
	davClient?: CalDavDAVClient
}

interface CalDavSourceBasicAuthOptions extends CalDavSourceBaseOptions {
	authMethod: "basic"
	username: string
	password: string
}

interface CalDavSourceOAuthOptions extends CalDavSourceBaseOptions {
	authMethod: "oauth"
	accessToken: string
	refreshToken: string
	tokenUrl: string
	expiration?: number
	clientId?: string
	clientSecret?: string
}

export type CalDavSourceOptions = CalDavSourceBasicAuthOptions | CalDavSourceOAuthOptions

const DEFAULT_LOOK_AHEAD_DAYS = 0

/**
 * A FeedSource that fetches calendar events from any CalDAV server.
 *
 * Supports Basic auth (username/password) and OAuth (access token + refresh token).
 * The server URL is provided at construction time.
 *
 * @example
 * ```ts
 * // Basic auth (self-hosted servers)
 * const source = new CalDavSource({
 *   serverUrl: "https://nextcloud.example.com/remote.php/dav",
 *   authMethod: "basic",
 *   username: "user",
 *   password: "pass",
 * })
 *
 * // OAuth (cloud providers)
 * const source = new CalDavSource({
 *   serverUrl: "https://caldav.provider.com",
 *   authMethod: "oauth",
 *   accessToken: "...",
 *   refreshToken: "...",
 *   tokenUrl: "https://provider.com/oauth/token",
 * })
 * ```
 */
export class CalDavSource implements FeedSource<CalDavFeedItem> {
	readonly id = "aelis.caldav"

	private options: CalDavSourceOptions | null
	private readonly lookAheadDays: number
	private readonly timeZone: string | undefined
	private readonly injectedClient: CalDavDAVClient | null
	private clientPromise: Promise<CalDavDAVClient> | null = null
	private cachedEvents: { time: Date; events: CalDavEventData[] } | null = null
	private pendingFetch: { time: Date; promise: Promise<CalDavEventData[]> } | null = null

	constructor(options: CalDavSourceOptions) {
		this.options = options
		this.lookAheadDays = options.lookAheadDays ?? DEFAULT_LOOK_AHEAD_DAYS
		this.timeZone = options.timeZone
		this.injectedClient = options.davClient ?? null
	}

	async listActions(): Promise<Record<string, ActionDefinition>> {
		return {}
	}

	async executeAction(actionId: string): Promise<void> {
		throw new UnknownActionError(actionId)
	}

	async fetchContext(context: Context): Promise<readonly ContextEntry[] | null> {
		const events = await this.fetchEvents(context)
		if (events.length === 0) {
			return [
				[
					CalDavCalendarKey,
					{
						inProgress: [],
						nextEvent: null,
						hasTodayEvents: false,
						todayEventCount: 0,
					},
				],
			]
		}

		const now = context.time
		const active = events.filter((e) => e.status !== CalDavEventStatus.Cancelled)
		const inProgress = active.filter((e) => !e.isAllDay && e.startDate <= now && e.endDate > now)

		const upcoming = active
			.filter((e) => !e.isAllDay && e.startDate > now)
			.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())

		const calendarContext: CalendarContext = {
			inProgress,
			nextEvent: upcoming[0] ?? null,
			hasTodayEvents: events.length > 0,
			todayEventCount: events.length,
		}

		return [[CalDavCalendarKey, calendarContext]]
	}

	async fetchItems(context: Context): Promise<CalDavFeedItem[]> {
		const now = context.time
		const events = await this.fetchEvents(context)
		return events.map((event) => createFeedItem(event, now, this.timeZone))
	}

	private fetchEvents(context: Context): Promise<CalDavEventData[]> {
		if (this.cachedEvents && this.cachedEvents.time === context.time) {
			return Promise.resolve(this.cachedEvents.events)
		}

		// Deduplicate concurrent fetches for the same context.time reference
		if (this.pendingFetch && this.pendingFetch.time === context.time) {
			return this.pendingFetch.promise
		}

		const promise = this.doFetchEvents(context).finally(() => {
			if (this.pendingFetch?.promise === promise) {
				this.pendingFetch = null
			}
		})

		this.pendingFetch = { time: context.time, promise }
		return promise
	}

	private async doFetchEvents(context: Context): Promise<CalDavEventData[]> {
		const client = await this.connectClient()
		const calendars = await client.fetchCalendars()

		const { start, end } = computeTimeRange(context.time, this.lookAheadDays, this.timeZone)

		const results = await Promise.allSettled(
			calendars.map(async (calendar) => {
				const objects = await client.fetchCalendarObjects({
					calendar,
					timeRange: {
						start: start.toISOString(),
						end: end.toISOString(),
					},
				})
				// tsdav types displayName as string | Record<string, unknown> | undefined
				const calendarName = typeof calendar.displayName === "string" ? calendar.displayName : null
				return { objects, calendarName }
			}),
		)

		const allEvents: CalDavEventData[] = []
		for (const result of results) {
			if (result.status === "rejected") {
				console.warn("[aelis.caldav] Failed to fetch calendar:", result.reason)
				continue
			}
			const { objects, calendarName } = result.value
			for (const obj of objects) {
				if (typeof obj.data !== "string") continue

				const events = parseICalEvents(obj.data, calendarName, { start, end })
				for (const event of events) {
					allEvents.push(event)
				}
			}
		}

		this.cachedEvents = { time: context.time, events: allEvents }
		return allEvents
	}

	private connectClient(): Promise<CalDavDAVClient> {
		if (this.injectedClient) {
			return Promise.resolve(this.injectedClient)
		}

		if (!this.clientPromise) {
			this.clientPromise = this.createAndLoginClient().catch((err) => {
				this.clientPromise = null
				throw err
			})
		}

		return this.clientPromise
	}

	private async createAndLoginClient(): Promise<CalDavDAVClient> {
		const opts = this.options
		if (!opts) {
			throw new Error("CalDavSource options have already been consumed")
		}

		let client: CalDavDAVClient

		if (opts.authMethod === "basic") {
			client = new DAVClient({
				serverUrl: opts.serverUrl,
				credentials: {
					username: opts.username,
					password: opts.password,
				},
				authMethod: "Basic",
				defaultAccountType: "caldav",
			})
		} else {
			client = new DAVClient({
				serverUrl: opts.serverUrl,
				credentials: {
					tokenUrl: opts.tokenUrl,
					refreshToken: opts.refreshToken,
					accessToken: opts.accessToken,
					expiration: opts.expiration,
					clientId: opts.clientId,
					clientSecret: opts.clientSecret,
				},
				authMethod: "Oauth",
				defaultAccountType: "caldav",
			})
		}

		await client.login()
		this.options = null
		return client
	}
}

function computeTimeRange(
	now: Date,
	lookAheadDays: number,
	timeZone?: string,
): { start: Date; end: Date } {
	const start = startOfDay(now, timeZone)
	const end = new Date(start.getTime() + (1 + lookAheadDays) * 24 * 60 * 60 * 1000)
	return { start, end }
}

/**
 * Returns midnight (start of day) as a UTC Date.
 * When timeZone is provided, "midnight" is local midnight in that timezone
 * converted to UTC. Otherwise, UTC midnight.
 */
function startOfDay(date: Date, timeZone?: string): Date {
	if (!timeZone) {
		const d = new Date(date)
		d.setUTCHours(0, 0, 0, 0)
		return d
	}

	// Extract the local year/month/day in the target timezone
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date)

	const year = Number(parts.find((p) => p.type === "year")!.value)
	const month = Number(parts.find((p) => p.type === "month")!.value)
	const day = Number(parts.find((p) => p.type === "day")!.value)

	// Binary-search-free approach: construct a UTC date at the local date's noon,
	// then use the timezone offset at that moment to find local midnight in UTC.
	const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0)
	const noonLocal = new Date(noonUtc).toLocaleString("sv-SE", { timeZone, hour12: false })
	// sv-SE locale formats as "YYYY-MM-DD HH:MM:SS" which Date can parse
	const noonLocalMs = new Date(noonLocal + "Z").getTime()
	const offsetMs = noonLocalMs - noonUtc

	return new Date(Date.UTC(year, month - 1, day) - offsetMs)
}

export function computeSignals(
	event: CalDavEventData,
	now: Date,
	timeZone?: string,
): FeedItemSignals {
	if (event.status === CalDavEventStatus.Cancelled) {
		return { urgency: 0.1, timeRelevance: TimeRelevance.Ambient }
	}

	if (event.isAllDay) {
		return { urgency: 0.3, timeRelevance: TimeRelevance.Ambient }
	}

	const msUntilStart = event.startDate.getTime() - now.getTime()

	// Event already started
	if (msUntilStart < 0) {
		const isInProgress = now.getTime() < event.endDate.getTime()
		return isInProgress
			? { urgency: 0.8, timeRelevance: TimeRelevance.Imminent }
			: { urgency: 0.2, timeRelevance: TimeRelevance.Ambient }
	}

	// Starting within 30 minutes
	if (msUntilStart <= 30 * 60 * 1000) {
		return { urgency: 0.9, timeRelevance: TimeRelevance.Imminent }
	}

	// Starting within 2 hours
	if (msUntilStart <= 2 * 60 * 60 * 1000) {
		return { urgency: 0.7, timeRelevance: TimeRelevance.Upcoming }
	}

	// Later today (using local day boundary when timeZone is set)
	const todayStart = startOfDay(now, timeZone)
	const endOfDay = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

	if (event.startDate.getTime() < endOfDay.getTime()) {
		return { urgency: 0.5, timeRelevance: TimeRelevance.Upcoming }
	}

	// Future days
	return { urgency: 0.2, timeRelevance: TimeRelevance.Ambient }
}

function createEventSlots(): Record<string, Slot> {
	return {
		insight: { description: insightPrompt, content: null },
		preparation: { description: preparationPrompt, content: null },
		crossSource: { description: crossSourcePrompt, content: null },
	}
}

function createFeedItem(event: CalDavEventData, now: Date, timeZone?: string): CalDavFeedItem {
	return {
		id: `caldav-event-${event.uid}${event.recurrenceId ? `-${event.recurrenceId}` : ""}`,
		type: CalDavFeedItemType.Event,
		timestamp: now,
		data: event,
		signals: computeSignals(event, now, timeZone),
		slots: createEventSlots(),
	}
}
