# @aelis/data-source-weatherkit

Weather data source using Apple WeatherKit REST API.

## Usage

```typescript
import { WeatherKitDataSource, Units } from "@aelis/data-source-weatherkit"

const dataSource = new WeatherKitDataSource({
	credentials: {
		privateKey: "-----BEGIN PRIVATE KEY-----\n...",
		keyId: "ABC123",
		teamId: "DEF456",
		serviceId: "com.example.weatherkit",
	},
	hourlyLimit: 12, // optional, default: 12
	dailyLimit: 7, // optional, default: 7
})

const items = await dataSource.query(context, {
	units: Units.metric, // or Units.imperial
})
```

## Feed Items

The data source returns four types of feed items:

| Type              | Description                |
| ----------------- | -------------------------- |
| `weather-current` | Current weather conditions |
| `weather-hourly`  | Hourly forecast            |
| `weather-daily`   | Daily forecast             |
| `weather-alert`   | Weather alerts             |

## Priority

Base priorities are adjusted based on weather conditions:

- Severe conditions (tornado, hurricane, blizzard, etc.): +0.3
- Moderate conditions (thunderstorm, heavy rain, etc.): +0.15
- Alert severity: extreme=1.0, severe=0.9, moderate=0.75, minor=0.7

## Authentication

WeatherKit requires Apple Developer credentials. Generate a private key in the Apple Developer portal under Certificates, Identifiers & Profiles > Keys.

## Validation

API responses are validated using [arktype](https://arktype.io) schemas.

## Generating Test Fixtures

To regenerate fixture data from the real API:

1. Create a `.env` file with your credentials (see `.env.example`)
2. Run `bun run scripts/generate-fixtures.ts`
