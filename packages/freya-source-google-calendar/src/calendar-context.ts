import type { ContextKey } from "@freya/core"

import { contextKey } from "@freya/core"

export interface NextEvent {
	title: string
	startTime: Date
	endTime: Date
	minutesUntilStart: number
	location: string | null
}

export const NextEventKey: ContextKey<NextEvent> = contextKey("freya.google-calendar", "nextEvent")
