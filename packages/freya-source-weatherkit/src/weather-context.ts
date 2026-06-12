import type { ContextKey } from "@freya/core"

import { contextKey } from "@freya/core"

import type { ConditionCode } from "./weatherkit"

/**
 * Simplified weather context for downstream sources.
 */
export interface Weather {
	/** Current temperature */
	temperature: number
	/** Feels-like temperature */
	temperatureApparent: number
	/** Weather condition */
	condition: ConditionCode
	/** Relative humidity (0-1) */
	humidity: number
	/** UV index */
	uvIndex: number
	/** Wind speed */
	windSpeed: number
	/** Is it currently daytime */
	daylight: boolean
}

export const WeatherKey: ContextKey<Weather> = contextKey("freya.weather", "weather")
