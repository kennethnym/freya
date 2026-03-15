import type { WeatherKitClient, WeatherKitResponse } from "@aelis/source-weatherkit"

import { LocationSource } from "@aelis/source-location"
import { describe, expect, mock, spyOn, test } from "bun:test"

import { WeatherSourceProvider } from "../weather/provider.ts"
import { UserSessionManager } from "./user-session-manager.ts"

const mockWeatherClient: WeatherKitClient = {
	fetch: async () => ({}) as WeatherKitResponse,
}

describe("UserSessionManager", () => {
	test("getOrCreate creates session on first call", async () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })

		const session = await manager.getOrCreate("user-1")

		expect(session).toBeDefined()
		expect(session.engine).toBeDefined()
	})

	test("getOrCreate returns same session for same user", async () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-1")

		expect(session1).toBe(session2)
	})

	test("getOrCreate returns different sessions for different users", async () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-2")

		expect(session1).not.toBe(session2)
	})

	test("each user gets independent source instances", async () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-2")

		const source1 = session1.getSource<LocationSource>("aelis.location")
		const source2 = session2.getSource<LocationSource>("aelis.location")

		expect(source1).not.toBe(source2)
	})

	test("remove destroys session and allows re-creation", async () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })

		const session1 = await manager.getOrCreate("user-1")
		manager.remove("user-1")
		const session2 = await manager.getOrCreate("user-1")

		expect(session1).not.toBe(session2)
	})

	test("remove is no-op for unknown user", () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })

		expect(() => manager.remove("unknown")).not.toThrow()
	})

	test("accepts function providers", async () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })

		const session = await manager.getOrCreate("user-1")
		const result = await session.engine.refresh()

		expect(result.errors).toHaveLength(0)
	})

	test("accepts object providers", async () => {
		const provider = new WeatherSourceProvider({ client: mockWeatherClient })
		const manager = new UserSessionManager({
			providers: [async () => new LocationSource(), provider],
		})

		const session = await manager.getOrCreate("user-1")

		expect(session.getSource("aelis.weather")).toBeDefined()
	})

	test("accepts mixed providers", async () => {
		const provider = new WeatherSourceProvider({ client: mockWeatherClient })
		const manager = new UserSessionManager({
			providers: [async () => new LocationSource(), provider],
		})

		const session = await manager.getOrCreate("user-1")

		expect(session.getSource("aelis.location")).toBeDefined()
		expect(session.getSource("aelis.weather")).toBeDefined()
	})

	test("refresh returns feed result through session", async () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })

		const session = await manager.getOrCreate("user-1")
		const result = await session.engine.refresh()

		expect(result).toHaveProperty("context")
		expect(result).toHaveProperty("items")
		expect(result).toHaveProperty("errors")
		expect(result.context.time).toBeInstanceOf(Date)
	})

	test("location update via executeAction works", async () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })

		const session = await manager.getOrCreate("user-1")
		await session.engine.executeAction("aelis.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		const source = session.getSource<LocationSource>("aelis.location")
		expect(source?.lastLocation?.lat).toBe(51.5074)
	})

	test("subscribe receives updates after location push", async () => {
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })
		const callback = mock()

		const session = await manager.getOrCreate("user-1")
		session.engine.subscribe(callback)

		await session.engine.executeAction("aelis.location", "update-location", {
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
		const manager = new UserSessionManager({ providers: [async () => new LocationSource()] })
		const callback = mock()

		const session = await manager.getOrCreate("user-1")
		session.engine.subscribe(callback)

		manager.remove("user-1")

		// Create new session and push location — old callback should not fire
		const session2 = await manager.getOrCreate("user-1")
		await session2.engine.executeAction("aelis.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(callback).not.toHaveBeenCalled()
	})

	test("creates session with successful providers when some fail", async () => {
		const manager = new UserSessionManager({
			providers: [
				async () => new LocationSource(),
				async () => {
					throw new Error("provider failed")
				},
			],
		})

		const spy = spyOn(console, "error").mockImplementation(() => {})

		const session = await manager.getOrCreate("user-1")

		expect(session).toBeDefined()
		expect(session.getSource("aelis.location")).toBeDefined()
		expect(spy).toHaveBeenCalled()

		spy.mockRestore()
	})

	test("throws AggregateError when all providers fail", async () => {
		const manager = new UserSessionManager({
			providers: [
				async () => {
					throw new Error("first failed")
				},
				async () => {
					throw new Error("second failed")
				},
			],
		})

		await expect(manager.getOrCreate("user-1")).rejects.toBeInstanceOf(AggregateError)
	})

	test("concurrent getOrCreate for same user returns same session", async () => {
		let callCount = 0
		const manager = new UserSessionManager({
			providers: [
				async () => {
					callCount++
					// Simulate async work to widen the race window
					await new Promise((resolve) => setTimeout(resolve, 10))
					return new LocationSource()
				},
			],
		})

		const [session1, session2] = await Promise.all([
			manager.getOrCreate("user-1"),
			manager.getOrCreate("user-1"),
		])

		expect(session1).toBe(session2)
		expect(callCount).toBe(1)
	})
})
