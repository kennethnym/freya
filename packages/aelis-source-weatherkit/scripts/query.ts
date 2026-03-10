#!/usr/bin/env bun

/**
 * Interactive CLI script to query WeatherKit directly.
 * Prompts for credentials, coordinates, and optional settings,
 * then prints the raw API response and processed feed items.
 * Caches credentials locally and writes response JSON to a file.
 *
 * Usage: bun packages/aelis-source-weatherkit/scripts/query.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"

import { Context } from "@aelis/core"
import { LocationKey } from "@aelis/source-location"

import { DefaultWeatherKitClient } from "../src/weatherkit"
import { WeatherSource, Units } from "../src/weather-source"

const SCRIPT_DIR = import.meta.dirname
const CACHE_DIR = join(SCRIPT_DIR, ".cache")
const CREDS_PATH = join(CACHE_DIR, "credentials.json")

interface CachedCredentials {
	teamId: string
	serviceId: string
	keyId: string
	privateKey: string
	lat?: number
	lng?: number
}

function loadCachedCredentials(): CachedCredentials | null {
	if (!existsSync(CREDS_PATH)) return null
	try {
		return JSON.parse(readFileSync(CREDS_PATH, "utf-8")) as CachedCredentials
	} catch {
		return null
	}
}

function saveCachedCredentials(creds: CachedCredentials): void {
	mkdirSync(CACHE_DIR, { recursive: true })
	writeFileSync(CREDS_PATH, JSON.stringify(creds))
}

const rl = createInterface({ input: process.stdin, output: process.stdout })

async function prompt(question: string, defaultValue?: string): Promise<string> {
	const suffix = defaultValue ? ` [${defaultValue}]` : ""
	const answer = await rl.question(`${question}${suffix}: `)
	return answer.trim() || defaultValue || ""
}

async function main(): Promise<void> {
	console.log("=== WeatherKit Query Tool ===\n")

	const cached = loadCachedCredentials()

	let teamId: string
	let serviceId: string
	let keyId: string
	let privateKey: string

	if (cached) {
		console.log(`Using cached credentials from ${CREDS_PATH}`)
		console.log(`  Team ID:    ${cached.teamId}`)
		console.log(`  Service ID: ${cached.serviceId}`)
		console.log(`  Key ID:     ${cached.keyId}\n`)

		const useCached = await prompt("Use cached credentials? (y/n)", "y")
		if (useCached.toLowerCase() === "y") {
			teamId = cached.teamId
			serviceId = cached.serviceId
			keyId = cached.keyId
			privateKey = cached.privateKey
		} else {
			;({ teamId, serviceId, keyId, privateKey } = await promptCredentials())
		}
	} else {
		console.log(`Credentials will be cached to ${CREDS_PATH}\n`)
		;({ teamId, serviceId, keyId, privateKey } = await promptCredentials())
	}

	// Location
	const defaultLat = cached?.lat?.toString() ?? "37.7749"
	const defaultLng = cached?.lng?.toString() ?? "-122.4194"
	const lat = parseFloat(await prompt("Latitude", defaultLat))
	const lng = parseFloat(await prompt("Longitude", defaultLng))

	if (Number.isNaN(lat) || Number.isNaN(lng)) {
		console.error("Invalid coordinates")
		process.exit(1)
	}

	const credentials = { privateKey, keyId, teamId, serviceId }
	saveCachedCredentials({ ...credentials, lat, lng })

	// Options
	const unitsInput = await prompt("Units (metric/imperial)", "metric")
	const units = unitsInput === "imperial" ? Units.imperial : Units.metric

	// Raw API query
	console.log("\n--- Raw WeatherKit Response ---\n")
	const client = new DefaultWeatherKitClient(credentials)
	const raw = await client.fetch({ lat, lng })
	console.log(JSON.stringify(raw, null, 2))

	// Write JSON to file
	const outPath = join(CACHE_DIR, "response.json")
	writeFileSync(outPath, JSON.stringify(raw))
	console.log(`\nResponse written to ${outPath}`)

	// Processed feed items via WeatherSource
	console.log("\n--- Processed Feed Items ---\n")
	const source = new WeatherSource({ client, units })
	const context = new Context()
	context.set([[LocationKey, { lat, lng, accuracy: 10, timestamp: new Date() }]])

	const items = await source.fetchItems(context)
	for (const item of items) {
		console.log(`[${item.type}] ${item.id}`)
		console.log(`  signals: ${JSON.stringify(item.signals)}`)
		if (item.slots) {
			console.log(`  slots:`)
			for (const [name, slot] of Object.entries(item.slots)) {
				console.log(`    ${name}: "${slot.description}" -> ${slot.content ?? "(unfilled)"}`)
			}
		}
		console.log(`  data: ${JSON.stringify(item.data, null, 4)}`)
		console.log()
	}

	const feedPath = join(CACHE_DIR, "feed-items.json")
	writeFileSync(feedPath, JSON.stringify(items, null, 2))
	console.log(`Feed items written to ${feedPath}`)
	console.log(`Total: ${items.length} items`)
	rl.close()
}

async function promptCredentials(): Promise<CachedCredentials> {
	const teamId = await prompt("Apple Team ID")
	if (!teamId) {
		console.error("Team ID is required")
		process.exit(1)
	}

	const serviceId = await prompt("Service ID")
	if (!serviceId) {
		console.error("Service ID is required")
		process.exit(1)
	}

	const keyId = await prompt("Key ID")
	if (!keyId) {
		console.error("Key ID is required")
		process.exit(1)
	}

	console.log("\nPaste your private key (PEM format). Enter an empty line when done:")
	const keyLines: string[] = []
	for await (const line of rl) {
		if (line.trim() === "") break
		keyLines.push(line)
	}
	const privateKey = keyLines.join("\n")
	if (!privateKey) {
		console.error("Private key is required")
		process.exit(1)
	}

	return { teamId, serviceId, keyId, privateKey }
}

main().catch((err) => {
	console.error("Error:", err)
	rl.close()
	process.exit(1)
})
