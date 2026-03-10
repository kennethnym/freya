import { DefaultWeatherKitClient } from "../src/weatherkit"

function loadEnv(): Record<string, string> {
	const content = require("fs").readFileSync(".env", "utf-8")
	const env: Record<string, string> = {}

	for (const line of content.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#")) continue

		const eqIndex = trimmed.indexOf("=")
		if (eqIndex === -1) continue

		const key = trimmed.slice(0, eqIndex)
		let value = trimmed.slice(eqIndex + 1)

		if (value.startsWith('"') && value.endsWith('"')) {
			value = value.slice(1, -1)
		}

		env[key] = value.replace(/\\n/g, "\n")
	}

	return env
}

const env = loadEnv()

const client = new DefaultWeatherKitClient({
	privateKey: env.WEATHERKIT_PRIVATE_KEY!,
	keyId: env.WEATHERKIT_KEY_ID!,
	teamId: env.WEATHERKIT_TEAM_ID!,
	serviceId: env.WEATHERKIT_SERVICE_ID!,
})

const locations = {
	sanFrancisco: { lat: 37.7749, lng: -122.4194 },
}

async function main() {
	console.log("Fetching weather data for San Francisco...")

	const response = await client.fetch({
		lat: locations.sanFrancisco.lat,
		lng: locations.sanFrancisco.lng,
	})

	const fixture = {
		generatedAt: new Date().toISOString(),
		location: locations.sanFrancisco,
		response,
	}

	const output = JSON.stringify(fixture)
	await Bun.write("fixtures/san-francisco.json", output)

	console.log("Fixture written to fixtures/san-francisco.json")
}

main().catch(console.error)
