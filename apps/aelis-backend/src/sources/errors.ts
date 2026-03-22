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
