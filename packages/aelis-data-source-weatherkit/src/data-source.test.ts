import type { ContextKey } from "@aelis/core"

import { Context, contextKey } from "@aelis/core"
import { describe, expect, test } from "bun:test"

import type { WeatherKitClient, WeatherKitResponse } from "./weatherkit"

import fixture from "../fixtures/san-francisco.json"
import { WeatherKitDataSource, Units } from "./data-source"
import { WeatherFeedItemType } from "./feed-items"

const mockCredentials = {
	privateKey: "mock",
	keyId: "mock",
	teamId: "mock",
	serviceId: "mock",
}

interface LocationData {
	lat: number
	lng: number
	accuracy: number
}

const LocationKey: ContextKey<LocationData> = contextKey("aelis.location", "location")

const createMockClient = (response: WeatherKitResponse): WeatherKitClient => ({
	fetch: async () => response,
})

function createMockContext(location?: { lat: number; lng: number }): Context {
	const ctx = new Context(new Date("2026-01-17T00:00:00Z"))
	if (location) {
		ctx.set([[LocationKey, { ...location, accuracy: 10 }]])
	}
	return ctx
}

describe("WeatherKitDataSource", () => {
	test("returns empty array when location is missing", async () => {
		const dataSource = new WeatherKitDataSource({
			credentials: mockCredentials,
		})
		const items = await dataSource.query(createMockContext())

		expect(items).toEqual([])
	})

	test("type is weather-current", () => {
		const dataSource = new WeatherKitDataSource({
			credentials: mockCredentials,
		})

		expect(dataSource.type).toBe(WeatherFeedItemType.Current)
	})

	test("throws error if neither client nor credentials provided", () => {
		expect(() => new WeatherKitDataSource({})).toThrow(
			"Either client or credentials must be provided",
		)
	})
})

describe("WeatherKitDataSource with fixture", () => {
	const response = fixture.response

	test("parses current weather from fixture", () => {
		const current = response.currentWeather

		expect(typeof current.conditionCode).toBe("string")
		expect(typeof current.temperature).toBe("number")
		expect(typeof current.humidity).toBe("number")
		expect(current.pressureTrend).toMatch(/^(rising|falling|steady)$/)
	})

	test("parses hourly forecast from fixture", () => {
		const hours = response.forecastHourly.hours

		expect(hours.length).toBeGreaterThan(0)

		const firstHour = hours[0]!
		expect(firstHour.forecastStart).toBeDefined()
		expect(typeof firstHour.temperature).toBe("number")
		expect(typeof firstHour.precipitationChance).toBe("number")
	})

	test("parses daily forecast from fixture", () => {
		const days = response.forecastDaily.days

		expect(days.length).toBeGreaterThan(0)

		const firstDay = days[0]!
		expect(firstDay.forecastStart).toBeDefined()
		expect(typeof firstDay.temperatureMax).toBe("number")
		expect(typeof firstDay.temperatureMin).toBe("number")
		expect(firstDay.sunrise).toBeDefined()
		expect(firstDay.sunset).toBeDefined()
	})

	test("hourly limit is respected", () => {
		const dataSource = new WeatherKitDataSource({
			credentials: mockCredentials,
			hourlyLimit: 6,
		})

		expect(dataSource["hourlyLimit"]).toBe(6)
	})

	test("daily limit is respected", () => {
		const dataSource = new WeatherKitDataSource({
			credentials: mockCredentials,
			dailyLimit: 3,
		})

		expect(dataSource["dailyLimit"]).toBe(3)
	})

	test("default limits are applied", () => {
		const dataSource = new WeatherKitDataSource({
			credentials: mockCredentials,
		})

		expect(dataSource["hourlyLimit"]).toBe(12)
		expect(dataSource["dailyLimit"]).toBe(7)
	})
})

describe("unit conversion", () => {
	test("Units enum has metric and imperial", () => {
		expect(Units.metric).toBe("metric")
		expect(Units.imperial).toBe("imperial")
	})
})

describe("query() with mocked client", () => {
	const mockClient = createMockClient(fixture.response as WeatherKitResponse)

	test("transforms API response into feed items", async () => {
		const dataSource = new WeatherKitDataSource({ client: mockClient })
		const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

		const items = await dataSource.query(context)

		expect(items.length).toBeGreaterThan(0)
		expect(items.some((i) => i.type === WeatherFeedItemType.Current)).toBe(true)
		expect(items.some((i) => i.type === WeatherFeedItemType.Hourly)).toBe(true)
		expect(items.some((i) => i.type === WeatherFeedItemType.Daily)).toBe(true)
	})

	test("applies hourly and daily limits", async () => {
		const dataSource = new WeatherKitDataSource({
			client: mockClient,
			hourlyLimit: 3,
			dailyLimit: 2,
		})
		const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

		const items = await dataSource.query(context)

		const hourlyItems = items.filter((i) => i.type === WeatherFeedItemType.Hourly)
		const dailyItems = items.filter((i) => i.type === WeatherFeedItemType.Daily)

		expect(hourlyItems.length).toBe(3)
		expect(dailyItems.length).toBe(2)
	})

	test("sets timestamp from context.time", async () => {
		const dataSource = new WeatherKitDataSource({ client: mockClient })
		const queryTime = new Date("2026-01-17T12:00:00Z")
		const context = createMockContext({ lat: 37.7749, lng: -122.4194 })
		context.time = queryTime

		const items = await dataSource.query(context)

		for (const item of items) {
			expect(item.timestamp).toEqual(queryTime)
		}
	})

	test("converts temperatures to imperial", async () => {
		const dataSource = new WeatherKitDataSource({ client: mockClient })
		const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

		const metricItems = await dataSource.query(context, {
			units: Units.metric,
		})
		const imperialItems = await dataSource.query(context, {
			units: Units.imperial,
		})

		const metricCurrent = metricItems.find((i) => i.type === WeatherFeedItemType.Current)
		const imperialCurrent = imperialItems.find((i) => i.type === WeatherFeedItemType.Current)

		expect(metricCurrent).toBeDefined()
		expect(imperialCurrent).toBeDefined()

		const metricTemp = (metricCurrent!.data as { temperature: number }).temperature
		const imperialTemp = (imperialCurrent!.data as { temperature: number }).temperature

		// Verify conversion: F = C * 9/5 + 32
		const expectedImperial = (metricTemp * 9) / 5 + 32
		expect(imperialTemp).toBeCloseTo(expectedImperial, 2)
	})

	test("assigns signals based on weather conditions", async () => {
		const dataSource = new WeatherKitDataSource({ client: mockClient })
		const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

		const items = await dataSource.query(context)

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
		const dataSource = new WeatherKitDataSource({ client: mockClient })
		const context = createMockContext({ lat: 37.7749, lng: -122.4194 })

		const items = await dataSource.query(context)
		const ids = items.map((i) => i.id)
		const uniqueIds = new Set(ids)

		expect(uniqueIds.size).toBe(ids.length)
	})
})
