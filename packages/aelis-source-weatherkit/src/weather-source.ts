import type { ActionDefinition, ContextEntry, FeedItemSignals, FeedSource } from "@aelis/core"

import { Context, TimeRelevance, UnknownActionError } from "@aelis/core"
import { LocationKey } from "@aelis/source-location"

import { WeatherFeedItemType, type WeatherFeedItem } from "./feed-items"
import currentWeatherInsightPrompt from "./prompts/current-weather-insight.txt"
import { WeatherKey, type Weather } from "./weather-context"
import {
	DefaultWeatherKitClient,
	type ConditionCode,
	type CurrentWeather,
	type DailyForecast,
	type HourlyForecast,
	type Severity,
	type WeatherAlert,
	type WeatherKitClient,
	type WeatherKitCredentials,
} from "./weatherkit"

export const Units = {
	metric: "metric",
	imperial: "imperial",
} as const

export type Units = (typeof Units)[keyof typeof Units]

export interface WeatherSourceOptions {
	credentials?: WeatherKitCredentials
	client?: WeatherKitClient
	/** Number of hourly forecasts to include (default: 12) */
	hourlyLimit?: number
	/** Number of daily forecasts to include (default: 7) */
	dailyLimit?: number
	/** Units for temperature and measurements (default: metric) */
	units?: Units
}

const DEFAULT_HOURLY_LIMIT = 12
const DEFAULT_DAILY_LIMIT = 7

const BASE_URGENCY = {
	current: 0.5,
	hourly: 0.3,
	daily: 0.2,
	alert: 0.7,
} as const

const SEVERE_CONDITIONS = new Set<ConditionCode>([
	"SevereThunderstorm",
	"Hurricane",
	"Tornado",
	"TropicalStorm",
	"Blizzard",
	"FreezingRain",
	"Hail",
	"Frigid",
	"Hot",
])

const MODERATE_CONDITIONS = new Set<ConditionCode>([
	"Thunderstorm",
	"IsolatedThunderstorms",
	"ScatteredThunderstorms",
	"HeavyRain",
	"HeavySnow",
	"FreezingDrizzle",
	"BlowingSnow",
])

/**
 * A FeedSource that provides weather context and feed items using Apple WeatherKit.
 *
 * Depends on location source for coordinates. Provides simplified weather context
 * for downstream sources and produces weather feed items (current, hourly, daily, alerts).
 *
 * @example
 * ```ts
 * const weatherSource = new WeatherSource({
 *   credentials: {
 *     privateKey: process.env.WEATHERKIT_PRIVATE_KEY!,
 *     keyId: process.env.WEATHERKIT_KEY_ID!,
 *     teamId: process.env.WEATHERKIT_TEAM_ID!,
 *     serviceId: process.env.WEATHERKIT_SERVICE_ID!,
 *   },
 *   units: Units.metric,
 * })
 *
 * // Access weather context in downstream sources
 * const weather = context.get(WeatherKey)
 * if (weather?.condition === "Rain") {
 *   // suggest umbrella
 * }
 * ```
 */
export class WeatherSource implements FeedSource<WeatherFeedItem> {
	readonly id = "aelis.weather"
	readonly dependencies = ["aelis.location"]

	private readonly client: WeatherKitClient
	private readonly hourlyLimit: number
	private readonly dailyLimit: number
	private readonly units: Units

	constructor(options: WeatherSourceOptions) {
		if (!options.client && !options.credentials) {
			throw new Error("Either client or credentials must be provided")
		}
		this.client = options.client ?? new DefaultWeatherKitClient(options.credentials!)
		this.hourlyLimit = options.hourlyLimit ?? DEFAULT_HOURLY_LIMIT
		this.dailyLimit = options.dailyLimit ?? DEFAULT_DAILY_LIMIT
		this.units = options.units ?? Units.metric
	}

	async listActions(): Promise<Record<string, ActionDefinition>> {
		return {}
	}

	async executeAction(actionId: string): Promise<void> {
		throw new UnknownActionError(actionId)
	}

