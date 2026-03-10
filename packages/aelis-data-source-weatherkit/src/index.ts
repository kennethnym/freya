export {
	WeatherKitDataSource,
	Units,
	type Units as UnitsType,
	type WeatherKitDataSourceOptions,
	type WeatherKitQueryConfig,
} from "./data-source"

export {
	WeatherFeedItemType,
	type WeatherFeedItemType as WeatherFeedItemTypeType,
	type CurrentWeatherData,
	type CurrentWeatherFeedItem,
	type DailyWeatherData,
	type DailyWeatherFeedItem,
	type HourlyWeatherData,
	type HourlyWeatherFeedItem,
	type WeatherAlertData,
	type WeatherAlertFeedItem,
	type WeatherFeedItem,
} from "./feed-items"

export {
	Severity,
	Urgency,
	Certainty,
	PrecipitationType,
	ConditionCode,
	DefaultWeatherKitClient,
	type Severity as SeverityType,
	type Urgency as UrgencyType,
	type Certainty as CertaintyType,
	type PrecipitationType as PrecipitationTypeType,
	type ConditionCode as ConditionCodeType,
	type WeatherKitCredentials,
	type WeatherKitClient,
	type WeatherKitQueryOptions,
} from "./weatherkit"
