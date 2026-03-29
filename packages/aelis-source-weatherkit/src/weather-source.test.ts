import type { FeedSource } from "@aelis/core"

import { Context } from "@aelis/core"
import { LocationKey } from "@aelis/source-location"
import { describe, expect, test } from "bun:test"

import type { WeatherKitClient, WeatherKitResponse, HourlyForecast, DailyForecast } from "./weatherkit"

import fixture from "../fixtures/san-francisco.json"
import { WeatherFeedItemType, type DailyWeatherData, type HourlyWeatherData } from "./feed-items"
import { WeatherKey, type Weather } from "./weather-context"
import { WeatherSource, Units } from "./weather-source"

const mockCredentials = {
	privateKey: "mock",
	keyId: "mock",
	teamId: "mock",
	serviceId: "mock",
}

function createMockClient(response: WeatherKitResponse): WeatherKitClient {
	return {
		fetch: async () => response,
	}
}

function createMockContext(location?: { lat: number; lng: number }): Context {
	const ctx = new Context(new Date("2026-01-17T00:00:00Z"))
	if (location) {
		ctx.set([[LocationKey, { ...location, accuracy: 10, timestamp: new Date() }]])
	}
	return ctx
}

describe("WeatherSource", () => {
	describe("properties", () => {
		test("has correct id", () => {
			const source = new WeatherSource({ credentials: mockCredentials })
			expect(source.id).toBe("aelis.weather")
		})

		test("depends on location", () => {
			const source = new WeatherSource({ credentials: mockCredentials })
			expect(source.dependencies).toEqual(["aelis.location"])
		})

		test("throws error if neither client nor credentials provided", () => {
			expect(() => new WeatherSource({} as never)).toThrow(
				"Either client or credentials must be provided",
			)
		})
	})

	describe("fetchContext", () => {
		const mockClient = createMockClient(fixture.response as WeatherKitResponse)

		test("returns null when no location", async () => {
			const source = new WeatherSource({ client: mockClient })
			const result = await source.fetchContext(createMockContext())

			expect(result).toBeNull()
		})

		test("returns simplified weather context", async () => {
			const source = new WeatherSource({ client: mockClient })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const entries = await source.fetchContext(context)
			expect(entries).not.toBeNull()
			expect(entries).toHaveLength(1)

			const [key, weather] = entries![0]! as [typeof WeatherKey, Weather]
			expect(key).toEqual(WeatherKey)
			expect(typeof weather.temperature).toBe("number")
			expect(typeof weather.temperatureApparent).toBe("number")
			expect(typeof weather.condition).toBe("string")
			expect(typeof weather.humidity).toBe("number")
			expect(typeof weather.uvIndex).toBe("number")
			expect(typeof weather.windSpeed).toBe("number")
			expect(typeof weather.daylight).toBe("boolean")
		})

		test("converts temperature to imperial", async () => {
			const source = new WeatherSource({
				client: mockClient,
				units: Units.imperial,
			})
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const entries = await source.fetchContext(context)
			expect(entries).not.toBeNull()

			const [, weather] = entries![0]! as [typeof WeatherKey, Weather]
			// Fixture has temperature around 10°C, imperial should be around 50°F
			expect(weather.temperature).toBeGreaterThan(40)
		})
	})

	describe("fetchItems", () => {
		const mockClient = createMockClient(fixture.response as WeatherKitResponse)

		test("returns empty array when no location", async () => {
			const source = new WeatherSource({ client: mockClient })
			const items = await source.fetchItems(createMockContext())

			expect(items).toEqual([])
		})

		test("returns feed items with all types", async () => {
			const source = new WeatherSource({ client: mockClient })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)

			expect(items.length).toBeGreaterThan(0)
			expect(items.some((i) => i.type === WeatherFeedItemType.Current)).toBe(true)
			expect(items.some((i) => i.type === WeatherFeedItemType.Hourly)).toBe(true)
			expect(items.some((i) => i.type === WeatherFeedItemType.Daily)).toBe(true)
		})

		test("applies hourly and daily limits", async () => {
			const source = new WeatherSource({
				client: mockClient,
				hourlyLimit: 3,
				dailyLimit: 2,
			})
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)

			const hourlyItems = items.filter((i) => i.type === WeatherFeedItemType.Hourly)
			const dailyItems = items.filter((i) => i.type === WeatherFeedItemType.Daily)

			expect(hourlyItems.length).toBe(1)
			expect((hourlyItems[0]!.data as HourlyWeatherData).hours.length).toBe(3)
			expect(dailyItems.length).toBe(1)
			expect((dailyItems[0]!.data as DailyWeatherData).days.length).toBe(2)
		})

		test("produces a single hourly item with hours array", async () => {
			const source = new WeatherSource({ client: mockClient })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)

			const hourlyItems = items.filter((i) => i.type === WeatherFeedItemType.Hourly)
			expect(hourlyItems.length).toBe(1)

			const hourlyData = hourlyItems[0]!.data as HourlyWeatherData
			expect(Array.isArray(hourlyData.hours)).toBe(true)
			expect(hourlyData.hours.length).toBeGreaterThan(0)
			expect(hourlyData.hours.length).toBeLessThanOrEqual(12)
		})

		test("averages urgency across hours with mixed conditions", async () => {
			const mildHour: HourlyForecast = {
				forecastStart: "2026-01-17T01:00:00Z",
				conditionCode: "Clear",
				daylight: true,
				humidity: 0.5,
				precipitationAmount: 0,
				precipitationChance: 0,
				precipitationType: "clear",
				pressure: 1013,
				snowfallIntensity: 0,
				temperature: 20,
				temperatureApparent: 20,
				temperatureDewPoint: 10,
				uvIndex: 3,
				visibility: 20000,
				windDirection: 180,
				windGust: 10,
				windSpeed: 5,
			}
			const severeHour: HourlyForecast = {
				...mildHour,
				forecastStart: "2026-01-17T02:00:00Z",
				conditionCode: "SevereThunderstorm",
			}
			const mixedResponse: WeatherKitResponse = {
				forecastHourly: { hours: [mildHour, severeHour] },
			}
			const source = new WeatherSource({ client: createMockClient(mixedResponse) })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)
			const hourlyItem = items.find((i) => i.type === WeatherFeedItemType.Hourly)

			expect(hourlyItem).toBeDefined()
			// Mild urgency = 0.3, severe urgency = 0.6, average = 0.45
			expect(hourlyItem!.signals!.urgency).toBeCloseTo(0.45, 5)
			// Worst-case: SevereThunderstorm → Imminent
			expect(hourlyItem!.signals!.timeRelevance).toBe("imminent")
		})

		test("produces a single daily item with days array", async () => {
			const source = new WeatherSource({ client: mockClient })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)

			const dailyItems = items.filter((i) => i.type === WeatherFeedItemType.Daily)
			expect(dailyItems.length).toBe(1)

			const dailyData = dailyItems[0]!.data as DailyWeatherData
			expect(Array.isArray(dailyData.days)).toBe(true)
			expect(dailyData.days.length).toBeGreaterThan(0)
			expect(dailyData.days.length).toBeLessThanOrEqual(7)
		})

		test("averages urgency across days with mixed conditions", async () => {
			const mildDay: DailyForecast = {
				forecastStart: "2026-01-17T00:00:00Z",
				forecastEnd: "2026-01-18T00:00:00Z",
				conditionCode: "Clear",
				maxUvIndex: 3,
				moonPhase: "firstQuarter",
				precipitationAmount: 0,
				precipitationChance: 0,
				precipitationType: "clear",
				snowfallAmount: 0,
				sunrise: "2026-01-17T07:00:00Z",
				sunriseCivil: "2026-01-17T06:30:00Z",
				sunriseNautical: "2026-01-17T06:00:00Z",
				sunriseAstronomical: "2026-01-17T05:30:00Z",
				sunset: "2026-01-17T17:00:00Z",
				sunsetCivil: "2026-01-17T17:30:00Z",
				sunsetNautical: "2026-01-17T18:00:00Z",
				sunsetAstronomical: "2026-01-17T18:30:00Z",
				temperatureMax: 15,
				temperatureMin: 5,
			}
			const severeDay: DailyForecast = {
				...mildDay,
				forecastStart: "2026-01-18T00:00:00Z",
				forecastEnd: "2026-01-19T00:00:00Z",
				conditionCode: "SevereThunderstorm",
			}
			const mixedResponse: WeatherKitResponse = {
				forecastDaily: { days: [mildDay, severeDay] },
			}
			const source = new WeatherSource({ client: createMockClient(mixedResponse) })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)
			const dailyItem = items.find((i) => i.type === WeatherFeedItemType.Daily)

			expect(dailyItem).toBeDefined()
			// Mild urgency = 0.2, severe urgency = 0.5, average = 0.35
			expect(dailyItem!.signals!.urgency).toBeCloseTo(0.35, 5)
			// Worst-case: SevereThunderstorm → Imminent
			expect(dailyItem!.signals!.timeRelevance).toBe("imminent")
		})

		test("sets timestamp from context.time", async () => {
			const source = new WeatherSource({ client: mockClient })
			const queryTime = new Date("2026-01-17T12:00:00Z")
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })
			context.time = queryTime

			const items = await source.fetchItems(context)

			for (const item of items) {
				expect(item.timestamp).toEqual(queryTime)
			}
		})

		test("assigns signals based on weather conditions", async () => {
			const source = new WeatherSource({ client: mockClient })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)

			for (const item of items) {
				expect(item.signals).toBeDefined()
				expect(item.signals!.urgency).toBeGreaterThanOrEqual(0)
				expect(item.signals!.urgency).toBeLessThanOrEqual(1)
				expect(item.signals!.timeRelevance).toBeDefined()
			}

			const currentItem = items.find((i) => i.type === WeatherFeedItemType.Current)
			expect(currentItem).toBeDefined()
			expect(currentItem!.signals!.urgency).toBeGreaterThanOrEqual(0.5)
		})

		test("generates unique IDs for each item", async () => {
			const source = new WeatherSource({ client: mockClient })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)
			const ids = items.map((i) => i.id)
			const uniqueIds = new Set(ids)

			expect(uniqueIds.size).toBe(ids.length)
		})

		test("current weather item has insight slot", async () => {
			const source = new WeatherSource({ client: mockClient })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)
			const currentItem = items.find((i) => i.type === WeatherFeedItemType.Current)

			expect(currentItem).toBeDefined()
			expect(currentItem!.slots).toBeDefined()
			expect(currentItem!.slots!.insight).toBeDefined()
			expect(currentItem!.slots!.insight!.description).toBeString()
			expect(currentItem!.slots!.insight!.description.length).toBeGreaterThan(0)
			expect(currentItem!.slots!.insight!.content).toBeNull()
		})

		test("non-current items do not have slots", async () => {
			const source = new WeatherSource({ client: mockClient })
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const items = await source.fetchItems(context)
			const nonCurrentItems = items.filter((i) => i.type !== WeatherFeedItemType.Current)

			expect(nonCurrentItems.length).toBeGreaterThan(0)
			for (const item of nonCurrentItems) {
				expect(item.slots).toBeUndefined()
			}
		})
	})

	describe("no reactive methods", () => {
		test("does not implement onContextUpdate", () => {
			const source: FeedSource = new WeatherSource({ credentials: mockCredentials })
			expect(source.onContextUpdate).toBeUndefined()
		})

		test("does not implement onItemsUpdate", () => {
			const source: FeedSource = new WeatherSource({ credentials: mockCredentials })
			expect(source.onItemsUpdate).toBeUndefined()
		})
	})
})
