/** @jsxImportSource @nym.sh/jrx */
import { render } from "@nym.sh/jrx"
import { describe, expect, test } from "bun:test"

import type { TflAlertData, TflStatusFeedItem } from "./types.ts"

import { renderTflStatus } from "./renderer.tsx"

function makeAlert(overrides: Partial<TflAlertData> = {}): TflAlertData {
	return {
		line: "northern",
		lineName: "Northern",
		severity: "minor-delays",
		description: "Minor delays due to signal failure",
		closestStationDistance: null,
		...overrides,
	}
}

function makeItem(alerts: TflAlertData[]): TflStatusFeedItem {
	return {
		id: "tfl-status",
		sourceId: "aelis.tfl",
		type: "tfl-status",
		timestamp: new Date("2026-01-15T12:00:00Z"),
		data: { alerts },
	}
}

/** Collect all SansSerifText elements from a rendered spec, filtering out Fragments. */
function collectTextElements(spec: ReturnType<typeof render>) {
	return Object.values(spec.elements).filter((el) => el.type === "SansSerifText")
}

describe("renderTflStatus", () => {
	test("renders a single FeedCard", () => {
		const node = renderTflStatus(makeItem([makeAlert()]))
		const spec = render(node)

		const root = spec.elements[spec.root]!
		expect(root.type).toBe("FeedCard")
	})

	test("renders one alert with title and description", () => {
		const node = renderTflStatus(makeItem([makeAlert()]))
		const spec = render(node)

		const texts = collectTextElements(spec)
		const titleText = texts.find((el) => el.props.content === "Northern · Minor delays")
		const bodyText = texts.find((el) => el.props.content === "Minor delays due to signal failure")

		expect(titleText).toBeDefined()
		expect(bodyText).toBeDefined()
	})

	test("renders multiple alerts stacked in one card", () => {
		const alerts = [
			makeAlert({ line: "northern", lineName: "Northern", severity: "minor-delays" }),
			makeAlert({
				line: "central",
				lineName: "Central",
				severity: "closure",
				description: "Closed due to strike",
			}),
		]
		const node = renderTflStatus(makeItem(alerts))
		const spec = render(node)

		const root = spec.elements[spec.root]!
		expect(root.type).toBe("FeedCard")

		const texts = collectTextElements(spec)
		const northernTitle = texts.find((el) => el.props.content === "Northern · Minor delays")
		const centralTitle = texts.find((el) => el.props.content === "Central · Closed")
		const centralBody = texts.find((el) => el.props.content === "Closed due to strike")

		expect(northernTitle).toBeDefined()
		expect(centralTitle).toBeDefined()
		expect(centralBody).toBeDefined()
	})

	test("shows nearest station distance when available", () => {
		const node = renderTflStatus(makeItem([makeAlert({ closestStationDistance: 0.35 })]))
		const spec = render(node)

		const texts = collectTextElements(spec)
		const caption = texts.find((el) => el.props.content === "Nearest station: 350m away")
		expect(caption).toBeDefined()
	})

	test("formats distance in km when >= 1km", () => {
		const node = renderTflStatus(makeItem([makeAlert({ closestStationDistance: 2.456 })]))
		const spec = render(node)

		const texts = collectTextElements(spec)
		const caption = texts.find((el) => el.props.content === "Nearest station: 2.5km away")
		expect(caption).toBeDefined()
	})

	test("formats near-1km boundary as km not meters", () => {
		const node = renderTflStatus(makeItem([makeAlert({ closestStationDistance: 0.9999 })]))
		const spec = render(node)

		const texts = collectTextElements(spec)
		const caption = texts.find((el) => el.props.content === "Nearest station: 1.0km away")
		expect(caption).toBeDefined()
	})

	test("omits station distance when null", () => {
		const node = renderTflStatus(makeItem([makeAlert({ closestStationDistance: null })]))
		const spec = render(node)

		const texts = collectTextElements(spec)
		const distanceTexts = texts.filter((el) =>
			(el.props.content as string).startsWith("Nearest station:"),
		)
		expect(distanceTexts).toHaveLength(0)
	})

	test("renders closure severity label", () => {
		const node = renderTflStatus(
			makeItem([makeAlert({ severity: "closure", lineName: "Central" })]),
		)
		const spec = render(node)

		const texts = collectTextElements(spec)
		const title = texts.find((el) => el.props.content === "Central · Closed")
		expect(title).toBeDefined()
	})

	test("renders major delays severity label", () => {
		const node = renderTflStatus(
			makeItem([makeAlert({ severity: "major-delays", lineName: "Jubilee" })]),
		)
		const spec = render(node)

		const texts = collectTextElements(spec)
		const title = texts.find((el) => el.props.content === "Jubilee · Major delays")
		expect(title).toBeDefined()
	})
})
