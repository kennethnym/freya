import { type } from "arktype"

import type { StationLocation, TflAlertSeverity, TflLineStatus } from "./types.ts"

const TFL_API_BASE = "https://api.tfl.gov.uk"

const ALL_LINE_IDS: TflLineId[] = [
	"bakerloo",
	"central",
	"circle",
	"district",
	"hammersmith-city",
	"jubilee",
	"metropolitan",
	"northern",
	"piccadilly",
	"victoria",
	"waterloo-city",
	"lioness",
	"mildmay",
	"windrush",
	"weaver",
	"suffragette",
	"liberty",
	"elizabeth",
]

// TfL severity codes: https://api.tfl.gov.uk/Line/Meta/Severity
// 0 = Special Service, 1 = Closed, 6 = Severe Delays, 9 = Minor Delays, 10 = Good Service
const SEVERITY_MAP: Record<number, TflAlertSeverity | null> = {
	1: "closure",
	2: "closure", // Suspended
	3: "closure", // Part Suspended
	4: "closure", // Planned Closure
	5: "closure", // Part Closure
	6: "major-delays", // Severe Delays
	7: "major-delays", // Reduced Service
	8: "major-delays", // Bus Service
	9: "minor-delays", // Minor Delays
	10: null, // Good Service
	11: null, // Part Closed
	12: null, // Exit Only
	13: null, // No Step Free Access
	14: null, // Change of frequency
	15: null, // Diverted
	16: null, // Not Running
	17: null, // Issues Reported
	18: null, // No Issues
	19: null, // Information
	20: null, // Service Closed
}

export class TflApi {
	private apiKey: string
	private stationsCache: StationLocation[] | null = null

	constructor(apiKey: string) {
		this.apiKey = apiKey
	}

	private async fetch<T>(path: string): Promise<T> {
		const url = new URL(path, TFL_API_BASE)
		url.searchParams.set("app_key", this.apiKey)
		const response = await fetch(url.toString())
		if (!response.ok) {
			throw new Error(`TfL API error: ${response.status} ${response.statusText}`)
		}
		return response.json() as Promise<T>
	}

	async fetchLineStatuses(lines?: TflLineId[]): Promise<TflLineStatus[]> {
		const lineIds = lines ?? ALL_LINE_IDS
		const data = await this.fetch<unknown>(`/Line/${lineIds.join(",")}/Status`)

		const parsed = lineResponseArray(data)
		if (parsed instanceof type.errors) {
			throw new Error(`Invalid TfL API response: ${parsed.summary}`)
		}

		const statuses: TflLineStatus[] = []

		for (const line of parsed) {
			for (const status of line.lineStatuses) {
				const severity = SEVERITY_MAP[status.statusSeverity]
				if (severity) {
					statuses.push({
						lineId: line.id,
						lineName: line.name,
						severity,
						description: status.reason ?? status.statusSeverityDescription,
					})
				}
			}
		}

		return statuses
	}

	async fetchStations(): Promise<StationLocation[]> {
		if (this.stationsCache) {
			return this.stationsCache
		}

		// Fetch stations for all lines in parallel
		const responses = await Promise.all(
			ALL_LINE_IDS.map(async (id) => {
				const data = await this.fetch<unknown>(`/Line/${id}/StopPoints`)
				const parsed = lineStopPointsArray(data)
				if (parsed instanceof type.errors) {
					throw new Error(`Invalid TfL API response for line ${id}: ${parsed.summary}`)
				}
				return { lineId: id, stops: parsed }
			}),
		)

		// Merge stations, combining lines for shared stations
		const stationMap = new Map<string, StationLocation>()

		for (const { lineId: currentLineId, stops } of responses) {
			for (const stop of stops) {
				const existing = stationMap.get(stop.naptanId)
				if (existing) {
					if (!existing.lines.includes(currentLineId)) {
						existing.lines.push(currentLineId)
					}
				} else {
					stationMap.set(stop.naptanId, {
						id: stop.naptanId,
						name: stop.commonName,
						lat: stop.lat,
						lng: stop.lon,
						lines: [currentLineId],
					})
				}
			}
		}

		this.stationsCache = Array.from(stationMap.values())
		return this.stationsCache
	}
}

// Schemas

export const lineId = type(
	"'bakerloo' | 'central' | 'circle' | 'district' | 'hammersmith-city' | 'jubilee' | 'metropolitan' | 'northern' | 'piccadilly' | 'victoria' | 'waterloo-city' | 'lioness' | 'mildmay' | 'windrush' | 'weaver' | 'suffragette' | 'liberty' | 'elizabeth'",
)

export type TflLineId = typeof lineId.infer

const lineStatus = type({
	statusSeverity: "number",
	statusSeverityDescription: "string",
	"reason?": "string",
})

const lineResponse = type({
	id: lineId,
	name: "string",
	lineStatuses: lineStatus.array(),
})

const lineResponseArray = lineResponse.array()

const lineStopPoint = type({
	naptanId: "string",
	commonName: "string",
	lat: "number",
	lon: "number",
})

const lineStopPointsArray = lineStopPoint.array()
