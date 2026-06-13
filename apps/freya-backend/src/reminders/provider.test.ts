import { describe, expect, test } from "bun:test"

import type { Database } from "../db/index.ts"

import { ReminderSourceProvider } from "./provider.ts"

const fakeDb = {} as Database

describe("ReminderSourceProvider", () => {
	const provider = new ReminderSourceProvider({ db: fakeDb })

	test("sourceId is freya.reminders", () => {
		expect(provider.sourceId).toBe("freya.reminders")
	})

	test("throws when config has extra keys", async () => {
		await expect(
			provider.feedSourceForUser("user-1", { lookAheadMs: 1000, extra: true }, null),
		).rejects.toThrow("Invalid reminders config")
	})

	test("throws when defaultTimeZone is invalid", async () => {
		await expect(
			provider.feedSourceForUser("user-1", { defaultTimeZone: "Not/AZone" }, null),
		).rejects.toThrow("Invalid reminders config")
	})

	test("returns ReminderSource with valid config", async () => {
		const source = await provider.feedSourceForUser(
			"user-1",
			{
				lookAheadMs: 48 * 60 * 60 * 1000,
				lookBackMs: 60 * 60 * 1000,
				includeCompleted: true,
				defaultTimeZone: "Europe/London",
			},
			null,
		)

		expect(source).toBeDefined()
		expect(source.id).toBe("freya.reminders")
	})

	test("returns ReminderSource with empty config", async () => {
		const source = await provider.feedSourceForUser("user-1", {}, null)

		expect(source).toBeDefined()
		expect(source.id).toBe("freya.reminders")
	})
})
