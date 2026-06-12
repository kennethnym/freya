/** @jsxImportSource @nym.sh/jrx */

import type { FeedItemRenderer } from "@freya/core"

import { FeedCard, SansSerifText, SerifText } from "@freya/components"

import type { CalDavEventData } from "./types.ts"

import { CalDavEventStatus } from "./types.ts"

function formatTime(date: Date): string {
	const hours = date.getHours()
	const minutes = date.getMinutes()
	const period = hours >= 12 ? "PM" : "AM"
	const h = hours % 12 || 12
	const m = minutes.toString().padStart(2, "0")
	return `${h}:${m} ${period}`
}

function formatTimeRange(data: CalDavEventData): string {
	if (data.isAllDay) {
		return "All day"
	}
	return `${formatTime(data.startDate)} – ${formatTime(data.endDate)}`
}

function formatStatus(status: CalDavEventData["status"]): string | null {
	if (status === CalDavEventStatus.Cancelled) return "Cancelled"
	if (status === CalDavEventStatus.Tentative) return "Tentative"
	return null
}

export const renderCalDavFeedItem: FeedItemRenderer<"caldav-event", CalDavEventData> = (item) => {
	const { data, slots } = item
	const statusLabel = formatStatus(data.status)
	const attendeeCount = data.attendees.length

	return (
		<FeedCard>
			{statusLabel ? <SansSerifText content={statusLabel} style="text-xs uppercase" /> : null}

			<SerifText content={data.title} style="text-lg" />

			<SansSerifText content={formatTimeRange(data)} style="text-sm" />

			{data.calendarName ? (
				<SansSerifText content={data.calendarName} style="text-sm text-secondary" />
			) : null}

			{data.location ? (
				<SansSerifText content={data.location} style="text-sm text-secondary" />
			) : null}

			{attendeeCount > 0 ? (
				<SansSerifText
					content={`${attendeeCount} attendee${attendeeCount === 1 ? "" : "s"}`}
					style="text-sm text-secondary"
				/>
			) : null}

			{slots?.insight?.content ? (
				<SansSerifText content={slots.insight.content} style="text-sm" />
			) : null}

			{slots?.preparation?.content ? (
				<SansSerifText content={slots.preparation.content} style="text-sm" />
			) : null}

			{slots?.crossSource?.content ? (
				<SansSerifText content={slots.crossSource.content} style="text-sm" />
			) : null}
		</FeedCard>
	)
}
