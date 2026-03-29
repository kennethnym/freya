export { WeatherKey, type Weather } from "./weather-context"
export { WeatherSource, Units, type WeatherSourceOptions } from "./weather-source"

export {
	WeatherFeedItemType,
	type WeatherFeedItem,
	type CurrentWeatherFeedItem,
	type CurrentWeatherData,
	type HourlyWeatherFeedItem,
	type HourlyWeatherData,
	type HourlyWeatherEntry,
	type DailyWeatherFeedItem,
	type DailyWeatherData,
	type DailyWeatherEntry,
	type WeatherAlertFeedItem,
	type WeatherAlertData,
} from "./feed-items"

export {
	ConditionCode,
	Severity,
	Urgency,
	Certainty,
	PrecipitationType,
	DefaultWeatherKitClient,
	type WeatherKitClient,
	type WeatherKitCredentials,
	type WeatherKitQueryOptions,
	type WeatherKitResponse,
} from "./weatherkit"
