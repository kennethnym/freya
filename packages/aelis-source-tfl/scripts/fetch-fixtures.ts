// Fetches real TfL API responses and saves them as test fixtures

const TEST_LINES = ["northern", "central", "elizabeth"]
const BASE_URL = "https://api.tfl.gov.uk"

async function fetchFixtures() {
	console.log("Fetching line statuses...")
	const statusRes = await fetch(`${BASE_URL}/Line/${TEST_LINES.join(",")}/Status`)
	const lineStatuses = await statusRes.json()

	console.log("Fetching stop points...")
	const stopPoints: Record<string, unknown> = {}
	for (const lineId of TEST_LINES) {
		console.log(`  Fetching ${lineId}...`)
		const res = await fetch(`${BASE_URL}/Line/${lineId}/StopPoints`)
		stopPoints[lineId] = await res.json()
	}

	const fixtures = {
		fetchedAt: new Date().toISOString(),
		lineStatuses,
		stopPoints,
	}

	const path = new URL("../fixtures/tfl-responses.json", import.meta.url)
	await Bun.write(path, JSON.stringify(fixtures))

	console.log(`\nFixtures saved to fixtures/tfl-responses.json`)
	console.log(`  Line statuses: ${(lineStatuses as unknown[]).length} lines`)
	for (const [lineId, stops] of Object.entries(stopPoints)) {
		console.log(`  ${lineId} stops: ${(stops as unknown[]).length}`)
	}
}

fetchFixtures().catch(console.error)
