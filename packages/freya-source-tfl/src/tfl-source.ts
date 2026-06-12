import type { ActionDefinition, ContextEntry, FeedItemSignals, FeedSource } from "@freya/core"

import { Context, TimeRelevance, UnknownActionError } from "@freya/core"
import { LocationKey } from "@freya/source-location"
import { type } from "arktype"

import type {
	ITflApi,
	StationLocation,
	TflAlertData,
	TflAlertSeverity,
	TflLineId,
	TflSourceOptions,
	TflStatusFeedItem,
} from "./types.ts"

import { TflApi, lineId } from "./tfl-api.ts"
import { TflFeedItemType } from "./types.ts"

const setLinesInput = lineId.array()

const SEVERITY_URGENCY: Record<TflAlertSeverity, number> = {
	closure: 1.0,
	"major-delays": 0.8,
	"minor-delays": 0.6,
}

const SEVERITY_TIME_RELEVANCE: Record<TflAlertSeverity, TimeRelevance> = {
	closure: TimeRelevance.Imminent,
	"major-delays": TimeRelevance.Imminent,
	"minor-delays": TimeRelevance.Upcoming,
}

/**
 * A FeedSource that provides TfL (Transport for London) service alerts.
 *
 * Depends on location source for proximity-based sorting. Produces feed items
 * for tube, overground, and Elizabeth line disruptions.
 *
 * @example
 * ```ts
 * const tflSource = new TflSource({
 *   apiKey: process.env.TFL_API_KEY!,
 *   lines: ["northern", "victoria", "jubilee"],
 * })
 *
 * const engine = new FeedEngine()
 *   .register(locationSource)
 *   .register(tflSource)
 *
 * const { items } = await engine.refresh()
 * ```
 */
export class TflSource implements FeedSource<TflStatusFeedItem> {
	static readonly DEFAULT_LINES_OF_INTEREST: readonly TflLineId[] = [
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

	readonly id = "freya.tfl"
	readonly dependencies = ["freya.location"]

	private readonly client: ITflApi
	private lines: TflLineId[]

	constructor(options: TflSourceOptions) {
		if (!options.client && !options.apiKey) {
			throw new Error("Either client or apiKey must be provided")
		}
		this.client = options.client ?? new TflApi(options.apiKey!)
		this.lines = options.lines?.length ? options.lines : [...TflSource.DEFAULT_LINES_OF_INTEREST]
	}

	async listActions(): Promise<Record<string, ActionDefinition>> {
		return {
			"set-lines-of-interest": {
				id: "set-lines-of-interest",
				description: "Update the set of monitored TfL lines",
				input: setLinesInput,
			},
		}
	}

	async executeAction(actionId: string, params: unknown): Promise<void> {
		switch (actionId) {
			case "set-lines-of-interest": {
				const result = setLinesInput(params)
				if (result instanceof type.errors) {
					throw new Error(result.summary)
				}
				this.setLinesOfInterest(result)
				return
			}
			default:
				throw new UnknownActionError(actionId)
		}
	}

	async fetchContext(): Promise<readonly ContextEntry[] | null> {
		return null
	}

	/**
	 * Update the set of monitored lines. Takes effect on the next fetchItems call.
	 */
	setLinesOfInterest(lines: TflLineId[]): void {
		this.lines = lines
	}

	async fetchItems(context: Context): Promise<TflStatusFeedItem[]> {
		const [statuses, stations] = await Promise.all([
			this.client.fetchLineStatuses(this.lines),
			this.client.fetchStations(),
		])

		if (statuses.length === 0) {
			return []
		}

		const location = context.get(LocationKey)

		const alerts: TflAlertData[] = statuses.map((status) => ({
			line: status.lineId,
			lineName: status.lineName,
			severity: status.severity,
			description: status.description,
			closestStationDistance: location
				? findClosestStationDistance(status.lineId, stations, location.lat, location.lng)
				: null,
		}))

		// Sort by closest station distance ascending, nulls last
		alerts.sort((a, b) => {
			if (a.closestStationDistance === null && b.closestStationDistance === null) return 0
			if (a.closestStationDistance === null) return 1
			if (b.closestStationDistance === null) return -1
			return a.closestStationDistance - b.closestStationDistance
		})

		// Signals from the highest-severity alert
		const highestSeverity = alerts.reduce<TflAlertSeverity>(
			(worst, alert) =>
				SEVERITY_URGENCY[alert.severity] > SEVERITY_URGENCY[worst] ? alert.severity : worst,
			alerts[0]!.severity,
		)

		const signals: FeedItemSignals = {
			urgency: SEVERITY_URGENCY[highestSeverity],
			timeRelevance: SEVERITY_TIME_RELEVANCE[highestSeverity],
		}

		return [
			{
				id: "tfl-status",
				sourceId: this.id,
				type: TflFeedItemType.Status,
				timestamp: context.time,
				data: { alerts },
				signals,
			},
		]
	}
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371 // Earth's radius in km
	const dLat = ((lat2 - lat1) * Math.PI) / 180
	const dLng = ((lng2 - lng1) * Math.PI) / 180
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLng / 2) *
			Math.sin(dLng / 2)
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
	return R * c
}

function findClosestStationDistance(
	lineId: TflLineId,
	stations: StationLocation[],
	userLat: number,
	userLng: number,
): number | null {
	const lineStations = stations.filter((s) => s.lines.includes(lineId))
	if (lineStations.length === 0) return null

	let minDistance = Infinity
	for (const station of lineStations) {
		const distance = haversineDistance(userLat, userLng, station.lat, station.lng)
		if (distance < minDistance) {
			minDistance = distance
		}
	}

	return minDistance
}
