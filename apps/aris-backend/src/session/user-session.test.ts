import type { ActionDefinition, ContextEntry, FeedSource } from "@aris/core"

import { LocationSource } from "@aris/source-location"
import { describe, expect, test } from "bun:test"

import { UserSession } from "./user-session.ts"

function createStubSource(id: string): FeedSource {
	return {
		id,
		async listActions(): Promise<Record<string, ActionDefinition>> {
			return {}
		},
		async executeAction(): Promise<unknown> {
			return undefined
		},
		async fetchContext(): Promise<readonly ContextEntry[] | null> {
			return null
		},
		async fetchItems() {
			return []
		},
	}
}

describe("UserSession", () => {
	test("registers sources and starts engine", async () => {
		const session = new UserSession([createStubSource("test-a"), createStubSource("test-b")])

		const result = await session.engine.refresh()

		expect(result.errors).toHaveLength(0)
	})

	test("getSource returns registered source", () => {
		const location = new LocationSource()
		const session = new UserSession([location])

		const result = session.getSource<LocationSource>("aris.location")

		expect(result).toBe(location)
	})

	test("getSource returns undefined for unknown source", () => {
		const session = new UserSession([createStubSource("test")])

		expect(session.getSource("unknown")).toBeUndefined()
	})

	test("destroy stops engine and clears sources", () => {
		const session = new UserSession([createStubSource("test")])

		session.destroy()

		expect(session.getSource("test")).toBeUndefined()
	})

	test("engine.executeAction routes to correct source", async () => {
		const location = new LocationSource()
		const session = new UserSession([location])

		await session.engine.executeAction("aris.location", "update-location", {
			lat: 51.5,
			lng: -0.1,
			accuracy: 10,
			timestamp: new Date(),
		})

		expect(location.lastLocation).toBeDefined()
		expect(location.lastLocation!.lat).toBe(51.5)
	})
})
