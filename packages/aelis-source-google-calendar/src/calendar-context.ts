import type { ContextKey } from "@aelis/core"

import { contextKey } from "@aelis/core"

export interface NextEvent {
	title: string
	startTime: Date
	endTime: Date
	minutesUntilStart: number
	location: string | null
}

export const NextEventKey: ContextKey<NextEvent> = contextKey("aelis.google-calendar", "nextEvent")
