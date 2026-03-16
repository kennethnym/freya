/**
 * Thrown by a FeedSourceProvider when the source is not enabled for a user.
 *
 * UserSessionManager's Promise.allSettled handles this gracefully —
 * the source is excluded from the session without crashing.
 */
export class SourceDisabledError extends Error {
	readonly sourceId: string
	readonly userId: string

	constructor(sourceId: string, userId: string) {
		super(`Source "${sourceId}" is not enabled for user "${userId}"`)
		this.name = "SourceDisabledError"
		this.sourceId = sourceId
		this.userId = userId
	}
}

/**
 * Thrown when an operation targets a user source that doesn't exist.
 */
export class SourceNotFoundError extends Error {
	readonly sourceId: string
	readonly userId: string

	constructor(sourceId: string, userId: string) {
		super(`Source "${sourceId}" not found for user "${userId}"`)
		this.name = "SourceNotFoundError"
		this.sourceId = sourceId
		this.userId = userId
	}
}