	async fetchContext(context: Context): Promise<readonly ContextEntry[] | null> {
		const location = context.get(LocationKey)
		if (!location) {
			return null
		}

		const response = await this.client.fetch({
			lat: location.lat,
			lng: location.lng,
		})

		if (!response.currentWeather) {
			return null
		}

		const weather: Weather = {
			temperature: convertTemperature(response.currentWeather.temperature, this.units),
			temperatureApparent: convertTemperature(
				response.currentWeather.temperatureApparent,
				this.units,
			),
			condition: response.currentWeather.conditionCode,
			humidity: response.currentWeather.humidity,
			uvIndex: response.currentWeather.uvIndex,
			windSpeed: convertSpeed(response.currentWeather.windSpeed, this.units),
			daylight: response.currentWeather.daylight,
		}

		return [[WeatherKey, weather]]
	}

	async fetchItems(context: Context): Promise<WeatherFeedItem[]> {
		const location = context.get(LocationKey)
		if (!location) {
			return []
		}

		const timestamp = context.time

		const response = await this.client.fetch({
			lat: location.lat,
			lng: location.lng,
		})

		const items: WeatherFeedItem[] = []

		if (response.currentWeather) {
			items.push(
				createCurrentWeatherFeedItem(response.currentWeather, timestamp, this.units, this.id),
			)
		}

		if (response.forecastHourly?.hours) {
			const hours = response.forecastHourly.hours.slice(0, this.hourlyLimit)
			for (let i = 0; i < hours.length; i++) {
				const hour = hours[i]
				if (hour) {
					items.push(createHourlyWeatherFeedItem(hour, i, timestamp, this.units, this.id))
				}
			}
		}

		if (response.forecastDaily?.days) {
			const days = response.forecastDaily.days.slice(0, this.dailyLimit)
			for (let i = 0; i < days.length; i++) {
				const day = days[i]
				if (day) {
					items.push(createDailyWeatherFeedItem(day, i, timestamp, this.units, this.id))
				}
			}
		}

		if (response.weatherAlerts?.alerts) {
			for (const alert of response.weatherAlerts.alerts) {
				items.push(createWeatherAlertFeedItem(alert, timestamp, this.id))
			}
		}

		return items
	}
}

function adjustUrgencyForCondition(baseUrgency: number, conditionCode: ConditionCode): number {
	if (SEVERE_CONDITIONS.has(conditionCode)) {
		return Math.min(1, baseUrgency + 0.3)
	}
	if (MODERATE_CONDITIONS.has(conditionCode)) {
		return Math.min(1, baseUrgency + 0.15)
	}
	return baseUrgency
}

function adjustUrgencyForAlertSeverity(severity: Severity): number {
	switch (severity) {
		case "extreme":
			return 1
		case "severe":
			return 0.9
		case "moderate":
			return 0.75
		case "minor":
			return BASE_URGENCY.alert
	}
}

function timeRelevanceForCondition(conditionCode: ConditionCode): TimeRelevance {
	if (SEVERE_CONDITIONS.has(conditionCode)) {
		return TimeRelevance.Imminent
	}
	if (MODERATE_CONDITIONS.has(conditionCode)) {
		return TimeRelevance.Upcoming
	}
	return TimeRelevance.Ambient
}

function timeRelevanceForAlertSeverity(severity: Severity): TimeRelevance {
	switch (severity) {
		case "extreme":
		case "severe":
			return TimeRelevance.Imminent
		case "moderate":
			return TimeRelevance.Upcoming
		case "minor":
			return TimeRelevance.Ambient
	}
}

function convertTemperature(celsius: number, units: Units): number {
	if (units === Units.imperial) {
		return (celsius * 9) / 5 + 32
	}
	return celsius
}

function convertSpeed(kmh: number, units: Units): number {
	if (units === Units.imperial) {
		return kmh * 0.621371
	}
	return kmh
}

function convertDistance(km: number, units: Units): number {
	if (units === Units.imperial) {
		return km * 0.621371
	}
	return km
}

function convertPrecipitation(mm: number, units: Units): number {
	if (units === Units.imperial) {
		return mm * 0.0393701
	}
	return mm
}

function convertPressure(mb: number, units: Units): number {
	if (units === Units.imperial) {
		return mb * 0.02953
	}
	return mb
}

