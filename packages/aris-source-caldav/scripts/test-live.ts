/**
 * Live test script for CalDavSource.
 *
 * Usage:
 *   bun run test-live.ts
 *
 * Writes feed items (with slots) to scripts/.cache/feed-items.json for inspection.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { Context } from "@aris/core"

import { CalDavSource } from "../src/index.ts"

const serverUrl = prompt("CalDAV server URL:")
const username = prompt("Username:")
const password = prompt("Password:")
const lookAheadRaw = prompt("Look-ahead days (default 0):")

if (!serverUrl || !username || !password) {
	console.error("Server URL, username, and password are required.")
	process.exit(1)
}

const lookAheadDays = Number(lookAheadRaw) || 0

const source = new CalDavSource({
	serverUrl,
	authMethod: "basic",
	username,
	password,
	lookAheadDays,
})

const context = new Context()

console.log(`\nFetching from ${serverUrl} as ${username} (lookAheadDays=${lookAheadDays})...\n`)

const contextResult = await source.fetchContext(context)
const items = await source.fetchItems(context)

console.log("=== Context ===")
console.log(JSON.stringify(contextResult, null, 2))

console.log(`\n=== Feed Items (${items.length}) ===`)
for (const item of items) {
	console.log(`\n--- ${item.data.title} ---`)
	console.log(`  ID:         ${item.id}`)
	console.log(`  Calendar:   ${item.data.calendarName ?? "(unknown)"}`)
	console.log(`  Start:      ${item.data.startDate.toISOString()}`)
	console.log(`  End:        ${item.data.endDate.toISOString()}`)
	console.log(`  All-day:    ${item.data.isAllDay}`)
	console.log(`  Location:   ${item.data.location ?? "(none)"}`)
	console.log(`  Status:     ${item.data.status ?? "(none)"}`)
	console.log(`  Urgency:    ${item.signals?.urgency}`)
	console.log(`  Relevance:  ${item.signals?.timeRelevance}`)
	if (item.slots) {
		console.log(`  Slots:      ${Object.keys(item.slots).join(", ")}`)
	}
	if (item.data.attendees.length > 0) {
		console.log(`  Attendees:  ${item.data.attendees.map((a) => a.name ?? a.email).join(", ")}`)
	}
	if (item.data.description) {
		console.log(`  Desc:       ${item.data.description.slice(0, 100)}`)
	}
}

if (items.length === 0) {
	console.log("(no events found in the time window)")
}

// Write feed items to .cache for slot testing
const cacheDir = join(import.meta.dir, ".cache")
mkdirSync(cacheDir, { recursive: true })

const outPath = join(cacheDir, "feed-items.json")
writeFileSync(outPath, JSON.stringify(items, null, 2))
console.log(`\nFeed items written to ${outPath}`)
