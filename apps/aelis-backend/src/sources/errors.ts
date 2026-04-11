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

/**
 * Thrown when a source config update fails schema validation.
 */
export class InvalidSourceConfigError extends Error {
	readonly sourceId: string

	constructor(sourceId: string, summary: string) {
		super(summary)
		this.sourceId = sourceId
	}
}

/**
 * Thrown by providers when credentials fail validation.
 */
export class InvalidSourceCredentialsError extends Error {
	readonly sourceId: string

	constructor(sourceId: string, summary: string) {
		super(summary)
		this.name = "InvalidSourceCredentialsError"
		this.sourceId = sourceId
	}
}

/**
 * Thrown when credential storage is not configured (missing encryption key).
 */
export class CredentialStorageUnavailableError extends Error {
	constructor() {
		super("Credential storage is not configured")
		this.name = "CredentialStorageUnavailableError"
	}
}
