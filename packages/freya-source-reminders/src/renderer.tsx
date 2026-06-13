/** @jsxImportSource @nym.sh/jrx */

import type { FeedItemRenderer } from "@freya/core"

import { FeedCard, SansSerifText, SerifText } from "@freya/components"

import type { ReminderOccurrenceData } from "./types.ts"

import { ReminderPriority, ReminderRecurrenceFrequency } from "./types.ts"

export const renderReminderFeedItem: FeedItemRenderer<"reminder", ReminderOccurrenceData> = (
	item,
) => {
	const { data } = item
	const status = data.completedAt ? "Completed" : formatDueStatus(data.dueAt)
	const recurrence = formatRecurrence(data.recurrence)

	return (
		<FeedCard>
			<SansSerifText content={status} style="text-xs uppercase" />
			<SerifText content={data.title} style="text-lg" />
			<SansSerifText content={formatDueAt(data.dueAt, data.timeZone)} style="text-sm" />
			{data.notes ? <SansSerifText content={data.notes} style="text-sm text-secondary" /> : null}
			{recurrence ? (
				<SansSerifText content={recurrence} style="text-xs text-secondary uppercase" />
			) : null}
			{data.priority !== ReminderPriority.Normal ? (
				<SansSerifText content={data.priority} style="text-xs text-secondary uppercase" />
			) : null}
		</FeedCard>
	)
}

function formatDueAt(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date)
}

function formatDueStatus(date: Date): string {
	const now = new Date()
	if (date.getTime() < now.getTime()) return "Due"
	return "Upcoming"
}

function formatRecurrence(recurrence: ReminderOccurrenceData["recurrence"]): string | null {
	if (!recurrence) return null

	const interval = recurrence.interval === 1 ? "" : `${recurrence.interval} `
	switch (recurrence.frequency) {
		case ReminderRecurrenceFrequency.Daily:
			return recurrence.interval === 1 ? "Daily" : `Every ${interval}days`
		case ReminderRecurrenceFrequency.Weekly:
			return recurrence.interval === 1 ? "Weekly" : `Every ${interval}weeks`
		case ReminderRecurrenceFrequency.Monthly:
			return recurrence.interval === 1 ? "Monthly" : `Every ${interval}months`
		case ReminderRecurrenceFrequency.Yearly:
			return recurrence.interval === 1 ? "Yearly" : `Every ${interval}years`
	}
}
