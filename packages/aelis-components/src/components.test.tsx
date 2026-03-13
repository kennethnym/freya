/** @jsxImportSource @nym.sh/jrx */

import { render } from "@nym.sh/jrx"
import { describe, expect, test } from "bun:test"

import { Button } from "./button.ts"
import { FeedCard } from "./feed-card.ts"
import { MonospaceText } from "./monospace-text.ts"
import { SansSerifText } from "./sans-serif-text.ts"
import { SerifText } from "./serif-text.ts"

describe("Button", () => {
	test("renders with label", () => {
		const spec = render(<Button label="Press me" />)

		expect(spec.root).toStartWith("button-")
		const root = spec.elements[spec.root]!
		expect(root.type).toBe("Button")
		expect(root.props).toEqual({ label: "Press me" })
	})

	test("renders with icon props", () => {
		const spec = render(<Button label="Add" leadingIcon="plus" trailingIcon="arrow-right" />)

		const root = spec.elements[spec.root]!
		expect(root.type).toBe("Button")
		expect(root.props).toEqual({
			label: "Add",
			leadingIcon: "plus",
			trailingIcon: "arrow-right",
		})
	})

	test("passes style as string prop", () => {
		const spec = render(<Button label="Go" style="px-4 py-2" />)

		const root = spec.elements[spec.root]!
		expect(root.props.style).toBe("px-4 py-2")
	})
})

describe("FeedCard", () => {
	test("renders as container", () => {
		const spec = render(<FeedCard />)

		expect(spec.root).toStartWith("feedcard-")
		const root = spec.elements[spec.root]!
		expect(root.type).toBe("FeedCard")
	})

	test("renders with a single child", () => {
		const spec = render(
			<FeedCard>
				<SansSerifText content="Only child" />
			</FeedCard>,
		)

		const root = spec.elements[spec.root]!
		expect(root.children).toHaveLength(1)
		const child = spec.elements[root.children![0]!]!
		expect(child.type).toBe("SansSerifText")
		expect(child.props).toEqual({ content: "Only child" })
	})

	test("passes style as string prop", () => {
		const spec = render(<FeedCard style="p-4 border rounded-lg" />)

		const root = spec.elements[spec.root]!
		expect(root.props.style).toBe("p-4 border rounded-lg")
	})
})

describe("SansSerifText", () => {
	test("renders with content prop", () => {
		const spec = render(<SansSerifText content="Hello" />)

		expect(spec.root).toStartWith("sansseriftext-")
		const root = spec.elements[spec.root]!
		expect(root.type).toBe("SansSerifText")
		expect(root.props).toEqual({ content: "Hello" })
	})

	test("passes style as string prop", () => {
		const spec = render(<SansSerifText content="Hello" style="text-sm text-stone-500" />)

		const root = spec.elements[spec.root]!
		expect(root.props.style).toBe("text-sm text-stone-500")
	})
})

describe("SerifText", () => {
	test("renders with content prop", () => {
		const spec = render(<SerifText content="Title" />)

		expect(spec.root).toStartWith("seriftext-")
		const root = spec.elements[spec.root]!
		expect(root.type).toBe("SerifText")
		expect(root.props).toEqual({ content: "Title" })
	})

	test("passes style as string prop", () => {
		const spec = render(<SerifText content="Title" style="text-xl" />)

		const root = spec.elements[spec.root]!
		expect(root.props.style).toBe("text-xl")
	})
})

describe("MonospaceText", () => {
	test("renders with content prop", () => {
		const spec = render(<MonospaceText content="code()" />)

		expect(spec.root).toStartWith("monospacetext-")
		const root = spec.elements[spec.root]!
		expect(root.type).toBe("MonospaceText")
		expect(root.props).toEqual({ content: "code()" })
	})

	test("passes style as string prop", () => {
		const spec = render(<MonospaceText content="code()" style="text-xs" />)

		const root = spec.elements[spec.root]!
		expect(root.props.style).toBe("text-xs")
	})
})

describe("composite", () => {
	test("FeedCard with nested children", () => {
		const spec = render(
			<FeedCard>
				<SerifText content="Weather" />
				<SansSerifText content="Sunny, 22C" />
				<Button label="Details" />
			</FeedCard>,
		)

		const root = spec.elements[spec.root]!
		expect(root.type).toBe("FeedCard")
		expect(root.children).toHaveLength(3)

		const childKeys = root.children!
		const child0 = spec.elements[childKeys[0]!]!
		const child1 = spec.elements[childKeys[1]!]!
		const child2 = spec.elements[childKeys[2]!]!

		expect(child0.type).toBe("SerifText")
		expect(child0.props).toEqual({ content: "Weather" })

		expect(child1.type).toBe("SansSerifText")
		expect(child1.props).toEqual({ content: "Sunny, 22C" })

		expect(child2.type).toBe("Button")
		expect(child2.props).toEqual({ label: "Details" })
	})
})
