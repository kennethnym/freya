import { ReminderSource, ReminderTimeZoneInput } from "@freya/source-reminders"
import { type } from "arktype"

import type { Database } from "../db/index.ts"
import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

import { DrizzleReminderStorage } from "./storage.ts"

export interface ReminderSourceProviderOptions {
	db: Database
}

export const reminderConfig = type({
	"+": "reject",
	"lookAheadMs?": "number.integer >= 0",
	"lookBackMs?": "number.integer >= 0",
	"includeCompleted?": "boolean",
	"defaultTimeZone?": ReminderTimeZoneInput,
})

export class ReminderSourceProvider implements FeedSourceProvider {
	readonly sourceId = "freya.reminders"
	readonly configSchema = reminderConfig
	private readonly db: Database

	constructor(options: ReminderSourceProviderOptions) {
		this.db = options.db
	}

	async feedSourceForUser(
		userId: string,
		config: unknown,
		_credentials: unknown,
	): Promise<ReminderSource> {
		const parsed = reminderConfig(config)
		if (parsed instanceof type.errors) {
			throw new Error(`Invalid reminders config: ${parsed.summary}`)
		}

		return new ReminderSource({
			storage: new DrizzleReminderStorage(this.db, userId),
			lookAheadMs: parsed.lookAheadMs,
			lookBackMs: parsed.lookBackMs,
			includeCompleted: parsed.includeCompleted,
			defaultTimeZone: parsed.defaultTimeZone,
		})
	}
}
