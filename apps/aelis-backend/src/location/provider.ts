import { LocationSource } from "@aelis/source-location"

import type { Database } from "../db/index.ts"
import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

import { SourceDisabledError } from "../sources/errors.ts"
import { sources } from "../sources/user-sources.ts"

export class LocationSourceProvider implements FeedSourceProvider {
	readonly sourceId = "aelis.location"
	private readonly db: Database

	constructor(db: Database) {
		this.db = db
	}

	async feedSourceForUser(userId: string): Promise<LocationSource> {
		const row = await sources(this.db, userId).find("aelis.location")

		if (!row || !row.enabled) {
			throw new SourceDisabledError("aelis.location", userId)
		}

		return new LocationSource()
	}
}
