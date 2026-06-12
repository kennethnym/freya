import { getServerUrl } from "./server-url"

function apiBase() {
	return `${getServerUrl()}/api/admin`
}

function serverBase() {
	return `${getServerUrl()}/api`
}

export interface ConfigFieldDef {
	type: "string" | "number" | "select" | "multiselect"
	label: string
	required?: boolean
	description?: string
	secret?: boolean
	defaultValue?: string | number | string[]
	options?: { label: string; value: string }[]
}

export interface SourceDefinition {
	id: string
	name: string
	description: string
	alwaysEnabled?: boolean
	/** When true, secret fields are stored as per-user credentials via /api/sources/:id/credentials. */
	perUserCredentials?: boolean
	fields: Record<string, ConfigFieldDef>
}

export interface SourceConfig {
	sourceId: string
	enabled: boolean
	config: Record<string, unknown>
}

const sourceDefinitions: SourceDefinition[] = [
	{
		id: "freya.location",
		name: "Location",
		description: "Device location provider. Always enabled as a dependency for other sources.",
		alwaysEnabled: true,
		fields: {},
	},
	{
		id: "freya.weather",
		name: "WeatherKit",
		description: "Apple WeatherKit weather data. Requires Apple Developer credentials.",
		fields: {
			privateKey: {
				type: "string",
				label: "Private Key",
				required: true,
				secret: true,
				description: "Apple WeatherKit private key (PEM format)",
			},
			keyId: { type: "string", label: "Key ID", required: true, secret: true },
			teamId: { type: "string", label: "Team ID", required: true, secret: true },
			serviceId: { type: "string", label: "Service ID", required: true, secret: true },
			units: {
				type: "select",
				label: "Units",
				options: [
					{ label: "Metric", value: "metric" },
					{ label: "Imperial", value: "imperial" },
				],
				defaultValue: "metric",
			},
			hourlyLimit: {
				type: "number",
				label: "Hourly Forecast Limit",
				defaultValue: 12,
				description: "Number of hourly forecasts to include",
			},
			dailyLimit: {
				type: "number",
				label: "Daily Forecast Limit",
				defaultValue: 7,
				description: "Number of daily forecasts to include",
			},
		},
	},
	{
		id: "freya.caldav",
		name: "CalDAV",
		description: "Calendar events from any CalDAV server (Nextcloud, Radicale, Baikal, etc.).",
		perUserCredentials: true,
		fields: {
			serverUrl: {
				type: "string",
				label: "Server URL",
				required: true,
				secret: false,
				description: "CalDAV server URL (e.g. https://nextcloud.example.com/remote.php/dav)",
			},
			username: {
				type: "string",
				label: "Username",
				required: true,
				secret: false,
			},
			password: {
				type: "string",
				label: "Password",
				required: true,
				secret: true,
			},
			lookAheadDays: {
				type: "number",
				label: "Look-ahead Days",
				defaultValue: 0,
				description: "Number of additional days beyond today to fetch events for",
			},
			timeZone: {
				type: "string",
				label: "Timezone",
				description: 'IANA timezone for determining "today" (e.g. Europe/London). Defaults to UTC.',
			},
		},
	},
	{
		id: "freya.tfl",
		name: "TfL",
		description: "Transport for London tube line status alerts.",
		fields: {
			lines: {
				type: "multiselect",
				label: "Lines",
				description: "Lines to monitor. Leave empty for all lines.",
				defaultValue: [],
				options: [
					{ label: "Bakerloo", value: "bakerloo" },
					{ label: "Central", value: "central" },
					{ label: "Circle", value: "circle" },
					{ label: "District", value: "district" },
					{ label: "Hammersmith & City", value: "hammersmith-city" },
					{ label: "Jubilee", value: "jubilee" },
					{ label: "Metropolitan", value: "metropolitan" },
					{ label: "Northern", value: "northern" },
					{ label: "Piccadilly", value: "piccadilly" },
					{ label: "Victoria", value: "victoria" },
					{ label: "Waterloo & City", value: "waterloo-city" },
					{ label: "Lioness", value: "lioness" },
					{ label: "Mildmay", value: "mildmay" },
					{ label: "Windrush", value: "windrush" },
					{ label: "Weaver", value: "weaver" },
					{ label: "Suffragette", value: "suffragette" },
					{ label: "Liberty", value: "liberty" },
					{ label: "Elizabeth", value: "elizabeth" },
				],
			},
		},
	},
	{
		id: "freya.web-search",
		name: "Web Search",
		description: "Exa web search action. Requires EXA_API_KEY on the backend.",
		fields: {},
	},
]

export function fetchSources(): Promise<SourceDefinition[]> {
	return Promise.resolve(sourceDefinitions)
}

export async function fetchSourceConfig(sourceId: string): Promise<SourceConfig | null> {
	const res = await fetch(`${serverBase()}/sources/${sourceId}`, {
		credentials: "include",
	})
	if (res.status === 404) return null
	if (!res.ok) throw new Error(`Failed to fetch source config: ${res.status}`)
	const data = (await res.json()) as { enabled: boolean; config: Record<string, unknown> }
	return { sourceId, enabled: data.enabled, config: data.config }
}

export async function fetchConfigs(): Promise<SourceConfig[]> {
	const results = await Promise.all(sourceDefinitions.map((s) => fetchSourceConfig(s.id)))
	return results.filter((c): c is SourceConfig => c !== null)
}

export async function replaceSource(
	sourceId: string,
	body: { enabled: boolean; config?: unknown; credentials?: Record<string, unknown> },
): Promise<void> {
	const res = await fetch(`${serverBase()}/sources/${sourceId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		const data = (await res.json()) as { error?: string }
		throw new Error(data.error ?? `Failed to replace source config: ${res.status}`)
	}
}

export async function updateProviderConfig(
	sourceId: string,
	body: Record<string, unknown>,
): Promise<void> {
	const res = await fetch(`${apiBase()}/${sourceId}/config`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		const data = (await res.json()) as { error?: string }
		throw new Error(data.error ?? `Failed to update provider config: ${res.status}`)
	}
}

export async function updateSourceCredentials(
	sourceId: string,
	credentials: Record<string, unknown>,
): Promise<void> {
	const res = await fetch(`${serverBase()}/sources/${sourceId}/credentials`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify(credentials),
	})
	if (!res.ok) {
		const data = (await res.json()) as { error?: string }
		throw new Error(data.error ?? `Failed to update credentials: ${res.status}`)
	}
}

export interface LocationInput {
	lat: number
	lng: number
	accuracy: number
}

export async function pushLocation(location: LocationInput): Promise<void> {
	const res = await fetch(`${serverBase()}/location`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({
			...location,
			timestamp: new Date().toISOString(),
		}),
	})
	if (!res.ok) {
		const data = (await res.json()) as { error?: string }
		throw new Error(data.error ?? `Failed to push location: ${res.status}`)
	}
}

export interface FeedItemSlot {
	description: string
	content: string | null
}

export interface FeedItem {
	id: string
	sourceId: string
	type: string
	timestamp: string
	data: Record<string, unknown>
	signals?: {
		urgency?: number
		timeRelevance?: string
	}
	slots?: Record<string, FeedItemSlot>
	ui?: unknown
}

export interface FeedResponse {
	items: FeedItem[]
	errors: { sourceId: string; error: string }[]
}

export async function fetchFeed(): Promise<FeedResponse> {
	const res = await fetch(`${serverBase()}/feed`, { credentials: "include" })
	if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`)
	return res.json() as Promise<FeedResponse>
}
