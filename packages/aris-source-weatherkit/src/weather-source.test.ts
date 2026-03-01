import { contextValue, type Context } from "@aris/core"
import { LocationKey } from "@aris/source-location"
import { describe, expect, test } from "bun:test"

import type { WeatherKitClient, WeatherKitResponse } from "./weatherkit"

import fixture from "../fixtures/san-francisco.json"
import { WeatherFeedItemType } from "./feed-items"
import { WeatherKey } from "./weather-context"
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
	const ctx: Context = { time: new Date("2026-01-17T00:00:00Z") }
	if (location) {
		ctx[LocationKey] = { ...location, accuracy: 10, timestamp: new Date() }
	}
	return ctx
}

describe("WeatherSource", () => {
	describe("properties", () => {
		test("has correct id", () => {
			const source = new WeatherSource({ credentials: mockCredentials })
			expect(source.id).toBe("aris.weather")
		})

		test("depends on location", () => {
			const source = new WeatherSource({ credentials: mockCredentials })
			expect(source.dependencies).toEqual(["aris.location"])
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

			const result = await source.fetchContext(context)
			expect(result).not.toBeNull()
			const weather = contextValue(result! as Context, WeatherKey)

			expect(weather).toBeDefined()
			expect(typeof weather!.temperature).toBe("number")
			expect(typeof weather!.temperatureApparent).toBe("number")
			expect(typeof weather!.condition).toBe("string")
			expect(typeof weather!.humidity).toBe("number")
			expect(typeof weather!.uvIndex).toBe("number")
			expect(typeof weather!.windSpeed).toBe("number")
			expect(typeof weather!.daylight).toBe("boolean")
		})

		test("converts temperature to imperial", async () => {
			const source = new WeatherSource({
				client: mockClient,
				units: Units.imperial,
			})
			const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

			const result = await source.fetchContext(context)
			expect(result).not.toBeNull()
			const weather = contextValue(result! as Context, WeatherKey)

			// Fixture has temperature around 10°C, imperial should be around 50°F
			expect(weather!.temperature).toBeGreaterThan(40)
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

			expect(hourlyItems.length).toBe(3)
			expect(dailyItems.length).toBe(2)
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
	})

	describe("no reactive methods", () => {
		test("does not implement onContextUpdate", () => {
			const source = new WeatherSource({ credentials: mockCredentials })
			expect(source.onContextUpdate).toBeUndefined()
		})

		test("does not implement onItemsUpdate", () => {
			const source = new WeatherSource({ credentials: mockCredentials })
			expect(source.onItemsUpdate).toBeUndefined()
		})
	})
})
