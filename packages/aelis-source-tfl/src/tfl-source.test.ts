import { Context } from "@aelis/core"
import { LocationKey, type Location } from "@aelis/source-location"
import { describe, expect, test } from "bun:test"

import type {
	ITflApi,
	StationLocation,
	TflAlertSeverity,
	TflLineId,
	TflLineStatus,
} from "./types.ts"

import fixtures from "../fixtures/tfl-responses.json"
import { TflSource } from "./tfl-source.ts"

// Mock API that returns fixture data
class FixtureTflApi implements ITflApi {
	async fetchLineStatuses(_lines?: TflLineId[]): Promise<TflLineStatus[]> {
		const statuses: TflLineStatus[] = []

		for (const line of fixtures.lineStatuses as Record<string, unknown>[]) {
			for (const status of line.lineStatuses as Record<string, unknown>[]) {
				const severityCode = status.statusSeverity as number
				const severity = this.mapSeverity(severityCode)
				if (severity) {
					statuses.push({
						lineId: line.id as TflLineId,
						lineName: line.name as string,
						severity,
						description: (status.reason as string) ?? (status.statusSeverityDescription as string),
					})
				}
			}
		}

		return statuses
	}

	async fetchStations(): Promise<StationLocation[]> {
		const stationMap = new Map<string, StationLocation>()

		for (const [lineId, stops] of Object.entries(fixtures.stopPoints)) {
			for (const stop of stops as Record<string, unknown>[]) {
				const id = stop.naptanId as string
				const existing = stationMap.get(id)
				if (existing) {
					if (!existing.lines.includes(lineId as TflLineId)) {
						existing.lines.push(lineId as TflLineId)
					}
				} else {
					stationMap.set(id, {
						id,
						name: stop.commonName as string,
						lat: stop.lat as number,
						lng: stop.lon as number,
						lines: [lineId as TflLineId],
					})
				}
			}
		}

		return Array.from(stationMap.values())
	}

	private mapSeverity(code: number): TflAlertSeverity | null {
		const map: Record<number, TflAlertSeverity | null> = {
			1: "closure",
			2: "closure",
			3: "closure",
			4: "closure",
			5: "closure",
			6: "major-delays",
			7: "major-delays",
			8: "major-delays",
			9: "minor-delays",
			10: null,
		}
		return map[code] ?? null
	}
}

function createContext(location?: Location): Context {
	const ctx = new Context(new Date("2026-01-15T12:00:00Z"))
	if (location) {
		ctx.set([[LocationKey, location]])
	}
	return ctx
}

