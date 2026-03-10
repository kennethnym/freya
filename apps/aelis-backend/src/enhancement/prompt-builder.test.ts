import type { FeedItem } from "@aelis/core"

import { describe, expect, test } from "bun:test"

import { buildPrompt, hasUnfilledSlots } from "./prompt-builder.ts"

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
	return {
		id: "item-1",
		type: "test",
		timestamp: new Date("2025-01-01T00:00:00Z"),
		data: { value: 42 },
		...overrides,
	}
}

function parseUserMessage(userMessage: string): Record<string, unknown> {
	return JSON.parse(userMessage)
}

describe("hasUnfilledSlots", () => {
	test("returns false for items without slots", () => {
		expect(hasUnfilledSlots([makeItem()])).toBe(false)
	})

	test("returns false for items with all slots filled", () => {
		const item = makeItem({
			slots: {
				insight: { description: "test", content: "filled" },
			},
		})
		expect(hasUnfilledSlots([item])).toBe(false)
	})

	test("returns true when at least one slot is unfilled", () => {
		const item = makeItem({
			slots: {
				insight: { description: "test", content: null },
			},
		})
		expect(hasUnfilledSlots([item])).toBe(true)
	})

	test("returns false for empty array", () => {
		expect(hasUnfilledSlots([])).toBe(false)
	})
})

describe("buildPrompt", () => {
	test("puts items with unfilled slots in items", () => {
		const item = makeItem({
			slots: {
				insight: { description: "Weather insight", content: null },
				filled: { description: "Already done", content: "done" },
			},
		})

		const { userMessage } = buildPrompt([item], new Date("2025-06-01T12:00:00Z"))
		const parsed = parseUserMessage(userMessage)

		expect(parsed.items).toHaveLength(1)
		expect((parsed.items as Array<Record<string, unknown>>)[0]!.id).toBe("item-1")
		expect((parsed.items as Array<Record<string, unknown>>)[0]!.slots).toEqual({ insight: "Weather insight" })
		expect((parsed.items as Array<Record<string, unknown>>)[0]!.type).toBeUndefined()
		expect(parsed.context).toHaveLength(0)
	})

	test("puts slotless items in context", () => {
		const withSlots = makeItem({
			id: "with-slots",
			slots: { insight: { description: "test", content: null } },
		})
		const withoutSlots = makeItem({ id: "no-slots" })

		const { userMessage } = buildPrompt([withSlots, withoutSlots], new Date("2025-06-01T12:00:00Z"))
		const parsed = parseUserMessage(userMessage)

		expect(parsed.items).toHaveLength(1)
		expect((parsed.items as Array<Record<string, unknown>>)[0]!.id).toBe("with-slots")
		expect(parsed.context).toHaveLength(1)
		expect((parsed.context as Array<Record<string, unknown>>)[0]!.id).toBe("no-slots")
	})

	test("includes time in ISO format", () => {
		const { userMessage } = buildPrompt([], new Date("2025-06-01T12:00:00Z"))
		const parsed = parseUserMessage(userMessage)

		expect(parsed.time).toBe("2025-06-01T12:00:00.000Z")
	})

	test("system prompt is non-empty", () => {
		const { systemPrompt } = buildPrompt([], new Date())
		expect(systemPrompt.length).toBeGreaterThan(0)
	})

	test("includes schedule in system prompt", () => {
		const calEvent = makeItem({
			id: "cal-1",
			type: "caldav-event",
			data: {
				title: "Team standup",
				startDate: "2025-06-01T10:00:00Z",
				endDate: "2025-06-01T10:30:00Z",
				isAllDay: false,
				location: null,
			},
			slots: {
				insight: { description: "test", content: null },
			},
		})

		const { systemPrompt } = buildPrompt([calEvent], new Date("2025-06-01T12:00:00Z"))

		expect(systemPrompt).toContain("Schedule:\n")
		expect(systemPrompt).toContain("Team standup")
		expect(systemPrompt).toContain("10:00")
	})

	test("includes location in schedule", () => {
		const calEvent = makeItem({
			id: "cal-1",
			type: "caldav-event",
			data: {
				title: "Therapy",
				startDate: "2025-06-02T18:00:00Z",
				endDate: "2025-06-02T19:00:00Z",
				isAllDay: false,
				location: "92 Tooley Street, London",
			},
		})

		const { systemPrompt } = buildPrompt([calEvent], new Date("2025-06-01T12:00:00Z"))

		expect(systemPrompt).toContain("Therapy @ 92 Tooley Street, London")
	})

	test("includes week calendar but omits schedule when no calendar items", () => {
		const weatherItem = makeItem({
			type: "weather-current",
			data: { temperature: 14 },
		})

		const { systemPrompt } = buildPrompt([weatherItem], new Date("2025-06-01T12:00:00Z"))

		expect(systemPrompt).toContain("Week:")
		expect(systemPrompt).not.toContain("Schedule:")
	})

	test("user message is pure JSON", () => {
		const calEvent = makeItem({
			id: "cal-1",
			type: "caldav-event",
			data: {
				title: "Budget Review",
				startTime: "2025-06-01T14:00:00Z",
				endTime: "2025-06-01T15:00:00Z",
				isAllDay: false,
				location: "https://meet.google.com/abc",
			},
		})

		const { userMessage } = buildPrompt([calEvent], new Date("2025-06-01T12:00:00Z"))

		expect(userMessage.startsWith("{")).toBe(true)
		expect(() => JSON.parse(userMessage)).not.toThrow()
	})
})
