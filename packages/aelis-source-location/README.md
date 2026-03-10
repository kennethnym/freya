# @aelis/source-location

A FeedSource that provides location context to the AELIS feed graph.

## Overview

This source accepts external location pushes and does not query location itself. It provides location context to downstream sources (e.g., weather, transit) but does not produce feed items.

## Installation

```bash
bun add @aelis/source-location
```

## Usage

```ts
import { LocationSource, LocationKey, type Location } from "@aelis/source-location"
import { contextValue } from "@aelis/core"

// Create source with default history size (1)
const locationSource = new LocationSource()

// Or keep last 10 locations
const locationSource = new LocationSource({ historySize: 10 })

// Push location from external provider (GPS, network, etc.)
locationSource.pushLocation({
	lat: 37.7749,
	lng: -122.4194,
	accuracy: 10,
	timestamp: new Date(),
})

// Access current location
locationSource.lastLocation // { lat, lng, accuracy, timestamp } | null

// Access location history (oldest first)
locationSource.locationHistory // readonly Location[]
```

### With FeedController

```ts
import { FeedController } from "@aelis/core"
import { LocationSource } from "@aelis/source-location"

const locationSource = new LocationSource()

const controller = new FeedController({
	sources: [locationSource, weatherSource, transitSource],
})

// Push location updates - downstream sources will re-fetch
locationSource.pushLocation({
	lat: 37.7749,
	lng: -122.4194,
	accuracy: 10,
	timestamp: new Date(),
})
```

### Reading Location in Downstream Sources

```ts
import { contextValue, type FeedSource } from "@aelis/core"
import { LocationKey } from "@aelis/source-location"

const weatherSource: FeedSource = {
	id: "weather",
	dependencies: ["location"],

	async fetchContext(context) {
		const location = contextValue(context, LocationKey)
		if (!location) return {}

		const weather = await fetchWeather(location.lat, location.lng)
		return { [WeatherKey]: weather }
	},
}
```

## API

### `LocationSource`

| Member                   | Type                  | Description                           |
| ------------------------ | --------------------- | ------------------------------------- |
| `id`                     | `"location"`          | Source identifier                     |
| `constructor(options?)`  |                       | Create with optional `historySize`    |
| `pushLocation(location)` | `void`                | Push new location, notifies listeners |
| `lastLocation`           | `Location \| null`    | Most recent location                  |
| `locationHistory`        | `readonly Location[]` | All retained locations, oldest first  |

### `Location`

```ts
interface Location {
	lat: number
	lng: number
	accuracy: number // meters
	timestamp: Date
}
```

### `LocationKey`

Typed context key for accessing location in downstream sources:

```ts
const location = contextValue(context, LocationKey)
```
