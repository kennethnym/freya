import type { WeatherKitClient, WeatherKitResponse } from "@aris/source-weatherkit"

import { LocationSource } from "@aris/source-location"
import { describe, expect, mock, test } from "bun:test"

import { WeatherSourceProvider } from "../weather/provider.ts"
import { UserSessionManager } from "./user-session-manager.ts"

const mockWeatherClient: WeatherKitClient = {
	fetch: async () => ({}) as WeatherKitResponse,
}

describe("UserSessionManager", () => {
	test("getOrCreate creates session on first call", () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })

		const session = manager.getOrCreate("user-1")

		expect(session).toBeDefined()
		expect(session.engine).toBeDefined()
	})

	test("getOrCreate returns same session for same user", () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })

		const session1 = manager.getOrCreate("user-1")
		const session2 = manager.getOrCreate("user-1")

		expect(session1).toBe(session2)
	})

	test("getOrCreate returns different sessions for different users", () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })

		const session1 = manager.getOrCreate("user-1")
		const session2 = manager.getOrCreate("user-2")

		expect(session1).not.toBe(session2)
	})

	test("each user gets independent source instances", () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })

		const session1 = manager.getOrCreate("user-1")
		const session2 = manager.getOrCreate("user-2")

		const source1 = session1.getSource<LocationSource>("aris.location")
		const source2 = session2.getSource<LocationSource>("aris.location")

		expect(source1).not.toBe(source2)
	})

	test("remove destroys session and allows re-creation", () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })

		const session1 = manager.getOrCreate("user-1")
		manager.remove("user-1")
		const session2 = manager.getOrCreate("user-1")

		expect(session1).not.toBe(session2)
	})

	test("remove is no-op for unknown user", () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })

		expect(() => manager.remove("unknown")).not.toThrow()
	})

	test("accepts function providers", async () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })

		const session = manager.getOrCreate("user-1")
		const result = await session.engine.refresh()

		expect(result.errors).toHaveLength(0)
	})

	test("accepts object providers", () => {
		const provider = new WeatherSourceProvider({ client: mockWeatherClient })
		const manager = new UserSessionManager({
			providers: [() => new LocationSource(), provider],
		})

		const session = manager.getOrCreate("user-1")

		expect(session.getSource("aris.weather")).toBeDefined()
	})

	test("accepts mixed providers", () => {
		const provider = new WeatherSourceProvider({ client: mockWeatherClient })
		const manager = new UserSessionManager({
			providers: [() => new LocationSource(), provider],
		})

		const session = manager.getOrCreate("user-1")

		expect(session.getSource("aris.location")).toBeDefined()
		expect(session.getSource("aris.weather")).toBeDefined()
	})

	test("refresh returns feed result through session", async () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })

		const session = manager.getOrCreate("user-1")
		const result = await session.engine.refresh()

		expect(result).toHaveProperty("context")
		expect(result).toHaveProperty("items")
		expect(result).toHaveProperty("errors")
		expect(result.context.time).toBeInstanceOf(Date)
	})

	test("location update via executeAction works", async () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })

		const session = manager.getOrCreate("user-1")
		await session.engine.executeAction("aris.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		const source = session.getSource<LocationSource>("aris.location")
		expect(source?.lastLocation?.lat).toBe(51.5074)
	})

	test("subscribe receives updates after location push", async () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })
		const callback = mock()

		const session = manager.getOrCreate("user-1")
		session.engine.subscribe(callback)

		await session.engine.executeAction("aris.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		// Wait for async update propagation
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(callback).toHaveBeenCalled()
	})

	test("remove stops reactive updates", async () => {
		const manager = new UserSessionManager({ providers: [() => new LocationSource()] })
		const callback = mock()

		const session = manager.getOrCreate("user-1")
		session.engine.subscribe(callback)

		manager.remove("user-1")

		// Create new session and push location — old callback should not fire
		const session2 = manager.getOrCreate("user-1")
		await session2.engine.executeAction("aris.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(callback).not.toHaveBeenCalled()
	})
})
