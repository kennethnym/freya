import {
	McpSource,
	type McpActionMapping,
	type McpClient,
	type McpHttpHeaders,
	type McpSourceOptions,
} from "@freya/source-mcp"

import {
	ComputeRoutesInput,
	LookupWeatherInput,
	ResolveMapsUrlsInput,
	ResolveNamesInput,
	SearchPlacesInput,
} from "./schemas"

export type GoogleMapsApiKey = string | (() => Promise<string>)

export interface GoogleMapsSourceOptions {
	readonly endpoint?: string | URL
	readonly apiKey?: GoogleMapsApiKey
	readonly timeoutMs?: number
	readonly headers?: McpHttpHeaders | (() => Promise<McpHttpHeaders>)
	readonly requestInit?: RequestInit
	readonly transportOptions?: McpSourceOptions["transportOptions"]
	readonly client?: McpClient
	readonly clientFactory?: McpSourceOptions["clientFactory"]
}

export const GoogleMapsSourceId = "freya.google-maps"

export const GoogleMapsMcpEndpoint = "https://mapstools.googleapis.com/mcp"

export const GoogleMapsAction = {
	SearchPlaces: "search-places",
	LookupWeather: "lookup-weather",
	ComputeRoutes: "compute-routes",
	ResolveNames: "resolve-names",
	ResolveMapsUrls: "resolve-maps-urls",
} as const

export type GoogleMapsAction = (typeof GoogleMapsAction)[keyof typeof GoogleMapsAction]

export const GoogleMapsTool = {
	SearchPlaces: "search_places",
	LookupWeather: "lookup_weather",
	ComputeRoutes: "compute_routes",
	ResolveNames: "resolve_names",
	ResolveMapsUrls: "resolve_maps_urls",
} as const

export type GoogleMapsTool = (typeof GoogleMapsTool)[keyof typeof GoogleMapsTool]

const GoogleMapsActions = {
	[GoogleMapsAction.SearchPlaces]: {
		tool: GoogleMapsTool.SearchPlaces,
		description:
			"Find places, businesses, addresses, locations, and points of interest with Google Maps.",
		input: SearchPlacesInput,
	},
	[GoogleMapsAction.LookupWeather]: {
		tool: GoogleMapsTool.LookupWeather,
		description: "Retrieve current conditions and weather forecasts through Google Maps.",
		input: LookupWeatherInput,
	},
	[GoogleMapsAction.ComputeRoutes]: {
		tool: GoogleMapsTool.ComputeRoutes,
		description: "Compute a Google Maps route between an origin and destination.",
		input: ComputeRoutesInput,
	},
	[GoogleMapsAction.ResolveNames]: {
		tool: GoogleMapsTool.ResolveNames,
		description: "Resolve specific place names or addresses into Google Maps Place IDs.",
		input: ResolveNamesInput,
	},
	[GoogleMapsAction.ResolveMapsUrls]: {
		tool: GoogleMapsTool.ResolveMapsUrls,
		description: "Resolve Google Maps URLs into canonical Google Maps Place IDs.",
		input: ResolveMapsUrlsInput,
	},
} as const satisfies Record<GoogleMapsAction, McpActionMapping>

export class GoogleMapsSource extends McpSource {
	constructor(options: GoogleMapsSourceOptions = {}) {
		super({
			id: GoogleMapsSourceId,
			url: options.endpoint ?? GoogleMapsMcpEndpoint,
			clientName: "freya-source-google-maps",
			clientVersion: "0.0.0",
			timeoutMs: options.timeoutMs,
			headers: createGoogleMapsHeaders({
				headers: options.headers,
				apiKey: options.apiKey,
			}),
			requestInit: options.requestInit,
			transportOptions: options.transportOptions,
			client: options.client,
			clientFactory: options.clientFactory,
			actions: GoogleMapsActions,
		})
	}
}

interface GoogleMapsHeaderOptions {
	readonly headers: McpHttpHeaders | (() => Promise<McpHttpHeaders>) | undefined
	readonly apiKey: GoogleMapsApiKey | undefined
}

function createGoogleMapsHeaders({
	headers,
	apiKey,
}: GoogleMapsHeaderOptions): McpHttpHeaders | (() => Promise<McpHttpHeaders>) | undefined {
	if (!apiKey) {
		return headers
	}

	return async () => {
		const merged = new Headers()
		const resolvedHeaders = typeof headers === "function" ? await headers() : headers
		if (resolvedHeaders) {
			applyHeaders(merged, resolvedHeaders)
		}

		if (apiKey) {
			const resolvedApiKey = typeof apiKey === "function" ? await apiKey() : apiKey
			merged.set("x-goog-api-key", resolvedApiKey)
		}

		return merged
	}
}

function applyHeaders(target: Headers, headers: McpHttpHeaders): void {
	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			target.set(key, value)
		})
		return
	}

	if (Array.isArray(headers)) {
		for (const [key, value] of headers) {
			target.set(key, value)
		}
		return
	}

	for (const [key, value] of Object.entries(headers)) {
		target.set(key, value)
	}
}
