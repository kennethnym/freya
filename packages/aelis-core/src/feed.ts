import type { JrxNode } from "@nym.sh/jrx"

/**
 * Source-provided hints for post-processors.
 *
 * Sources express domain-specific relevance without determining final ranking.
 * Post-processors consume these signals alongside other inputs (user affinity,
 * time of day, interaction history) to produce the final feed order.
 */
export const TimeRelevance = {
	/** Needs attention now (e.g., event starting in minutes, severe alert) */
	Imminent: "imminent",
	/** Relevant soon (e.g., event in the next hour, approaching deadline) */
	Upcoming: "upcoming",
	/** Background information (e.g., daily forecast, low-priority status) */
	Ambient: "ambient",
} as const

export type TimeRelevance = (typeof TimeRelevance)[keyof typeof TimeRelevance]

export interface FeedItemSignals {
	/** Source-assessed urgency (0-1). Post-processors use this as one ranking input. */
	urgency?: number
	/** How time-sensitive this item is relative to now. */
	timeRelevance?: TimeRelevance
}

/**
 * A named slot for LLM-fillable content on a feed item.
 *
 * Sources declare slots with a description that tells the LLM what content
 * to generate. The enhancement harness fills `content` asynchronously;
 * until then it remains `null`.
 */
export interface Slot {
	/** Tells the LLM what this slot wants — written by the source */
	description: string
	/** LLM-filled text content, null until enhanced */
	content: string | null
}

/**
 * A single item in the feed.
 *
 * @example
 * ```ts
 * type WeatherItem = FeedItem<"weather", { temp: number; condition: string }>
 *
 * const item: WeatherItem = {
 *   id: "weather-123",
 *   sourceId: "aelis.weatherkit",
 *   type: "weather",
 *   timestamp: new Date(),
 *   data: { temp: 18, condition: "cloudy" },
 *   signals: { urgency: 0.5, timeRelevance: "ambient" },
 *   slots: {
 *     insight: {
 *       description: "A short contextual insight about the current weather",
 *       content: null,
 *     },
 *   },
 * }
 * ```
 */
export interface FeedItem<
	TType extends string = string,
	TData extends Record<string, unknown> = Record<string, unknown>,
> {
	/** Unique identifier */
	id: string
	/** ID of the FeedSource that produced this item */
	sourceId: string
	/** Item type, matches the data source type */
	type: TType
	/** When this item was generated */
	timestamp: Date
	/** Type-specific payload */
	data: TData
	/** Source-provided hints for post-processors. Optional — omit if no signals apply. */
	signals?: FeedItemSignals
	/** Named slots for LLM-fillable content. Keys are slot names. */
	slots?: Record<string, Slot>
}

/** Takes a FeedItem and returns a JRX node tree for rendering. */
export type FeedItemRenderer<
	TType extends string = string,
	TData extends Record<string, unknown> = Record<string, unknown>,
> = (item: FeedItem<TType, TData>) => JrxNode

/** A FeedItem with a JRX UI tree attached for client-side rendering. */
export interface RenderedFeedItem<
	TType extends string = string,
	TData extends Record<string, unknown> = Record<string, unknown>,
> extends FeedItem<TType, TData> {
	/** JRX node tree describing how to render this item */
	ui: JrxNode
}
