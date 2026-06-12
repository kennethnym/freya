import { type } from "arktype"

/** Geographic coordinates with accuracy and timestamp. */
export const Location = type({
	lat: "number",
	lng: "number",
	/** Accuracy in meters */
	accuracy: "number",
	timestamp: "Date",
})

export type Location = typeof Location.infer

export interface LocationSourceOptions {
	/** Number of locations to retain in history. Defaults to 1. */
	historySize?: number
}
