/** @jsxImportSource @nym.sh/jrx */
import { render } from "@nym.sh/jrx"
import { describe, expect, test } from "bun:test"

import type { TflAlertFeedItem } from "./types.ts"

import { renderTflAlert } from "./renderer.tsx"

function makeItem(overrides: Partial<TflAlertFeedItem["data"]> = {}): TflAlertFeedItem {
	return {
		id: "tfl-alert-northern-minor-delays",
		type: "tfl-alert",
		timestamp: new Date("2026-01-15T12:00:00Z"),
		data: {
			line: "northern",
			lineName: "Northern",
			severity: "minor-delays",
			description: "Minor delays due to signal failure",
			closestStationDistance: null,
			...overrides,
		},
	}
}

describe("renderTflAlert", () => {
	test("renders a FeedCard with title and description", () => {
		const node = renderTflAlert(makeItem())
		const spec = render(node)

		const root = spec.elements[spec.root]!
		expect(root.type).toBe("FeedCard")
		expect(root.children!.length).toBeGreaterThanOrEqual(2)

		const title = spec.elements[root.children![0]!]!
		expect(title.type).toBe("SansSerifText")
		expect(title.props.content).toBe("Northern · Minor delays")

		const body = spec.elements[root.children![1]!]!
		expect(body.type).toBe("SansSerifText")
		expect(body.props.content).toBe("Minor delays due to signal failure")
	})

	test("shows nearest station distance when available", () => {
		const node = renderTflAlert(makeItem({ closestStationDistance: 0.35 }))
		const spec = render(node)

		const root = spec.elements[spec.root]!
		expect(root.children).toHaveLength(3)

		const caption = spec.elements[root.children![2]!]!
		expect(caption.type).toBe("SansSerifText")
		expect(caption.props.content).toBe("Nearest station: 350m away")
	})

	test("formats distance in km when >= 1km", () => {
		const node = renderTflAlert(makeItem({ closestStationDistance: 2.456 }))
		const spec = render(node)

		const root = spec.elements[spec.root]!
		const caption = spec.elements[root.children![2]!]!
		expect(caption.props.content).toBe("Nearest station: 2.5km away")
	})

	test("omits station distance when null", () => {
		const node = renderTflAlert(makeItem({ closestStationDistance: null }))
		const spec = render(node)

		const root = spec.elements[spec.root]!
		// Title + body only, no caption (empty fragment doesn't produce a child)
		const children = root.children!.filter((key) => {
			const el = spec.elements[key]
			return el && el.type !== "Fragment"
		})
		expect(children).toHaveLength(2)
	})

	test("renders closure severity label", () => {
		const node = renderTflAlert(makeItem({ severity: "closure", lineName: "Central" }))
		const spec = render(node)

		const root = spec.elements[spec.root]!
		const title = spec.elements[root.children![0]!]!
		expect(title.props.content).toBe("Central · Closed")
	})

	test("renders major delays severity label", () => {
		const node = renderTflAlert(makeItem({ severity: "major-delays", lineName: "Jubilee" }))
		const spec = render(node)

		const root = spec.elements[spec.root]!
		const title = spec.elements[root.children![0]!]!
		expect(title.props.content).toBe("Jubilee · Major delays")
	})
})
