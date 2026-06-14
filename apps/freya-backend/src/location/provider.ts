import { LocationSource } from "@freya/source-location"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

export class LocationSourceProvider implements FeedSourceProvider {
	readonly sourceId = LocationSource.id

	async feedSourceForUser(
		_userId: string,
		_config: unknown,
		_credentials: unknown,
	): Promise<LocationSource> {
		return new LocationSource()
	}
}
