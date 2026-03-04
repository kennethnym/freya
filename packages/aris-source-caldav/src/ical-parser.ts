import ICAL from "ical.js"

import {
	AttendeeRole,
	AttendeeStatus,
	CalDavEventStatus,
	type CalDavAlarm,
	type CalDavAttendee,
	type CalDavEventData,
} from "./types.ts"

export interface ICalTimeRange {
	start: Date
	end: Date
}

/**
 * Safety cap to prevent runaway iteration on pathological recurrence rules.
 * Each iteration is pure date math (no I/O), so a high cap is fine.
 * 10,000 covers a daily event with DTSTART ~27 years in the past.
 */
const MAX_RECURRENCE_ITERATIONS = 10_000

/**
 * Parses a raw iCalendar string and extracts VEVENT components
 * into CalDavEventData objects.
 *
 * When a timeRange is provided, recurring events are expanded into
 * individual occurrences within that range. Without a timeRange,
 * each VEVENT component is returned as-is (legacy behavior).
 *
 * @param icsData - Raw iCalendar string from a CalDAV response
 * @param calendarName - Display name of the calendar this event belongs to
 * @param timeRange - When set, expand recurrences and filter to this window
 */
export function parseICalEvents(
	icsData: string,
	calendarName: string | null,
	timeRange?: ICalTimeRange,
): CalDavEventData[] {
	const jcal = ICAL.parse(icsData)
	const comp = new ICAL.Component(jcal)
	const vevents = comp.getAllSubcomponents("vevent")

	if (!timeRange) {
		return vevents.map((vevent: InstanceType<typeof ICAL.Component>) =>
			parseVEvent(vevent, calendarName),
		)
	}

	// Group VEVENTs by UID: master + exceptions
	const byUid = new Map<
		string,
		{
			master: InstanceType<typeof ICAL.Component> | null
			exceptions: InstanceType<typeof ICAL.Component>[]
		}
	>()

	for (const vevent of vevents as InstanceType<typeof ICAL.Component>[]) {
		const uid = vevent.getFirstPropertyValue("uid") as string | null
		if (!uid) continue

		const hasRecurrenceId = vevent.getFirstPropertyValue("recurrence-id") !== null
		let group = byUid.get(uid)
		if (!group) {
			group = { master: null, exceptions: [] }
			byUid.set(uid, group)
		}

		if (hasRecurrenceId) {
			group.exceptions.push(vevent)
		} else {
			group.master = vevent
		}
	}

	const results: CalDavEventData[] = []
	const rangeStart = ICAL.Time.fromJSDate(timeRange.start, true)
	const rangeEnd = ICAL.Time.fromJSDate(timeRange.end, true)

	for (const group of byUid.values()) {
		if (!group.master) {
			// Orphan exceptions — parse them directly if they fall in range
			for (const exc of group.exceptions) {
				const parsed = parseVEvent(exc, calendarName)
				if (overlapsRange(parsed, timeRange)) {
					results.push(parsed)
				}
			}
			continue
		}

		const masterEvent = new ICAL.Event(group.master)

		// Register exceptions so getOccurrenceDetails resolves them
		for (const exc of group.exceptions) {
			masterEvent.relateException(exc)
		}

		if (!masterEvent.isRecurring()) {
			const parsed = parseVEvent(group.master, calendarName)
			if (overlapsRange(parsed, timeRange)) {
				results.push(parsed)
			}
			// Also include standalone exceptions for non-recurring events
			for (const exc of group.exceptions) {
				const parsedExc = parseVEvent(exc, calendarName)
				if (overlapsRange(parsedExc, timeRange)) {
					results.push(parsedExc)
				}
			}
			continue
		}

		// Expand recurring event occurrences within the time range.
		// The iterator must start from DTSTART (not rangeStart) because
		// ical.js needs to walk the recurrence rule grid from the original
		// anchor. We cap iterations to avoid runaway expansion on
		// pathological rules.
		const iter = masterEvent.iterator()
		let next: InstanceType<typeof ICAL.Time> | null = iter.next()
		let iterations = 0

		while (next) {
			if (++iterations > MAX_RECURRENCE_ITERATIONS) {
				console.warn(
					`[aris.caldav] Recurrence expansion for "${masterEvent.uid}" hit iteration limit (${MAX_RECURRENCE_ITERATIONS}), stopping`,
				)
				break
			}

			// Stop once we're past the range end
			if (next.compare(rangeEnd) >= 0) break

			const details = masterEvent.getOccurrenceDetails(next)
			const occEnd = details.endDate

			// Skip occurrences that end before the range starts
			if (occEnd.compare(rangeStart) <= 0) {
				next = iter.next()
				continue
			}

			const occEvent = details.item
			const occComponent = occEvent.component

			const parsed = parseVEventWithDates(
				occComponent,
				calendarName,
				details.startDate.toJSDate(),
				details.endDate.toJSDate(),
				details.recurrenceId ? details.recurrenceId.toString() : null,
			)
			results.push(parsed)

			next = iter.next()
		}
	}

	return results
}

function overlapsRange(event: CalDavEventData, range: ICalTimeRange): boolean {
	return event.startDate < range.end && event.endDate > range.start
}

