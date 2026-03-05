import type { FeedItem } from "@aris/core"

import { CalDavFeedItemType } from "@aris/source-caldav"
import { CalendarFeedItemType } from "@aris/source-google-calendar"

import systemPromptBase from "./prompts/system.txt"

const CALENDAR_ITEM_TYPES = new Set<string>([
	CalDavFeedItemType.Event,
	CalendarFeedItemType.Event,
	CalendarFeedItemType.AllDay,
])

/**
 * Builds the system prompt and user message for the enhancement harness.
 *
 * Includes a pre-computed mini calendar so the LLM doesn't have to
 * parse timestamps to understand the user's schedule.
 */
export function buildPrompt(
	items: FeedItem[],
	currentTime: Date,
): { systemPrompt: string; userMessage: string } {
	const schedule = buildSchedule(items, currentTime)

	const enhanceItems: Array<{
		id: string
		data: Record<string, unknown>
		slots: Record<string, string>
	}> = []
	const contextItems: Array<{
		id: string
		type: string
		data: Record<string, unknown>
	}> = []

	for (const item of items) {
		const hasUnfilledSlots =
			item.slots &&
			Object.values(item.slots).some((slot) => slot.content === null)

		if (hasUnfilledSlots) {
			enhanceItems.push({
				id: item.id,
				data: item.data,
				slots: Object.fromEntries(
					Object.entries(item.slots!)
						.filter(([, slot]) => slot.content === null)
						.map(([name, slot]) => [name, slot.description]),
				),
			})
		} else {
			contextItems.push({
				id: item.id,
				type: item.type,
				data: item.data,
			})
		}
	}

	const userMessage = JSON.stringify({
		time: currentTime.toISOString(),
		items: enhanceItems,
		context: contextItems,
	})

	const weekCalendar = buildWeekCalendar(currentTime)
	let systemPrompt = systemPromptBase
	systemPrompt += `\n\nWeek:\n${weekCalendar}`
	if (schedule) {
		systemPrompt += `\n\nSchedule:\n${schedule}`
	}

	return { systemPrompt, userMessage }
}

/**
 * Returns true if any item has at least one unfilled slot.
 */
export function hasUnfilledSlots(items: FeedItem[]): boolean {
	return items.some(
		(item) =>
			item.slots &&
			Object.values(item.slots).some((slot) => slot.content === null),
	)
}

// -- Helpers --

interface CalendarEntry {
	date: Date
	title: string
	location: string | null
	isAllDay: boolean
	startTime: Date
	endTime: Date
}

function toValidDate(value: unknown): Date | null {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
	if (typeof value === "string" || typeof value === "number") {
		const date = new Date(value)
		return Number.isNaN(date.getTime()) ? null : date
	}
	return null
}

function extractCalendarEntry(item: FeedItem): CalendarEntry | null {
	if (!CALENDAR_ITEM_TYPES.has(item.type)) return null

	const d = item.data
	const title = d.title
	if (typeof title !== "string" || !title) return null

	// CalDAV uses startDate/endDate, Google Calendar uses startTime/endTime
	const startTime = toValidDate(d.startDate ?? d.startTime)
	if (!startTime) return null

	const endTime = toValidDate(d.endDate ?? d.endTime) ?? startTime

	return {
		date: startTime,
		title,
		location: typeof d.location === "string" ? d.location : null,
		isAllDay: typeof d.isAllDay === "boolean" ? d.isAllDay : false,
		startTime,
		endTime,
	}
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

function pad2(n: number): string {
	return n.toString().padStart(2, "0")
}

function formatTime(date: Date): string {
	return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`
}

function formatDayShort(date: Date): string {
	return `${DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

function formatDayLabel(date: Date, currentTime: Date): string {
	const currentDay = Date.UTC(currentTime.getUTCFullYear(), currentTime.getUTCMonth(), currentTime.getUTCDate())
	const targetDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
	const diffDays = Math.round((targetDay - currentDay) / (1000 * 60 * 60 * 24))

	const dayName = formatDayShort(date)

	if (diffDays === 0) return `Today: ${dayName}`
	if (diffDays === 1) return `Tomorrow: ${dayName}`
	return dayName
}

/**
 * Builds a week overview mapping day names to dates,
 * so the LLM can easily match ISO timestamps to days.
 */
function buildWeekCalendar(currentTime: Date): string {
	const lines: string[] = []
	for (let i = 0; i < 7; i++) {
		const date = new Date(currentTime)
		date.setUTCDate(date.getUTCDate() + i)
		const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : ""
		const dayStr = formatDayShort(date)
		const iso = date.toISOString().slice(0, 10)
		const prefix = label ? `${label}: ` : ""
		lines.push(`${prefix}${dayStr} = ${iso}`)
	}
	return lines.join("\n")
}

/**
 * Builds a compact text calendar from all calendar-type items.
 * Groups events by day relative to currentTime.
 */
function buildSchedule(items: FeedItem[], currentTime: Date): string {
	const entries: CalendarEntry[] = []
	for (const item of items) {
		const entry = extractCalendarEntry(item)
		if (entry) entries.push(entry)
	}

	if (entries.length === 0) return ""

	entries.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())

	const byDay = new Map<string, CalendarEntry[]>()
	for (const entry of entries) {
		const key = entry.date.toISOString().slice(0, 10)
		const group = byDay.get(key)
		if (group) {
			group.push(entry)
		} else {
			byDay.set(key, [entry])
		}
	}

	const lines: string[] = []
	for (const [, dayEntries] of byDay) {
		lines.push(formatDayLabel(dayEntries[0]!.startTime, currentTime))
		for (const entry of dayEntries) {
			if (entry.isAllDay) {
				const loc = entry.location ? ` @ ${entry.location}` : ""
				lines.push(`  all day  ${entry.title}${loc}`)
			} else {
				const timeRange = `${formatTime(entry.startTime)}–${formatTime(entry.endTime)}`
				const loc = entry.location ? ` @ ${entry.location}` : ""
				lines.push(`  ${timeRange}  ${entry.title}${loc}`)
			}
		}
	}

	return lines.join("\n")
}
