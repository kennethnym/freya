/**
 * Registry of all known feed source types and their configuration schemas.
 * Used by the admin API to describe available sources and validate config.
 */

const FieldType = {
	String: "string",
	Number: "number",
	Select: "select",
} as const
type FieldType = (typeof FieldType)[keyof typeof FieldType]

interface BaseFieldDef {
	label: string
	required?: boolean
	description?: string
}

interface StringFieldDef extends BaseFieldDef {
	type: typeof FieldType.String
	secret?: boolean
	defaultValue?: string
}

interface NumberFieldDef extends BaseFieldDef {
	type: typeof FieldType.Number
	defaultValue?: number
}

interface SelectFieldDef extends BaseFieldDef {
	type: typeof FieldType.Select
	options: { label: string; value: string }[]
	defaultValue?: string
}

export type ConfigFieldDef = StringFieldDef | NumberFieldDef | SelectFieldDef

export interface SourceDefinition {
	id: string
	name: string
	description: string
	/** Whether this source is always enabled and cannot be toggled off */
	alwaysEnabled?: boolean
	fields: Record<string, ConfigFieldDef>
}

export const sourceRegistry: SourceDefinition[] = [
	{
		id: "aelis.location",
		name: "Location",
		description: "Device location provider. Always enabled as a dependency for other sources.",
		alwaysEnabled: true,
		fields: {},
	},
	{
		id: "aelis.weather",
		name: "WeatherKit",
		description: "Apple WeatherKit weather data. Requires Apple Developer credentials.",
		fields: {
			privateKey: {
				type: FieldType.String,
				label: "Private Key",
				required: true,
				secret: true,
				description: "Apple WeatherKit private key (PEM format)",
			},
			keyId: {
				type: FieldType.String,
				label: "Key ID",
				required: true,
			},
			teamId: {
				type: FieldType.String,
				label: "Team ID",
				required: true,
			},
			serviceId: {
				type: FieldType.String,
				label: "Service ID",
				required: true,
			},
			units: {
				type: FieldType.Select,
				label: "Units",
				options: [
					{ label: "Metric", value: "metric" },
					{ label: "Imperial", value: "imperial" },
				],
				defaultValue: "metric",
			},
			hourlyLimit: {
				type: FieldType.Number,
				label: "Hourly Forecast Limit",
				defaultValue: 12,
				description: "Number of hourly forecasts to include",
			},
			dailyLimit: {
				type: FieldType.Number,
				label: "Daily Forecast Limit",
				defaultValue: 7,
				description: "Number of daily forecasts to include",
			},
		},
	},
	{
		id: "aelis.tfl",
		name: "TFL",
		description: "Transport for London status updates.",
		fields: {
			apiKey: {
				type: FieldType.String,
				label: "API Key",
				required: true,
				secret: true,
			},
		},
	},
	{
		id: "aelis.caldav",
		name: "CalDAV",
		description: "CalDAV calendar source (basic auth).",
		fields: {
			serverUrl: {
				type: FieldType.String,
				label: "Server URL",
				required: true,
				description: "CalDAV server URL",
			},
			username: {
				type: FieldType.String,
				label: "Username",
				required: true,
			},
			password: {
				type: FieldType.String,
				label: "Password",
				required: true,
				secret: true,
			},
			lookAheadDays: {
				type: FieldType.Number,
				label: "Look-Ahead Days",
				defaultValue: 0,
				description: "Days beyond today to fetch (0 = today only)",
			},
			timeZone: {
				type: FieldType.String,
				label: "Time Zone",
				defaultValue: "UTC",
				description: "IANA timezone (e.g. America/New_York)",
			},
		},
	},
	{
		id: "aelis.google-calendar",
		name: "Google Calendar",
		description: "Google Calendar events via OAuth.",
		fields: {
			clientId: {
				type: FieldType.String,
				label: "Client ID",
				required: true,
			},
			clientSecret: {
				type: FieldType.String,
				label: "Client Secret",
				required: true,
				secret: true,
			},
			accessToken: {
				type: FieldType.String,
				label: "Access Token",
				required: true,
				secret: true,
			},
			refreshToken: {
				type: FieldType.String,
				label: "Refresh Token",
				required: true,
				secret: true,
			},
			tokenUrl: {
				type: FieldType.String,
				label: "Token URL",
				required: true,
				defaultValue: "https://oauth2.googleapis.com/token",
			},
			calendarIds: {
				type: FieldType.String,
				label: "Calendar IDs",
				description: "Comma-separated list of calendar IDs",
			},
			lookaheadHours: {
				type: FieldType.Number,
				label: "Lookahead Hours",
				defaultValue: 24,
			},
		},
	},
]

const registryMap = new Map(sourceRegistry.map((s) => [s.id, s]))

export function getSourceDefinition(sourceId: string): SourceDefinition | undefined {
	return registryMap.get(sourceId)
}

export function isKnownSource(sourceId: string): boolean {
	return registryMap.has(sourceId)
}
