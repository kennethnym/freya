import type { FeedItem } from "@aris/core"

import type { CalendarEventData } from "./types"

export const CalendarFeedItemType = {
	Event: "calendar-event",
	AllDay: "calendar-all-day",
} as const

export type CalendarFeedItemType = (typeof CalendarFeedItemType)[keyof typeof CalendarFeedItemType]

export interface CalendarEventFeedItem extends FeedItem<
	typeof CalendarFeedItemType.Event,
	CalendarEventData
> {}

export interface CalendarAllDayFeedItem extends FeedItem<
	typeof CalendarFeedItemType.AllDay,
	CalendarEventData
> {}

export type CalendarFeedItem = CalendarEventFeedItem | CalendarAllDayFeedItem
