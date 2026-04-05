import { LocationSource } from "@aelis/source-location"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

export class LocationSourceProvider implements FeedSourceProvider {
	readonly sourceId = "aelis.location"

	async feedSourceForUser(
		_userId: string,
		_config: unknown,
		_credentials: unknown,
	): Promise<LocationSource> {
		return new LocationSource()
	}
}
