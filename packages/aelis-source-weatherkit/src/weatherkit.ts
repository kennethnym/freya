// WeatherKit REST API client and response types
// https://developer.apple.com/documentation/weatherkitrestapi

import { type } from "arktype"

export interface WeatherKitCredentials {
	privateKey: string
	keyId: string
	teamId: string
	serviceId: string
}

export interface WeatherKitQueryOptions {
	lat: number
	lng: number
	language?: string
	timezone?: string
}

export interface WeatherKitClient {
	fetch(query: WeatherKitQueryOptions): Promise<WeatherKitResponse>
}

export class DefaultWeatherKitClient implements WeatherKitClient {
	private readonly credentials: WeatherKitCredentials

	constructor(credentials: WeatherKitCredentials) {
		this.credentials = credentials
	}

	async fetch(query: WeatherKitQueryOptions): Promise<WeatherKitResponse> {
		const token = await generateJwt(this.credentials)

		const dataSets = ["currentWeather", "forecastHourly", "forecastDaily", "weatherAlerts"].join(
			",",
		)

		const url = new URL(
			`${WEATHERKIT_API_BASE}/weather/${query.language ?? "en"}/${query.lat}/${query.lng}`,
		)
		url.searchParams.set("dataSets", dataSets)
		if (query.timezone) {
			url.searchParams.set("timezone", query.timezone)
		}

		const response = await fetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		})

		if (!response.ok) {
			const body = await response.text()
			throw new Error(`WeatherKit API error: ${response.status} ${response.statusText}: ${body}`)
		}

		const json = await response.json()
		const result = weatherKitResponseSchema(json)

		if (result instanceof type.errors) {
			throw new Error(`WeatherKit API response validation failed: ${result.summary}`)
		}

		return result
	}
}

export const Severity = {
	Minor: "minor",
	Moderate: "moderate",
	Severe: "severe",
	Extreme: "extreme",
} as const

export type Severity = (typeof Severity)[keyof typeof Severity]

export const Urgency = {
	Immediate: "immediate",
	Expected: "expected",
	Future: "future",
	Past: "past",
	Unknown: "unknown",
} as const

export type Urgency = (typeof Urgency)[keyof typeof Urgency]

export const Certainty = {
	Observed: "observed",
	Likely: "likely",
	Possible: "possible",
	Unlikely: "unlikely",
	Unknown: "unknown",
} as const

export type Certainty = (typeof Certainty)[keyof typeof Certainty]

export const PrecipitationType = {
	Clear: "clear",
	Precipitation: "precipitation",
	Rain: "rain",
	Snow: "snow",
	Sleet: "sleet",
	Hail: "hail",
	Mixed: "mixed",
} as const

export type PrecipitationType = (typeof PrecipitationType)[keyof typeof PrecipitationType]

export const ConditionCode = {
	Clear: "Clear",
	Cloudy: "Cloudy",
	Dust: "Dust",
	Fog: "Fog",
	Haze: "Haze",
	MostlyClear: "MostlyClear",
	MostlyCloudy: "MostlyCloudy",
	PartlyCloudy: "PartlyCloudy",
	ScatteredThunderstorms: "ScatteredThunderstorms",
	Smoke: "Smoke",
	Breezy: "Breezy",
	Windy: "Windy",
	Drizzle: "Drizzle",
	HeavyRain: "HeavyRain",
	Rain: "Rain",
	Showers: "Showers",
	Flurries: "Flurries",
	HeavySnow: "HeavySnow",
	MixedRainAndSleet: "MixedRainAndSleet",
	MixedRainAndSnow: "MixedRainAndSnow",
	MixedRainfall: "MixedRainfall",
	MixedSnowAndSleet: "MixedSnowAndSleet",
	ScatteredShowers: "ScatteredShowers",
	ScatteredSnowShowers: "ScatteredSnowShowers",
	Sleet: "Sleet",
	Snow: "Snow",
	SnowShowers: "SnowShowers",
	Blizzard: "Blizzard",
	BlowingSnow: "BlowingSnow",
	FreezingDrizzle: "FreezingDrizzle",
	FreezingRain: "FreezingRain",
	Frigid: "Frigid",
	Hail: "Hail",
	Hot: "Hot",
	Hurricane: "Hurricane",
	IsolatedThunderstorms: "IsolatedThunderstorms",
	SevereThunderstorm: "SevereThunderstorm",
	Thunderstorm: "Thunderstorm",
	Tornado: "Tornado",
	TropicalStorm: "TropicalStorm",
} as const

export type ConditionCode = (typeof ConditionCode)[keyof typeof ConditionCode]

const WEATHERKIT_API_BASE = "https://weatherkit.apple.com/api/v1"

const severitySchema = type.enumerated(
	Severity.Minor,
	Severity.Moderate,
	Severity.Severe,
	Severity.Extreme,
)

const urgencySchema = type.enumerated(
	Urgency.Immediate,
	Urgency.Expected,
	Urgency.Future,
	Urgency.Past,
	Urgency.Unknown,
)

const certaintySchema = type.enumerated(
	Certainty.Observed,
	Certainty.Likely,
	Certainty.Possible,
	Certainty.Unlikely,
	Certainty.Unknown,
)

