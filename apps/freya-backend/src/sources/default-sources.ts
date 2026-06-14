import { LocationSource } from "@freya/source-location"
import { ReminderSource } from "@freya/source-reminders"
import { WebSearchSource } from "@freya/source-web-search"

import type { Database } from "../db/index.ts"

import { userSources } from "../db/schema.ts"

export const DEFAULT_ENABLED_SOURCE_IDS = [
	LocationSource.id,
	ReminderSource.id,
	WebSearchSource.id,
] as const

export type DefaultEnabledSourceId = (typeof DEFAULT_ENABLED_SOURCE_IDS)[number]

export async function insertDefaultUserSources(db: Database, userId: string): Promise<void> {
	const now = new Date()

	await db
		.insert(userSources)
		.values(
			DEFAULT_ENABLED_SOURCE_IDS.map((sourceId) => ({
				userId,
				sourceId,
				enabled: true,
				config: {},
				createdAt: now,
				updatedAt: now,
			})),
		)
		.onConflictDoNothing({
			target: [userSources.userId, userSources.sourceId],
		})
}
