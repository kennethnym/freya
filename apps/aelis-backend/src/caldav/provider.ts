import { CalDavSource } from "@aelis/source-caldav"
import { type } from "arktype"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

import { InvalidSourceCredentialsError } from "../sources/errors.ts"

const caldavConfig = type({
	"+": "reject",
	serverUrl: "string",
	username: "string",
	"lookAheadDays?": "number",
	"timeZone?": "string",
})

const caldavCredentials = type({
	"+": "reject",
	password: "string",
})

export class CalDavSourceProvider implements FeedSourceProvider {
	readonly sourceId = "aelis.caldav"
	readonly configSchema = caldavConfig

	async feedSourceForUser(
		_userId: string,
		config: unknown,
		credentials: unknown,
	): Promise<CalDavSource> {
		const parsed = caldavConfig(config)
		if (parsed instanceof type.errors) {
			throw new Error(`Invalid CalDAV config: ${parsed.summary}`)
		}

		if (!credentials) {
			throw new InvalidSourceCredentialsError("aelis.caldav", "No CalDAV credentials configured")
		}

		const creds = caldavCredentials(credentials)
		if (creds instanceof type.errors) {
			throw new InvalidSourceCredentialsError("aelis.caldav", creds.summary)
		}

		return new CalDavSource({
			serverUrl: parsed.serverUrl,
			authMethod: "basic",
			username: parsed.username,
			password: creds.password,
			lookAheadDays: parsed.lookAheadDays,
			timeZone: parsed.timeZone,
		})
	}
}
