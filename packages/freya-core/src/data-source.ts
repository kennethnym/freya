import type { Context } from "./context"
import type { FeedItem } from "./feed"

/**
 * Produces feed items from an external source.
 *
 * @example
 * ```ts
 * type WeatherItem = FeedItem<"weather", { temp: number }>
 *
 * class WeatherDataSource implements DataSource<WeatherItem> {
 *   readonly type = "weather"
 *
 *   async query(context: Context): Promise<WeatherItem[]> {
 *     const location = context.get(LocationKey)
 *     if (!location) return []
 *     const data = await fetchWeather(location)
 *     return [{
 *       id: `weather-${Date.now()}`,
 *       sourceId: "freya.weather",
 *       type: this.type,
 *       timestamp: context.time,
 *       data: { temp: data.temperature },
 *       signals: { urgency: 0.5, timeRelevance: "ambient" },
 *     }]
 *   }
 * }
 * ```
 */
export interface DataSource<TItem extends FeedItem = FeedItem, TConfig = unknown> {
	/** Unique identifier for this source type */
	readonly type: TItem["type"]

	/** Queries the source and returns feed items */
	query(context: Context, config: TConfig): Promise<TItem[]>
}