describe("TflSource", () => {
	const api = new FixtureTflApi()

	describe("interface", () => {
		test("has correct id", () => {
			const source = new TflSource({ client: api })
			expect(source.id).toBe("aelis.tfl")
		})

		test("depends on location", () => {
			const source = new TflSource({ client: api })
			expect(source.dependencies).toEqual(["aelis.location"])
		})

		test("implements fetchItems", () => {
			const source = new TflSource({ client: api })
			expect(source.fetchItems).toBeDefined()
		})

		test("throws if neither client nor apiKey provided", () => {
			expect(() => new TflSource({})).toThrow("Either client or apiKey must be provided")
		})
	})

	describe("setLinesOfInterest", () => {
		const lineFilteringApi: ITflApi = {
			async fetchLineStatuses(lines?: TflLineId[]): Promise<TflLineStatus[]> {
				const all: TflLineStatus[] = [
					{
						lineId: "northern",
						lineName: "Northern",
						severity: "minor-delays",
						description: "Delays",
					},
					{
						lineId: "central",
						lineName: "Central",
						severity: "closure",
						description: "Closed",
					},
				]
				return lines ? all.filter((s) => lines.includes(s.lineId)) : all
			},
			async fetchStations(): Promise<StationLocation[]> {
				return []
			},
		}

		test("changes which lines are fetched", async () => {
			const source = new TflSource({ client: lineFilteringApi })
			const before = await source.fetchItems(createContext())
			expect(before).toHaveLength(1)
			expect(before[0]!.data.alerts).toHaveLength(2)

			source.setLinesOfInterest(["northern"])
			const after = await source.fetchItems(createContext())

			expect(after).toHaveLength(1)
			expect(after[0]!.data.alerts).toHaveLength(1)
			expect(after[0]!.data.alerts[0]!.line).toBe("northern")
		})

		test("DEFAULT_LINES_OF_INTEREST restores all lines", async () => {
			const source = new TflSource({
				client: lineFilteringApi,
				lines: ["northern"],
			})
			const filtered = await source.fetchItems(createContext())
			expect(filtered[0]!.data.alerts).toHaveLength(1)

			source.setLinesOfInterest([...TflSource.DEFAULT_LINES_OF_INTEREST])
			const all = await source.fetchItems(createContext())

			expect(all[0]!.data.alerts).toHaveLength(2)
		})
	})

	describe("fetchItems", () => {
		test("returns at most one feed item", async () => {
			const source = new TflSource({ client: api })
			const items = await source.fetchItems(createContext())
			expect(items).toHaveLength(1)
		})

		test("returns empty array when no disruptions", async () => {
			const emptyApi: ITflApi = {
				async fetchLineStatuses(): Promise<TflLineStatus[]> {
					return []
				},
				async fetchStations(): Promise<StationLocation[]> {
					return []
				},
			}
			const source = new TflSource({ client: emptyApi })
			const items = await source.fetchItems(createContext())
			expect(items).toHaveLength(0)
		})

		test("combined item has correct base structure", async () => {
			const source = new TflSource({ client: api })
			const items = await source.fetchItems(createContext())

			const item = items[0]!
			expect(item.id).toBe("tfl-status")
			expect(item.type).toBe("tfl-status")
			expect(item.sourceId).toBe("aelis.tfl")
			expect(item.signals).toBeDefined()
			expect(typeof item.signals!.urgency).toBe("number")
			expect(item.timestamp).toBeInstanceOf(Date)
			expect(Array.isArray(item.data.alerts)).toBe(true)
			expect(item.data.alerts.length).toBeGreaterThan(0)
		})

		test("alerts have correct data structure", async () => {
			const source = new TflSource({ client: api })
			const location: Location = {
				lat: 51.5074,
				lng: -0.1278,
				accuracy: 10,
				timestamp: new Date(),
			}
			const items = await source.fetchItems(createContext(location))
			const alerts = items[0]!.data.alerts

			for (const alert of alerts) {
				expect(typeof alert.line).toBe("string")
				expect(typeof alert.lineName).toBe("string")
				expect(["minor-delays", "major-delays", "closure"]).toContain(alert.severity)
				expect(typeof alert.description).toBe("string")
				expect(
					alert.closestStationDistance === null || typeof alert.closestStationDistance === "number",
				).toBe(true)
			}
		})

		test("signals use highest severity urgency", async () => {
			const mixedApi: ITflApi = {
				async fetchLineStatuses(): Promise<TflLineStatus[]> {
					return [
						{
							lineId: "northern",
							lineName: "Northern",
							severity: "minor-delays",
							description: "Minor delays",
						},
						{
							lineId: "central",
							lineName: "Central",
							severity: "closure",
							description: "Closed",
						},
						{
							lineId: "jubilee",
							lineName: "Jubilee",
							severity: "major-delays",
							description: "Major delays",
						},
					]
				},
				async fetchStations(): Promise<StationLocation[]> {
					return []
				},
			}
			const source = new TflSource({ client: mixedApi })
			const items = await source.fetchItems(createContext())

			expect(items[0]!.signals!.urgency).toBe(1.0) // closure urgency
			expect(items[0]!.signals!.timeRelevance).toBe("imminent") // closure time relevance
		})

		test("signals use single alert severity when only one disruption", async () => {
			const singleApi: ITflApi = {
				async fetchLineStatuses(): Promise<TflLineStatus[]> {
					return [
						{
							lineId: "northern",
							lineName: "Northern",
							severity: "minor-delays",
							description: "Minor delays",
						},
					]
				},
				async fetchStations(): Promise<StationLocation[]> {
					return []
				},
			}
			const source = new TflSource({ client: singleApi })
			const items = await source.fetchItems(createContext())

			expect(items[0]!.signals!.urgency).toBe(0.6) // minor-delays urgency
			expect(items[0]!.signals!.timeRelevance).toBe("upcoming")
		})

		test("alerts sorted by closestStationDistance ascending, nulls last", async () => {
			const distanceApi: ITflApi = {
				async fetchLineStatuses(): Promise<TflLineStatus[]> {
					return [
						{
							lineId: "northern",
							lineName: "Northern",
							severity: "minor-delays",
							description: "Delays",
						},
						{
							lineId: "central",
							lineName: "Central",
							severity: "minor-delays",
							description: "Delays",
						},
						{
							lineId: "jubilee",
							lineName: "Jubilee",
							severity: "minor-delays",
							description: "Delays",
						},
					]
				},
				async fetchStations(): Promise<StationLocation[]> {
					return [
						{ id: "s1", name: "Station A", lat: 51.51, lng: -0.13, lines: ["central"] },
						{ id: "s2", name: "Station B", lat: 51.52, lng: -0.14, lines: ["northern"] },
						// No stations for jubilee — its distance will be null
					]
				},
			}
			const source = new TflSource({ client: distanceApi })
			const location: Location = {
				lat: 51.5074,
				lng: -0.1278,
				accuracy: 10,
				timestamp: new Date(),
			}
			const items = await source.fetchItems(createContext(location))
			const alerts = items[0]!.data.alerts

			// Alerts with distances should come before nulls
			const withDistance = alerts.filter((a) => a.closestStationDistance !== null)
			const withoutDistance = alerts.filter((a) => a.closestStationDistance === null)

			// All distance alerts come first
			const firstNullIndex = alerts.findIndex((a) => a.closestStationDistance === null)
			if (firstNullIndex !== -1) {
				for (let i = 0; i < firstNullIndex; i++) {
					expect(alerts[i]!.closestStationDistance).not.toBeNull()
				}
			}

			// Distance alerts are in ascending order
			for (let i = 1; i < withDistance.length; i++) {
				expect(withDistance[i]!.closestStationDistance!).toBeGreaterThanOrEqual(
					withDistance[i - 1]!.closestStationDistance!,
				)
			}

			expect(withoutDistance.length).toBe(1)
			expect(withoutDistance[0]!.line).toBe("jubilee")
		})

		test("closestStationDistance is number when location provided", async () => {
			const source = new TflSource({ client: api })
			const location: Location = {
				lat: 51.5074,
				lng: -0.1278,
				accuracy: 10,
				timestamp: new Date(),
			}
			const items = await source.fetchItems(createContext(location))

			for (const alert of items[0]!.data.alerts) {
				expect(typeof alert.closestStationDistance).toBe("number")
				expect(alert.closestStationDistance!).toBeGreaterThan(0)
			}
		})

		test("closestStationDistance is null when no location provided", async () => {
			const source = new TflSource({ client: api })
			const items = await source.fetchItems(createContext())

			for (const alert of items[0]!.data.alerts) {
				expect(alert.closestStationDistance).toBeNull()
			}
		})
	})

	describe("actions", () => {
		test("listActions returns set-lines-of-interest", async () => {
			const source = new TflSource({ client: api })
			const actions = await source.listActions()

			expect(actions["set-lines-of-interest"]).toBeDefined()
			expect(actions["set-lines-of-interest"]!.id).toBe("set-lines-of-interest")
		})

		test("executeAction set-lines-of-interest updates lines", async () => {
			const lineFilteringApi: ITflApi = {
				async fetchLineStatuses(lines?: TflLineId[]): Promise<TflLineStatus[]> {
					const all: TflLineStatus[] = [
						{
							lineId: "northern",
							lineName: "Northern",
							severity: "minor-delays",
							description: "Delays",
						},
						{
							lineId: "central",
							lineName: "Central",
							severity: "closure",
							description: "Closed",
						},
					]
					return lines ? all.filter((s) => lines.includes(s.lineId)) : all
				},
				async fetchStations(): Promise<StationLocation[]> {
					return []
				},
			}

			const source = new TflSource({ client: lineFilteringApi })
			await source.executeAction("set-lines-of-interest", ["northern"])

			const items = await source.fetchItems(createContext())
			expect(items).toHaveLength(1)
			expect(items[0]!.data.alerts).toHaveLength(1)
			expect(items[0]!.data.alerts[0]!.line).toBe("northern")
		})

		test("executeAction throws on invalid input", async () => {
			const source = new TflSource({ client: api })

			await expect(source.executeAction("set-lines-of-interest", "not-an-array")).rejects.toThrow()
		})

		test("executeAction throws for unknown action", async () => {
			const source = new TflSource({ client: api })

			await expect(source.executeAction("nonexistent", {})).rejects.toThrow("Unknown action")
		})
	})
})

