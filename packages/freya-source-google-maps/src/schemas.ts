import { type } from "arktype"

const ResolveNameQuery = type({
	"+": "reject",
	text: "string",
})

export const SearchPlacesInput = type({
	"+": "reject",
	textQuery: "string",
	"locationBias?": "unknown",
	"languageCode?": "string",
	"regionCode?": "string",
})

export const LookupWeatherInput = type({
	"+": "reject",
	location: "unknown",
	"date?": "unknown",
	"hour?": "number",
	"unitsSystem?": "'UNITS_SYSTEM_UNSPECIFIED' | 'METRIC' | 'IMPERIAL'",
})

export const ComputeRoutesInput = type({
	"+": "reject",
	origin: "unknown",
	destination: "unknown",
	"travelMode?": "'ROUTE_TRAVEL_MODE_UNSPECIFIED' | 'DRIVE' | 'WALK'",
})

export const ResolveNamesInput = type({
	"+": "reject",
	queries: ResolveNameQuery.array(),
	"locationBias?": "unknown",
	"regionCode?": "string",
})

export const ResolveMapsUrlsInput = type({
	"+": "reject",
	urls: "string[]",
})
