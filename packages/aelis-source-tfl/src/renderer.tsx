import type { FeedItemRenderer } from "@aelis/core"

import { FeedCard, SansSerifText } from "@aelis/components"

import type { TflAlertData } from "./types.ts"

import { TflAlertSeverity } from "./types.ts"

const SEVERITY_LABEL: Record<TflAlertSeverity, string> = {
	[TflAlertSeverity.Closure]: "Closed",
	[TflAlertSeverity.MajorDelays]: "Major delays",
	[TflAlertSeverity.MinorDelays]: "Minor delays",
}

function formatDistance(km: number): string {
	if (km < 1) {
		return `${Math.round(km * 1000)}m away`
	}
	return `${km.toFixed(1)}km away`
}

export const renderTflAlert: FeedItemRenderer<"tfl-alert", TflAlertData> = (item) => {
	const { lineName, severity, description, closestStationDistance } = item.data
	const severityLabel = SEVERITY_LABEL[severity]

	return (
		<FeedCard>
			<SansSerifText content={`${lineName} · ${severityLabel}`} style="text-base font-semibold" />
			<SansSerifText content={description} style="text-sm" />
			{closestStationDistance !== null ? (
				<SansSerifText
					content={`Nearest station: ${formatDistance(closestStationDistance)}`}
					style="text-xs text-stone-500"
				/>
			) : null}
		</FeedCard>
	)
}