const precipitationTypeSchema = type.enumerated(
	PrecipitationType.Clear,
	PrecipitationType.Precipitation,
	PrecipitationType.Rain,
	PrecipitationType.Snow,
	PrecipitationType.Sleet,
	PrecipitationType.Hail,
	PrecipitationType.Mixed,
)

const conditionCodeSchema = type.enumerated(...Object.values(ConditionCode))

const pressureTrendSchema = type.enumerated("rising", "falling", "steady")

const currentWeatherSchema = type({
	asOf: "string",
	conditionCode: conditionCodeSchema,
	daylight: "boolean",
	humidity: "number",
	precipitationIntensity: "number",
	pressure: "number",
	pressureTrend: pressureTrendSchema,
	temperature: "number",
	temperatureApparent: "number",
	temperatureDewPoint: "number",
	uvIndex: "number",
	visibility: "number",
	windDirection: "number",
	windGust: "number",
	windSpeed: "number",
})

export type CurrentWeather = typeof currentWeatherSchema.infer

const hourlyForecastSchema = type({
	forecastStart: "string",
	conditionCode: conditionCodeSchema,
	daylight: "boolean",
	humidity: "number",
	precipitationAmount: "number",
	precipitationChance: "number",
	precipitationType: precipitationTypeSchema,
	pressure: "number",
	snowfallIntensity: "number",
	temperature: "number",
	temperatureApparent: "number",
	temperatureDewPoint: "number",
	uvIndex: "number",
	visibility: "number",
	windDirection: "number",
	windGust: "number",
	windSpeed: "number",
})

export type HourlyForecast = typeof hourlyForecastSchema.infer

const dayWeatherConditionsSchema = type({
	conditionCode: conditionCodeSchema,
	humidity: "number",
	precipitationAmount: "number",
	precipitationChance: "number",
	precipitationType: precipitationTypeSchema,
	snowfallAmount: "number",
	temperatureMax: "number",
	temperatureMin: "number",
	windDirection: "number",
	"windGust?": "number",
	windSpeed: "number",
})

export type DayWeatherConditions = typeof dayWeatherConditionsSchema.infer

const dailyForecastSchema = type({
	forecastStart: "string",
	forecastEnd: "string",
	conditionCode: conditionCodeSchema,
	maxUvIndex: "number",
	moonPhase: "string",
	"moonrise?": "string",
	"moonset?": "string",
	precipitationAmount: "number",
	precipitationChance: "number",
	precipitationType: precipitationTypeSchema,
	snowfallAmount: "number",
	sunrise: "string",
	sunriseCivil: "string",
	sunriseNautical: "string",
	sunriseAstronomical: "string",
	sunset: "string",
	sunsetCivil: "string",
	sunsetNautical: "string",
	sunsetAstronomical: "string",
	temperatureMax: "number",
	temperatureMin: "number",
	"daytimeForecast?": dayWeatherConditionsSchema,
	"overnightForecast?": dayWeatherConditionsSchema,
})

export type DailyForecast = typeof dailyForecastSchema.infer

const weatherAlertSchema = type({
	id: "string",
	areaId: "string",
	areaName: "string",
	certainty: certaintySchema,
	countryCode: "string",
	description: "string",
	detailsUrl: "string",
	effectiveTime: "string",
	expireTime: "string",
	issuedTime: "string",
	responses: "string[]",
	severity: severitySchema,
	source: "string",
	urgency: urgencySchema,
})

export type WeatherAlert = typeof weatherAlertSchema.infer

const weatherKitResponseSchema = type({
	"currentWeather?": currentWeatherSchema,
	"forecastHourly?": type({
		hours: hourlyForecastSchema.array(),
	}),
	"forecastDaily?": type({
		days: dailyForecastSchema.array(),
	}),
	"weatherAlerts?": type({
		alerts: weatherAlertSchema.array(),
	}),
})

export type WeatherKitResponse = typeof weatherKitResponseSchema.infer

async function generateJwt(credentials: WeatherKitCredentials): Promise<string> {
	const header = {
		alg: "ES256",
		kid: credentials.keyId,
		id: `${credentials.teamId}.${credentials.serviceId}`,
	}

	const now = Math.floor(Date.now() / 1000)
	const payload = {
		iss: credentials.teamId,
		iat: now,
		exp: now + 3600,
		sub: credentials.serviceId,
	}

	const encoder = new TextEncoder()
	const headerB64 = btoa(JSON.stringify(header))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")
	const payloadB64 = btoa(JSON.stringify(payload))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")

	const signingInput = `${headerB64}.${payloadB64}`

	const pemContents = credentials.privateKey
		.replace(/-----BEGIN PRIVATE KEY-----/, "")
		.replace(/-----END PRIVATE KEY-----/, "")
		.replace(/\s/g, "")

	const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0))

	const cryptoKey = await crypto.subtle.importKey(
		"pkcs8",
		binaryKey,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	)

	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		cryptoKey,
		encoder.encode(signingInput),
	)

	const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")

	return `${signingInput}.${signatureB64}`
}
