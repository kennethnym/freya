import type { FeedItem } from "@aris/core"

import type { TflLineId } from "./tfl-api.ts"

export type { TflLineId } from "./tfl-api.ts"

export const TflAlertSeverity = {
	MinorDelays: "minor-delays",
	MajorDelays: "major-delays",
	Closure: "closure",
} as const

export type TflAlertSeverity = (typeof TflAlertSeverity)[keyof typeof TflAlertSeverity]

export interface TflAlertData extends Record<string, unknown> {
	line: TflLineId
	lineName: string
	severity: TflAlertSeverity
	description: string
	closestStationDistance: number | null
}

export const TflFeedItemType = {
	Alert: "tfl-alert",
} as const

export type TflFeedItemType = (typeof TflFeedItemType)[keyof typeof TflFeedItemType]

export type TflAlertFeedItem = FeedItem<typeof TflFeedItemType.Alert, TflAlertData>

export interface TflSourceOptions {
	apiKey?: string
	client?: ITflApi
	/** Lines to monitor. Defaults to all lines. */
	lines?: TflLineId[]
}

export interface StationLocation {
	id: string
	name: string
	lat: number
	lng: number
	lines: TflLineId[]
}

export interface ITflApi {
	fetchLineStatuses(lines?: TflLineId[]): Promise<TflLineStatus[]>
	fetchStations(): Promise<StationLocation[]>
}

export interface TflLineStatus {
	lineId: TflLineId
	lineName: string
	severity: TflAlertSeverity
	description: string
}