describe("TfL Fixture Data Shape", () => {
	test("fixtures have expected structure", () => {
		expect(typeof fixtures.fetchedAt).toBe("string")
		expect(Array.isArray(fixtures.lineStatuses)).toBe(true)
		expect(typeof fixtures.stopPoints).toBe("object")
	})

	test("line statuses have required fields", () => {
		for (const line of fixtures.lineStatuses as Record<string, unknown>[]) {
			expect(typeof line.id).toBe("string")
			expect(typeof line.name).toBe("string")
			expect(Array.isArray(line.lineStatuses)).toBe(true)

			for (const status of line.lineStatuses as Record<string, unknown>[]) {
				expect(typeof status.statusSeverity).toBe("number")
				expect(typeof status.statusSeverityDescription).toBe("string")
			}
		}
	})

	test("stop points have required fields", () => {
		for (const [lineId, stops] of Object.entries(fixtures.stopPoints)) {
			expect(typeof lineId).toBe("string")
			expect(Array.isArray(stops)).toBe(true)

			for (const stop of stops as Record<string, unknown>[]) {
				expect(typeof stop.naptanId).toBe("string")
				expect(typeof stop.commonName).toBe("string")
				expect(typeof stop.lat).toBe("number")
				expect(typeof stop.lon).toBe("number")
			}
		}
	})
})
