import type { FeedItem } from "@aris/core"

// -- Event status --

export const CalDavEventStatus = {
	Confirmed: "confirmed",
	Tentative: "tentative",
	Cancelled: "cancelled",
} as const

export type CalDavEventStatus = (typeof CalDavEventStatus)[keyof typeof CalDavEventStatus]

// -- Attendee types --

export const AttendeeRole = {
	Chair: "chair",
	Required: "required",
	Optional: "optional",
} as const

export type AttendeeRole = (typeof AttendeeRole)[keyof typeof AttendeeRole]

export const AttendeeStatus = {
	Accepted: "accepted",
	Declined: "declined",
	Tentative: "tentative",
	NeedsAction: "needs-action",
} as const

export type AttendeeStatus = (typeof AttendeeStatus)[keyof typeof AttendeeStatus]

export interface CalDavAttendee {
	name: string | null
	email: string | null
	role: AttendeeRole | null
	status: AttendeeStatus | null
}

// -- Alarm --

export interface CalDavAlarm {
	/** ISO 8601 duration relative to event start, e.g. "-PT15M" */
	trigger: string
	/** e.g. "DISPLAY", "AUDIO" */
	action: string
}

// -- Event data --

export interface CalDavEventData extends Record<string, unknown> {
	uid: string
	title: string
	startDate: Date
	endDate: Date
	isAllDay: boolean
	location: string | null
	description: string | null
	calendarName: string | null
	status: CalDavEventStatus | null
	url: string | null
	organizer: string | null
	attendees: CalDavAttendee[]
	alarms: CalDavAlarm[]
	recurrenceId: string | null
}

// -- Feed item type --

export const CalDavFeedItemType = {
	Event: "caldav-event",
} as const

export type CalDavFeedItemType = (typeof CalDavFeedItemType)[keyof typeof CalDavFeedItemType]

// -- Feed item --

export type CalDavFeedItem = FeedItem<typeof CalDavFeedItemType.Event, CalDavEventData>

// -- DAV client interface --

export interface CalDavDAVObject {
	data?: unknown
	etag?: string
	url: string
}

export interface CalDavDAVCalendar {
	displayName?: string | Record<string, unknown>
	url: string
}

/** Subset of tsdav's DAVClient used by CalDavSource. */
export interface CalDavDAVClient {
	login(): Promise<void>
	fetchCalendars(): Promise<CalDavDAVCalendar[]>
	fetchCalendarObjects(params: {
		calendar: CalDavDAVCalendar
		timeRange: { start: string; end: string }
	}): Promise<CalDavDAVObject[]>
	credentials: Record<string, unknown>
}