function createCurrentWeatherFeedItem(
	current: CurrentWeather,
	timestamp: Date,
	units: Units,
	sourceId: string,
): WeatherFeedItem {
	const signals: FeedItemSignals = {
		urgency: adjustUrgencyForCondition(BASE_URGENCY.current, current.conditionCode),
		timeRelevance: timeRelevanceForCondition(current.conditionCode),
	}

	return {
		id: `weather-current-${timestamp.getTime()}`,
		sourceId,
		type: WeatherFeedItemType.Current,
		timestamp,
		data: {
			conditionCode: current.conditionCode,
			daylight: current.daylight,
			humidity: current.humidity,
			precipitationIntensity: convertPrecipitation(current.precipitationIntensity, units),
			pressure: convertPressure(current.pressure, units),
			pressureTrend: current.pressureTrend,
			temperature: convertTemperature(current.temperature, units),
			temperatureApparent: convertTemperature(current.temperatureApparent, units),
			uvIndex: current.uvIndex,
			visibility: convertDistance(current.visibility, units),
			windDirection: current.windDirection,
			windGust: convertSpeed(current.windGust, units),
			windSpeed: convertSpeed(current.windSpeed, units),
		},
		signals,
		slots: {
			insight: {
				description: currentWeatherInsightPrompt,
				content: null,
			},
		},
	}
}

function createHourlyWeatherFeedItem(
	hourly: HourlyForecast,
	index: number,
	timestamp: Date,
	units: Units,
	sourceId: string,
): WeatherFeedItem {
	const signals: FeedItemSignals = {
		urgency: adjustUrgencyForCondition(BASE_URGENCY.hourly, hourly.conditionCode),
		timeRelevance: timeRelevanceForCondition(hourly.conditionCode),
	}

	return {
		id: `weather-hourly-${timestamp.getTime()}-${index}`,
		sourceId,
		type: WeatherFeedItemType.Hourly,
		timestamp,
		data: {
			forecastTime: new Date(hourly.forecastStart),
			conditionCode: hourly.conditionCode,
			daylight: hourly.daylight,
			humidity: hourly.humidity,
			precipitationAmount: convertPrecipitation(hourly.precipitationAmount, units),
			precipitationChance: hourly.precipitationChance,
			precipitationType: hourly.precipitationType,
			temperature: convertTemperature(hourly.temperature, units),
			temperatureApparent: convertTemperature(hourly.temperatureApparent, units),
			uvIndex: hourly.uvIndex,
			windDirection: hourly.windDirection,
			windGust: convertSpeed(hourly.windGust, units),
			windSpeed: convertSpeed(hourly.windSpeed, units),
		},
		signals,
	}
}

function createDailyWeatherFeedItem(
	daily: DailyForecast,
	index: number,
	timestamp: Date,
	units: Units,
	sourceId: string,
): WeatherFeedItem {
	const signals: FeedItemSignals = {
		urgency: adjustUrgencyForCondition(BASE_URGENCY.daily, daily.conditionCode),
		timeRelevance: timeRelevanceForCondition(daily.conditionCode),
	}

	return {
		id: `weather-daily-${timestamp.getTime()}-${index}`,
		sourceId,
		type: WeatherFeedItemType.Daily,
		timestamp,
		data: {
			forecastDate: new Date(daily.forecastStart),
			conditionCode: daily.conditionCode,
			maxUvIndex: daily.maxUvIndex,
			precipitationAmount: convertPrecipitation(daily.precipitationAmount, units),
			precipitationChance: daily.precipitationChance,
			precipitationType: daily.precipitationType,
			snowfallAmount: convertPrecipitation(daily.snowfallAmount, units),
			sunrise: new Date(daily.sunrise),
			sunset: new Date(daily.sunset),
			temperatureMax: convertTemperature(daily.temperatureMax, units),
			temperatureMin: convertTemperature(daily.temperatureMin, units),
		},
		signals,
	}
}

function createWeatherAlertFeedItem(
	alert: WeatherAlert,
	timestamp: Date,
	sourceId: string,
): WeatherFeedItem {
	const signals: FeedItemSignals = {
		urgency: adjustUrgencyForAlertSeverity(alert.severity),
		timeRelevance: timeRelevanceForAlertSeverity(alert.severity),
	}

	return {
		id: `weather-alert-${alert.id}`,
		sourceId,
		type: WeatherFeedItemType.Alert,
		timestamp,
		data: {
			alertId: alert.id,
			areaName: alert.areaName,
			certainty: alert.certainty,
			description: alert.description,
			detailsUrl: alert.detailsUrl,
			effectiveTime: new Date(alert.effectiveTime),
			expireTime: new Date(alert.expireTime),
			severity: alert.severity,
			source: alert.source,
			urgency: alert.urgency,
		},
		signals,
	}
}
