export interface GoogleOAuthProvider {
	fetchAccessToken(): Promise<string>
	refresh(): Promise<string>
	revoke(): Promise<void>
}

export const EventStatus = {
	Confirmed: "confirmed",
	Tentative: "tentative",
	Cancelled: "cancelled",
} as const

export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus]

/** Exactly one of dateTime or date is present. */
export interface ApiEventDateTime {
	dateTime?: string
	date?: string
	timeZone?: string
}

export interface ApiCalendarEvent {
	id: string
	status: EventStatus
	htmlLink: string
	summary?: string
	description?: string
	location?: string
	start: ApiEventDateTime
	end: ApiEventDateTime
}

export type CalendarEventData = {
	eventId: string
	calendarId: string
	title: string
	description: string | null
	location: string | null
	startTime: Date
	endTime: Date
	isAllDay: boolean
	status: EventStatus
	htmlLink: string
}

export interface ListEventsOptions {
	calendarId: string
	timeMin: Date
	timeMax: Date
}

export interface GoogleCalendarClient {
	listCalendarIds(): Promise<string[]>
	listEvents(options: ListEventsOptions): Promise<ApiCalendarEvent[]>
}
