import type { ContextKey } from "@freya/core"

import { contextKey } from "@freya/core"

import type { ReminderOccurrence } from "./types.ts"

/**
 * Reminder occurrences in the source's current look-back/look-ahead window.
 *
 * Recurrence overrides and the source's completed-occurrence filtering have
 * already been applied to this snapshot.
 *
 * The source publishes an empty list when the window contains no occurrences,
 * allowing consumers to replace stale reminder context during refreshes.
 */
export const ReminderOccurrencesKey: ContextKey<readonly ReminderOccurrence[]> = contextKey(
	"freya.reminders",
	"occurrences",
)
