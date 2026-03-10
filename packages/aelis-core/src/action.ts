import type { StandardSchemaV1 } from "@standard-schema/spec"

/**
 * Describes an action a source can perform.
 *
 * Action IDs use descriptive verb-noun kebab-case (e.g., "update-location", "play-track").
 * Combined with the source's reverse-domain ID, they form a globally unique identifier:
 * `<sourceId>/<actionId>` (e.g., "aelis.location/update-location").
 */
export class UnknownActionError extends Error {
	readonly actionId: string

	constructor(actionId: string) {
		super(`Unknown action: ${actionId}`)
		this.name = "UnknownActionError"
		this.actionId = actionId
	}
}

export interface ActionDefinition<TInput = unknown> {
	/** Descriptive action name in kebab-case (e.g., "update-location", "play-track") */
	readonly id: string
	/** Optional longer description */
	readonly description?: string
	/** Schema for input validation. Accepts any Standard Schema compatible validator (arktype, zod, valibot, etc.). */
	readonly input?: StandardSchemaV1<TInput>
}
