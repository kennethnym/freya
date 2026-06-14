import { Context, contextKey, type ActionDefinition, type FeedItem } from "@freya/core"
import { describe, expect, test } from "bun:test"

import type { UserSessionManager } from "../session/index.ts"

import { createQueryDebugTools } from "./debug-tools.ts"

const TestTime = new Date("2026-06-14T12:00:00.000Z")

describe("query debug tools", () => {
	test("lists enabled source summaries", async () => {
		const tools = createTestDebugTools()

		const result = await tools.execute("user-1", "freya_list_sources", {})
		const sources = expectArray(expectRecord(result).sources).map(expectRecord)
		const location = sources.find((source) => source.sourceId === "freya.location")
		const reminders = sources.find((source) => source.sourceId === "freya.reminders")
		const weather = sources.find((source) => source.sourceId === "freya.weather")

		expect(location?.hasContext).toBe(true)
		expect(location?.contextEntryCount).toBe(1)
		expect(reminders?.hasFeedItems).toBe(true)
		expect(reminders?.feedItemCount).toBe(1)
		expect(weather?.errors).toEqual([{ sourceId: "freya.weather", message: "weather unavailable" }])
	})

	test("gets context by exact key", async () => {
		const tools = createTestDebugTools()

		const result = await tools.execute("user-1", "freya_get_context", {
			key: ["freya.location", "location"],
			match: "exact",
		})
		const record = expectRecord(result)

		expect(record.found).toBe(true)
		expect(record.value).toEqual({ latitude: 51.5, longitude: -0.1 })
	})

	test("gets one feed item with source details", async () => {
		const tools = createTestDebugTools()

		const result = await tools.execute("user-1", "freya_get_feed_item", {
			feedItemId: "reminder-1",
		})
		const record = expectRecord(result)
		const item = expectRecord(record.item)
		const source = expectRecord(record.source)

		expect(record.found).toBe(true)
		expect(item.id).toBe("reminder-1")
		expect(source.sourceId).toBe("freya.reminders")
		expect(source.actions).toEqual([
			{
				id: "create-reminder",
				description: "Create a reminder",
			},
		])
	})
})

function createTestDebugTools() {
	const context = new Context(TestTime)
	context.set([
		[
			contextKey("freya.location", "location"),
			{
				latitude: 51.5,
				longitude: -0.1,
			},
		],
	])

	const item: FeedItem = {
		id: "reminder-1",
		sourceId: "freya.reminders",
		type: "reminder",
		timestamp: TestTime,
		data: { title: "Buy milk" },
	}

	const actions: Record<string, Record<string, ActionDefinition>> = {
		"freya.location": {
			"update-location": {
				id: "update-location",
				description: "Update location",
			},
		},
		"freya.reminders": {
			"create-reminder": {
				id: "create-reminder",
				description: "Create a reminder",
			},
		},
	}

	const session = {
		async feed() {
			return {
				context,
				items: [item],
				errors: [{ sourceId: "freya.weather", error: new Error("weather unavailable") }],
			}
		},
		engine: {
			currentContext() {
				return context
			},
			async listActions(sourceId: string) {
				return actions[sourceId] ?? {}
			},
		},
		hasSource(sourceId: string) {
			return sourceId in actions
		},
		async listActions() {
			return Object.entries(actions).map(([sourceId, sourceActions]) => ({
				sourceId,
				actions: sourceActions,
			}))
		},
	}

	return createQueryDebugTools({
		async getOrCreate() {
			return session
		},
	} as unknown as UserSessionManager)
}

function expectRecord(value: unknown): Record<string, unknown> {
	expect(typeof value).toBe("object")
	expect(value).not.toBeNull()
	expect(Array.isArray(value)).toBe(false)
	return value as Record<string, unknown>
}

function expectArray(value: unknown): unknown[] {
	expect(Array.isArray(value)).toBe(true)
	return value as unknown[]
}
