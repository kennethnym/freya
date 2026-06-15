import type { FeedSource } from "@freya/core"

export type ConfigSchema = (value: unknown) => unknown

export interface FeedSourceProvider {
	/** The source ID this provider is responsible for (e.g., "freya.location"). */
	readonly sourceId: string
	/** Arktype schema for validating user-provided config. Omit if the source has no config. */
	readonly configSchema?: ConfigSchema
	feedSourceForUser(userId: string, config: unknown, credentials: unknown): Promise<FeedSource>
}
