import type { ContextKey } from "@freya/core"

import { contextKey } from "@freya/core"

import type { CalDavEventData } from "./types.ts"

/**
 * Calendar context for downstream sources.
 *
 * Provides a snapshot of the user's upcoming CalDAV events so other sources
 * can adapt (e.g. a commute source checking if there's a meeting soon).
 */
export interface CalendarContext {
	/** Events happening right now */
	inProgress: CalDavEventData[]
	/** Next upcoming event, if any */
	nextEvent: CalDavEventData | null
	/** Whether the user has any events today */
	hasTodayEvents: boolean
	/** Total number of events today */
	todayEventCount: number
}

export const CalDavCalendarKey: ContextKey<CalendarContext> = contextKey("freya.caldav", "calendar")