/**
 * Parse a VEVENT component, overriding start/end/recurrenceId with
 * values from recurrence expansion.
 */
function parseVEventWithDates(
	vevent: InstanceType<typeof ICAL.Component>,
	calendarName: string | null,
	startDate: Date,
	endDate: Date,
	recurrenceId: string | null,
): CalDavEventData {
	const event = new ICAL.Event(vevent)

	return {
		uid: event.uid ?? "",
		title: event.summary ?? "",
		startDate,
		endDate,
		isAllDay: event.startDate?.isDate ?? false,
		location: event.location ?? null,
		description: event.description ?? null,
		calendarName,
		status: parseStatus(asStringOrNull(vevent.getFirstPropertyValue("status"))),
		url: asStringOrNull(vevent.getFirstPropertyValue("url")),
		organizer: parseOrganizer(asStringOrNull(event.organizer), vevent),
		attendees: parseAttendees(Array.isArray(event.attendees) ? event.attendees : []),
		alarms: parseAlarms(vevent),
		recurrenceId,
	}
}

function parseVEvent(
	vevent: InstanceType<typeof ICAL.Component>,
	calendarName: string | null,
): CalDavEventData {
	const event = new ICAL.Event(vevent)

	return {
		uid: event.uid ?? "",
		title: event.summary ?? "",
		startDate: event.startDate?.toJSDate() ?? new Date(0),
		endDate: event.endDate?.toJSDate() ?? new Date(0),
		isAllDay: event.startDate?.isDate ?? false,
		location: event.location ?? null,
		description: event.description ?? null,
		calendarName,
		status: parseStatus(asStringOrNull(vevent.getFirstPropertyValue("status"))),
		url: asStringOrNull(vevent.getFirstPropertyValue("url")),
		organizer: parseOrganizer(asStringOrNull(event.organizer), vevent),
		attendees: parseAttendees(Array.isArray(event.attendees) ? event.attendees : []),
		alarms: parseAlarms(vevent),
		recurrenceId: event.recurrenceId ? event.recurrenceId.toString() : null,
	}
}

function parseStatus(raw: string | null): CalDavEventStatus | null {
	if (!raw) return null
	switch (raw.toLowerCase()) {
		case "confirmed":
			return CalDavEventStatus.Confirmed
		case "tentative":
			return CalDavEventStatus.Tentative
		case "cancelled":
			return CalDavEventStatus.Cancelled
		default:
			return null
	}
}

function parseOrganizer(
	value: string | null,
	vevent: InstanceType<typeof ICAL.Component>,
): string | null {
	if (!value) return null

	// Try CN parameter first
	const prop = vevent.getFirstProperty("organizer")
	if (prop) {
		const cn = prop.getParameter("cn") as string | undefined
		if (cn) return cn
	}

	// Fall back to mailto: value
	return value.replace(/^mailto:/i, "")
}

function parseAttendees(properties: unknown[]): CalDavAttendee[] {
	if (properties.length === 0) return []

	return properties.flatMap((prop) => {
		if (!prop || typeof prop !== "object" || !("getFirstValue" in prop)) return []
		const p = prop as InstanceType<typeof ICAL.Property>
		const value = asStringOrNull(p.getFirstValue())
		const cn = asStringOrNull(p.getParameter("cn"))
		const role = asStringOrNull(p.getParameter("role"))
		const partstat = asStringOrNull(p.getParameter("partstat"))

		return [
			{
				name: cn,
				email: value ? value.replace(/^mailto:/i, "") : null,
				role: parseAttendeeRole(role),
				status: parseAttendeeStatus(partstat),
			},
		]
	})
}

function parseAttendeeRole(raw: string | null): AttendeeRole | null {
	if (!raw) return null
	switch (raw.toUpperCase()) {
		case "CHAIR":
			return AttendeeRole.Chair
		case "REQ-PARTICIPANT":
			return AttendeeRole.Required
		case "OPT-PARTICIPANT":
			return AttendeeRole.Optional
		default:
			return null
	}
}

function parseAttendeeStatus(raw: string | null): AttendeeStatus | null {
	if (!raw) return null
	switch (raw.toUpperCase()) {
		case "ACCEPTED":
			return AttendeeStatus.Accepted
		case "DECLINED":
			return AttendeeStatus.Declined
		case "TENTATIVE":
			return AttendeeStatus.Tentative
		case "NEEDS-ACTION":
			return AttendeeStatus.NeedsAction
		default:
			return null
	}
}

function parseAlarms(vevent: InstanceType<typeof ICAL.Component>): CalDavAlarm[] {
	const valarms = vevent.getAllSubcomponents("valarm")
	if (!valarms || valarms.length === 0) return []

	return valarms.map((valarm: InstanceType<typeof ICAL.Component>) => {
		const trigger = valarm.getFirstPropertyValue("trigger")
		const action = asStringOrNull(valarm.getFirstPropertyValue("action"))

		return {
			trigger: trigger ? trigger.toString() : "",
			action: action ?? "DISPLAY",
		}
	})
}

function asStringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null
}
