import { describe, expect, test } from "bun:test"

import { ensureEnv } from "./env.ts"

describe("ensureEnv", () => {
	test("returns trimmed required env values", () => {
		const env = ensureEnv({
			BETTER_AUTH_SECRET: " auth-secret ",
			CREDENTIAL_ENCRYPTION_KEY: " credential-key ",
			DATABASE_URL: " postgres://example ",
			EXA_API_KEY: " exa-key ",
			GOOGLE_MAPS_API_KEY: " google-maps-key ",
			OPENROUTER_API_KEY: " openrouter-key ",
			TFL_API_KEY: " tfl-key ",
			WEATHERKIT_KEY_ID: " weather-key-id ",
			WEATHERKIT_PRIVATE_KEY: " weather-private-key ",
			WEATHERKIT_SERVICE_ID: " weather-service-id ",
			WEATHERKIT_TEAM_ID: " weather-team-id ",
		})

		expect(env).toEqual({
			betterAuthSecret: "auth-secret",
			credentialEncryptionKey: "credential-key",
			databaseUrl: "postgres://example",
			exaApiKey: "exa-key",
			googleMapsApiKey: "google-maps-key",
			openrouterApiKey: "openrouter-key",
			tflApiKey: "tfl-key",
			weatherkitKeyId: "weather-key-id",
			weatherkitPrivateKey: "weather-private-key",
			weatherkitServiceId: "weather-service-id",
			weatherkitTeamId: "weather-team-id",
		})
	})

	test("does not allow the old Google Maps MCP fallback key", () => {
		expect(() =>
			ensureEnv({
				BETTER_AUTH_SECRET: "auth-secret",
				CREDENTIAL_ENCRYPTION_KEY: "credential-key",
				DATABASE_URL: "postgres://example",
				EXA_API_KEY: "exa-key",
				GOOGLE_MAPS_MCP_API_KEY: "google-maps-mcp-key",
				OPENROUTER_API_KEY: "openrouter-key",
				TFL_API_KEY: "tfl-key",
				WEATHERKIT_KEY_ID: "weather-key-id",
				WEATHERKIT_PRIVATE_KEY: "weather-private-key",
				WEATHERKIT_SERVICE_ID: "weather-service-id",
				WEATHERKIT_TEAM_ID: "weather-team-id",
			}),
		).toThrow("Missing required environment variables: GOOGLE_MAPS_API_KEY")
	})

	test("throws with all missing required env names", () => {
		expect(() => ensureEnv({})).toThrow(
			"Missing required environment variables: BETTER_AUTH_SECRET, CREDENTIAL_ENCRYPTION_KEY, DATABASE_URL, EXA_API_KEY, OPENROUTER_API_KEY, TFL_API_KEY, WEATHERKIT_PRIVATE_KEY, WEATHERKIT_KEY_ID, WEATHERKIT_TEAM_ID, WEATHERKIT_SERVICE_ID, GOOGLE_MAPS_API_KEY",
		)
	})

	test("treats whitespace-only values as missing", () => {
		expect(() =>
			ensureEnv({
				BETTER_AUTH_SECRET: "auth-secret",
				CREDENTIAL_ENCRYPTION_KEY: "credential-key",
				DATABASE_URL: "postgres://example",
				EXA_API_KEY: " ",
				GOOGLE_MAPS_API_KEY: "google-maps-key",
				OPENROUTER_API_KEY: "openrouter-key",
				TFL_API_KEY: "tfl-key",
				WEATHERKIT_KEY_ID: "weather-key-id",
				WEATHERKIT_PRIVATE_KEY: "weather-private-key",
				WEATHERKIT_SERVICE_ID: "weather-service-id",
				WEATHERKIT_TEAM_ID: "weather-team-id",
			}),
		).toThrow("Missing required environment variables: EXA_API_KEY")
	})
})
