# @freya/source-weatherkit

Weather feed source using Apple WeatherKit API.

## Usage

### Basic Setup

```ts
import { WeatherSource, Units } from "@freya/source-weatherkit"

const weatherSource = new WeatherSource({
	credentials: {
		privateKey: process.env.WEATHERKIT_PRIVATE_KEY!,
		keyId: process.env.WEATHERKIT_KEY_ID!,
		teamId: process.env.WEATHERKIT_TEAM_ID!,
		serviceId: process.env.WEATHERKIT_SERVICE_ID!,
	},
	units: Units.metric,
})
```

### With Feed Source Graph

```ts
import { LocationSource } from "@freya/source-location"
import { WeatherSource } from "@freya/source-weatherkit"

const locationSource = new LocationSource()
const weatherSource = new WeatherSource({ credentials })

// Weather depends on location - graph handles ordering
const sources = [locationSource, weatherSource]
```

### Reading Weather Context

Downstream sources can access weather data:

```ts
import { contextValue } from "@freya/core"
import { WeatherKey } from "@freya/source-weatherkit"

async function fetchContext(context: Context) {
	const weather = contextValue(context, WeatherKey)

	if (weather?.condition === "Rain") {
		// Suggest umbrella, indoor activities, etc.
	}

	if (weather && weather.uvIndex > 7) {
		// Suggest sunscreen
	}
}
```

## Exports

| Export          | Description                             |
| --------------- | --------------------------------------- |
| `WeatherSource` | FeedSource implementation               |
| `WeatherKey`    | Context key for simplified weather data |
| `Weather`       | Type for weather context                |
| `Units`         | `metric` or `imperial`                  |

## Options

| Option        | Default  | Description                |
| ------------- | -------- | -------------------------- |
| `credentials` | -        | WeatherKit API credentials |
| `client`      | -        | Custom WeatherKit client   |
| `hourlyLimit` | `12`     | Max hourly forecasts       |
| `dailyLimit`  | `7`      | Max daily forecasts        |
| `units`       | `metric` | Temperature/speed units    |

## Context

Provides simplified weather context for downstream sources:

```ts
interface Weather {
	temperature: number
	temperatureApparent: number
	condition: ConditionCode
	humidity: number
	uvIndex: number
	windSpeed: number
	daylight: boolean
}
```

## Feed Items

Produces feed items:

- `weather-current` - Current conditions
- `weather-hourly` - Hourly forecasts (up to `hourlyLimit`)
- `weather-daily` - Daily forecasts (up to `dailyLimit`)
- `weather-alert` - Weather alerts when present

Priority is adjusted based on weather severity (storms, extreme temperatures).
