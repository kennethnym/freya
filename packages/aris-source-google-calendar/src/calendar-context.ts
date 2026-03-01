import type { ContextKey } from "@aris/core"

import { contextKey } from "@aris/core"

export interface NextEvent {
	title: string
	startTime: Date
	endTime: Date
	minutesUntilStart: number
	location: string | null
}

export const NextEventKey: ContextKey<NextEvent> = contextKey("aris.google-calendar", "nextEvent")
