// Google Calendar REST API v3 client
// https://developers.google.com/calendar/api/v3/reference/events/list

import { type } from "arktype"

import type {
	ApiCalendarEvent,
	GoogleCalendarClient,
	GoogleOAuthProvider,
	ListEventsOptions,
} from "./types"

import { EventStatus } from "./types"

const eventStatusSchema = type.enumerated(
	EventStatus.Confirmed,
	EventStatus.Tentative,
	EventStatus.Cancelled,
)

const eventDateTimeSchema = type({
	"dateTime?": "string",
	"date?": "string",
	"timeZone?": "string",
})

const eventSchema = type({
	id: "string",
	status: eventStatusSchema,
	htmlLink: "string",
	"summary?": "string",
	"description?": "string",
	"location?": "string",
	start: eventDateTimeSchema,
	end: eventDateTimeSchema,
})

const calendarListEntrySchema = type({
	id: "string",
})

const calendarListResponseSchema = type({
	"items?": calendarListEntrySchema.array(),
	"nextPageToken?": "string",
})

const eventsResponseSchema = type({
	"items?": eventSchema.array(),
	"nextPageToken?": "string",
})

export class DefaultGoogleCalendarClient implements GoogleCalendarClient {
	private static readonly API_BASE = "https://www.googleapis.com/calendar/v3"

	private readonly oauthProvider: GoogleOAuthProvider

	constructor(oauthProvider: GoogleOAuthProvider) {
		this.oauthProvider = oauthProvider
	}

	async listCalendarIds(): Promise<string[]> {
		const url = `${DefaultGoogleCalendarClient.API_BASE}/users/me/calendarList?fields=items(id)`
		const json = await this.request(url)
		const result = calendarListResponseSchema(json)

		if (result instanceof type.errors) {
			throw new Error(`Google Calendar API response validation failed: ${result.summary}`)
		}

		if (!result.items) {
			return []
		}
		return result.items.map((entry) => entry.id)
	}

	async listEvents(options: ListEventsOptions): Promise<ApiCalendarEvent[]> {
		const url = new URL(
			`${DefaultGoogleCalendarClient.API_BASE}/calendars/${encodeURIComponent(options.calendarId)}/events`,
		)
		url.searchParams.set("timeMin", options.timeMin.toISOString())
		url.searchParams.set("timeMax", options.timeMax.toISOString())
		url.searchParams.set("singleEvents", "true")
		url.searchParams.set("orderBy", "startTime")

		const json = await this.request(url.toString())
		const result = eventsResponseSchema(json)

		if (result instanceof type.errors) {
			throw new Error(`Google Calendar API response validation failed: ${result.summary}`)
		}

		if (!result.items) {
			return []
		}

		return result.items
	}

	/** Authenticated GET with auto token refresh on 401. */
	private async request(url: string): Promise<unknown> {
		const token = await this.oauthProvider.fetchAccessToken()
		let response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		})

		if (response.status === 401) {
			const newToken = await this.oauthProvider.refresh()
			response = await fetch(url, {
				headers: { Authorization: `Bearer ${newToken}` },
			})
		}

		if (!response.ok) {
			const body = await response.text()
			throw new Error(
				`Google Calendar API error: ${response.status} ${response.statusText}: ${body}`,
			)
		}

		return response.json()
	}
}
