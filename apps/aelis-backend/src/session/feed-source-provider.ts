import type { FeedSource } from "@aelis/core"
import type { type } from "arktype"

export type ConfigSchema = ReturnType<typeof type>

export interface FeedSourceProvider {
	/** The source ID this provider is responsible for (e.g., "aelis.location"). */
	readonly sourceId: string
	/** Arktype schema for validating user-provided config. Omit if the source has no config. */
	readonly configSchema?: ConfigSchema
	feedSourceForUser(userId: string, config: unknown): Promise<FeedSource>
}
