import type { Context, ContextKey, DataSource, FeedItemSignals } from "@aelis/core"

import { TimeRelevance, contextKey } from "@aelis/core"

import {
	WeatherFeedItemType,
	type CurrentWeatherFeedItem,
	type DailyWeatherFeedItem,
	type HourlyWeatherFeedItem,
	type WeatherAlertFeedItem,
	type WeatherFeedItem,
} from "./feed-items"
import {
	ConditionCode,
	DefaultWeatherKitClient,
	Severity,
	type CurrentWeather,
	type DailyForecast,
	type HourlyForecast,
	type WeatherAlert,
	type WeatherKitClient,
	type WeatherKitCredentials,
} from "./weatherkit"

export const Units = {
	metric: "metric",
	imperial: "imperial",
} as const

export type Units = (typeof Units)[keyof typeof Units]

export interface WeatherKitDataSourceOptions {
	credentials?: WeatherKitCredentials
	client?: WeatherKitClient
	hourlyLimit?: number
	dailyLimit?: number
}

export interface WeatherKitQueryConfig {
	units?: Units
}

interface LocationData {
	lat: number
	lng: number
}

const LocationKey: ContextKey<LocationData> = contextKey("aelis.location", "location")

const SOURCE_ID = "aelis.weather"

export class WeatherKitDataSource implements DataSource<WeatherFeedItem, WeatherKitQueryConfig> {
	private readonly DEFAULT_HOURLY_LIMIT = 12
	private readonly DEFAULT_DAILY_LIMIT = 7

	readonly type = WeatherFeedItemType.Current
	private readonly client: WeatherKitClient
	private readonly hourlyLimit: number
	private readonly dailyLimit: number

	constructor(options: WeatherKitDataSourceOptions) {
		if (!options.client && !options.credentials) {
			throw new Error("Either client or credentials must be provided")
		}
		this.client = options.client ?? new DefaultWeatherKitClient(options.credentials!)
		this.hourlyLimit = options.hourlyLimit ?? this.DEFAULT_HOURLY_LIMIT
		this.dailyLimit = options.dailyLimit ?? this.DEFAULT_DAILY_LIMIT
	}

	async query(context: Context, config: WeatherKitQueryConfig = {}): Promise<WeatherFeedItem[]> {
		const location = context.get(LocationKey)
		if (!location) {
			return []
		}

		const units = config.units ?? Units.metric
		const timestamp = context.time

		const response = await this.client.fetch({
			lat: location.lat,
			lng: location.lng,
		})

		const items: WeatherFeedItem[] = []

		if (response.currentWeather) {
			items.push(createCurrentWeatherFeedItem(response.currentWeather, timestamp, units))
		}

		if (response.forecastHourly?.hours) {
			const hours = response.forecastHourly.hours.slice(0, this.hourlyLimit)
			for (let i = 0; i < hours.length; i++) {
				const hour = hours[i]
				if (hour) {
					items.push(createHourlyWeatherFeedItem(hour, i, timestamp, units))
				}
			}
		}

		if (response.forecastDaily?.days) {
			const days = response.forecastDaily.days.slice(0, this.dailyLimit)
			for (let i = 0; i < days.length; i++) {
				const day = days[i]
				if (day) {
					items.push(createDailyWeatherFeedItem(day, i, timestamp, units))
				}
			}
		}

		if (response.weatherAlerts?.alerts) {
			for (const alert of response.weatherAlerts.alerts) {
				items.push(createWeatherAlertFeedItem(alert, timestamp))
			}
		}

		return items
	}
}

const BASE_URGENCY = {
	current: 0.5,
	hourly: 0.3,
	daily: 0.2,
	alert: 0.7,
} as const

const SEVERE_CONDITIONS = new Set<ConditionCode>([
	ConditionCode.SevereThunderstorm,
	ConditionCode.Hurricane,
	ConditionCode.Tornado,
	ConditionCode.TropicalStorm,
	ConditionCode.Blizzard,
	ConditionCode.FreezingRain,
	ConditionCode.Hail,
	ConditionCode.Frigid,
	ConditionCode.Hot,
])

const MODERATE_CONDITIONS = new Set<ConditionCode>([
	ConditionCode.Thunderstorm,
	ConditionCode.IsolatedThunderstorms,
	ConditionCode.ScatteredThunderstorms,
	ConditionCode.HeavyRain,
	ConditionCode.HeavySnow,
	ConditionCode.FreezingDrizzle,
	ConditionCode.BlowingSnow,
])

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
		case Severity.Extreme:
			return 1
		case Severity.Severe:
			return 0.9
		case Severity.Moderate:
			return 0.75
		case Severity.Minor:
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
		case Severity.Extreme:
		case Severity.Severe:
			return TimeRelevance.Imminent
		case Severity.Moderate:
			return TimeRelevance.Upcoming
		case Severity.Minor:
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
): CurrentWeatherFeedItem {
	const signals: FeedItemSignals = {
		urgency: adjustUrgencyForCondition(BASE_URGENCY.current, current.conditionCode),
		timeRelevance: timeRelevanceForCondition(current.conditionCode),
	}

	return {
		id: `weather-current-${timestamp.getTime()}`,
		sourceId: SOURCE_ID,
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
	}
}

function createHourlyWeatherFeedItem(
	hourly: HourlyForecast,
	index: number,
	timestamp: Date,
	units: Units,
): HourlyWeatherFeedItem {
	const signals: FeedItemSignals = {
		urgency: adjustUrgencyForCondition(BASE_URGENCY.hourly, hourly.conditionCode),
		timeRelevance: timeRelevanceForCondition(hourly.conditionCode),
	}

	return {
		id: `weather-hourly-${timestamp.getTime()}-${index}`,
		sourceId: SOURCE_ID,
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
): DailyWeatherFeedItem {
	const signals: FeedItemSignals = {
		urgency: adjustUrgencyForCondition(BASE_URGENCY.daily, daily.conditionCode),
		timeRelevance: timeRelevanceForCondition(daily.conditionCode),
	}

	return {
		id: `weather-daily-${timestamp.getTime()}-${index}`,
		sourceId: SOURCE_ID,
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

function createWeatherAlertFeedItem(alert: WeatherAlert, timestamp: Date): WeatherAlertFeedItem {
	const signals: FeedItemSignals = {
		urgency: adjustUrgencyForAlertSeverity(alert.severity),
		timeRelevance: timeRelevanceForAlertSeverity(alert.severity),
	}

	return {
		id: `weather-alert-${alert.id}`,
		sourceId: SOURCE_ID,
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
