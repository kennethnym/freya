/** @jsxImportSource @nym.sh/jrx */
import type { FeedItemRenderer } from "@freya/core"

import { FeedCard, SansSerifText } from "@freya/components"

import type { TflAlertData, TflStatusData } from "./types.ts"

import { TflAlertSeverity } from "./types.ts"

const SEVERITY_LABEL: Record<TflAlertSeverity, string> = {
	[TflAlertSeverity.Closure]: "Closed",
	[TflAlertSeverity.MajorDelays]: "Major delays",
	[TflAlertSeverity.MinorDelays]: "Minor delays",
}

function formatDistance(km: number): string {
	const meters = Math.round(km * 1000)
	if (meters < 1000) {
		return `${meters}m away`
	}
	return `${(meters / 1000).toFixed(1)}km away`
}

function renderAlertRow(alert: TflAlertData) {
	const severityLabel = SEVERITY_LABEL[alert.severity]

	return (
		<>
			<SansSerifText
				content={`${alert.lineName} · ${severityLabel}`}
				style="text-base font-semibold"
			/>
			<SansSerifText content={alert.description} style="text-sm" />
			{alert.closestStationDistance !== null ? (
				<SansSerifText
					content={`Nearest station: ${formatDistance(alert.closestStationDistance)}`}
					style="text-xs text-stone-500"
				/>
			) : null}
		</>
	)
}

export const renderTflStatus: FeedItemRenderer<"tfl-status", TflStatusData> = (item) => {
	return <FeedCard>{item.data.alerts.map((alert) => renderAlertRow(alert))}</FeedCard>
}
