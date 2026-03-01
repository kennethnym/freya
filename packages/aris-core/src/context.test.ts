import { describe, expect, test } from "bun:test"

import type { ContextKey } from "./context"

import { Context, contextKey } from "./context"

interface Weather {
	temperature: number
}

interface NextEvent {
	title: string
}

const WeatherKey: ContextKey<Weather> = contextKey("aris.weather", "current")
const NextEventKey: ContextKey<NextEvent> = contextKey("aris.google-calendar", "nextEvent")

describe("Context", () => {
	describe("get", () => {
		test("returns undefined for missing key", () => {
			const ctx = new Context()
			expect(ctx.get(WeatherKey)).toBeUndefined()
		})

		test("returns value for exact key match", () => {
			const ctx = new Context()
			const weather: Weather = { temperature: 20 }
			ctx.set([[WeatherKey, weather]])

			expect(ctx.get(WeatherKey)).toEqual(weather)
		})

		test("distinguishes keys with different parts", () => {
			const ctx = new Context()
			ctx.set([
				[WeatherKey, { temperature: 20 }],
				[NextEventKey, { title: "Standup" }],
			])

			expect(ctx.get(WeatherKey)).toEqual({ temperature: 20 })
			expect(ctx.get(NextEventKey)).toEqual({ title: "Standup" })
		})

		test("last write wins for same key", () => {
			const ctx = new Context()
			ctx.set([[WeatherKey, { temperature: 20 }]])
			ctx.set([[WeatherKey, { temperature: 25 }]])

			expect(ctx.get(WeatherKey)).toEqual({ temperature: 25 })
		})
	})

	describe("find", () => {
		test("returns empty array when no keys match", () => {
			const ctx = new Context()
			expect(ctx.find(WeatherKey)).toEqual([])
		})

		test("returns exact match as single result", () => {
			const ctx = new Context()
			ctx.set([[NextEventKey, { title: "Standup" }]])

			const results = ctx.find(NextEventKey)
			expect(results).toHaveLength(1)
			expect(results[0]!.value).toEqual({ title: "Standup" })
		})

		test("prefix match returns multiple instances", () => {
			const workKey = contextKey<NextEvent>("aris.google-calendar", "nextEvent", {
				account: "work",
			})
			const personalKey = contextKey<NextEvent>("aris.google-calendar", "nextEvent", {
				account: "personal",
			})

			const ctx = new Context()
			ctx.set([
				[workKey, { title: "Sprint Planning" }],
				[personalKey, { title: "Dentist" }],
			])

			const prefix = contextKey<NextEvent>("aris.google-calendar", "nextEvent")
			const results = ctx.find(prefix)

			expect(results).toHaveLength(2)
			const titles = results.map((r) => r.value.title).sort()
			expect(titles).toEqual(["Dentist", "Sprint Planning"])
		})

		test("prefix match includes exact match and longer keys", () => {
			const baseKey = contextKey<NextEvent>("aris.google-calendar", "nextEvent")
			const instanceKey = contextKey<NextEvent>("aris.google-calendar", "nextEvent", {
				account: "work",
			})

			const ctx = new Context()
			ctx.set([
				[baseKey, { title: "Base" }],
				[instanceKey, { title: "Instance" }],
			])

			const results = ctx.find(baseKey)
			expect(results).toHaveLength(2)
		})

		test("does not match keys that share a string prefix but differ at segment boundary", () => {
			const keyA = contextKey<string>("aris.calendar", "next")
			const keyB = contextKey<string>("aris.calendar", "nextEvent")

			const ctx = new Context()
			ctx.set([
				[keyA, "a"],
				[keyB, "b"],
			])

			const results = ctx.find(keyA)
			expect(results).toHaveLength(1)
			expect(results[0]!.value).toBe("a")
		})

		test("object key parts with different property order match", () => {
			const key1 = contextKey<string>("source", "ctx", { b: 2, a: 1 })
			const key2 = contextKey<string>("source", "ctx", { a: 1, b: 2 })

			const ctx = new Context()
			ctx.set([[key1, "value"]])

			// Exact match via get should work regardless of property order
			expect(ctx.get(key2)).toBe("value")

			// find with the reordered key as prefix should also match
			const prefix = contextKey<string>("source", "ctx")
			const results = ctx.find(prefix)
			expect(results).toHaveLength(1)
		})

		test("single-segment prefix matches all keys starting with that segment", () => {
			const ctx = new Context()
			ctx.set([
				[contextKey("aris.weather", "current"), { temperature: 20 }],
				[contextKey("aris.weather", "forecast"), { high: 25 }],
				[contextKey("aris.calendar", "nextEvent"), { title: "Meeting" }],
			])

			const results = ctx.find(contextKey("aris.weather"))
			expect(results).toHaveLength(2)
		})

		test("does not match shorter keys", () => {
			const ctx = new Context()
			ctx.set([[contextKey("aris.weather"), "short"]])

			const results = ctx.find(contextKey("aris.weather", "current"))
			expect(results).toHaveLength(0)
		})

		test("numeric key parts match correctly", () => {
			const ctx = new Context()
			ctx.set([
				[contextKey("source", 1, "data"), "one"],
				[contextKey("source", 2, "data"), "two"],
			])

			const results = ctx.find(contextKey("source", 1))
			expect(results).toHaveLength(1)
			expect(results[0]!.value).toBe("one")
		})
	})

	describe("size", () => {
		test("returns 0 for empty context", () => {
			expect(new Context().size).toBe(0)
		})

		test("reflects number of entries", () => {
			const ctx = new Context()
			ctx.set([
				[WeatherKey, { temperature: 20 }],
				[NextEventKey, { title: "Standup" }],
			])
			expect(ctx.size).toBe(2)
		})
	})
})
