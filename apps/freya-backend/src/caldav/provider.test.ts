import { describe, expect, test } from "bun:test"

import { CalDavSourceProvider } from "./provider.ts"

describe("CalDavSourceProvider", () => {
	const provider = new CalDavSourceProvider()

	test("sourceId is freya.caldav", () => {
		expect(provider.sourceId).toBe("freya.caldav")
	})

	test("throws when credentials are null", async () => {
		const config = { serverUrl: "https://caldav.icloud.com", username: "user@icloud.com" }
		await expect(provider.feedSourceForUser("user-1", config, null)).rejects.toThrow(
			"No CalDAV credentials configured",
		)
	})

	test("throws when credentials are missing password", async () => {
		const config = { serverUrl: "https://caldav.icloud.com", username: "user@icloud.com" }
		await expect(provider.feedSourceForUser("user-1", config, {})).rejects.toThrow(
			"password must be a string",
		)
	})

	test("throws when config is missing serverUrl", async () => {
		const credentials = { password: "app-specific-password" }
		await expect(
			provider.feedSourceForUser("user-1", { username: "user@icloud.com" }, credentials),
		).rejects.toThrow("Invalid CalDAV config")
	})

	test("throws when config is missing username", async () => {
		const credentials = { password: "app-specific-password" }
		await expect(
			provider.feedSourceForUser("user-1", { serverUrl: "https://caldav.icloud.com" }, credentials),
		).rejects.toThrow("Invalid CalDAV config")
	})

	test("throws when config has extra keys", async () => {
		const config = {
			serverUrl: "https://caldav.icloud.com",
			username: "user@icloud.com",
			extra: true,
		}
		const credentials = { password: "app-specific-password" }
		await expect(provider.feedSourceForUser("user-1", config, credentials)).rejects.toThrow(
			"Invalid CalDAV config",
		)
	})

	test("throws when credentials have extra keys", async () => {
		const config = { serverUrl: "https://caldav.icloud.com", username: "user@icloud.com" }
		const credentials = { password: "app-specific-password", extra: true }
		await expect(provider.feedSourceForUser("user-1", config, credentials)).rejects.toThrow(
			"extra must be removed",
		)
	})

	test("returns CalDavSource with valid config and credentials", async () => {
		const config = {
			serverUrl: "https://caldav.icloud.com",
			username: "user@icloud.com",
			lookAheadDays: 3,
			timeZone: "Europe/London",
		}
		const credentials = { password: "app-specific-password" }

		const source = await provider.feedSourceForUser("user-1", config, credentials)
		expect(source).toBeDefined()
		expect(source.id).toBe("freya.caldav")
	})

	test("returns CalDavSource with minimal config", async () => {
		const config = {
			serverUrl: "https://caldav.icloud.com",
			username: "user@icloud.com",
		}
		const credentials = { password: "app-specific-password" }

		const source = await provider.feedSourceForUser("user-1", config, credentials)
		expect(source).toBeDefined()
		expect(source.id).toBe("freya.caldav")
	})
})
