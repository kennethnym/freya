import { defineCatalog } from "@json-render/core"
import { schema } from "@json-render/react-native/schema"
import { z } from "zod"

export const catalog = defineCatalog(schema, {
	components: {
		View: {
			props: z.object({
				style: z.string().nullable(),
			}),
			slots: ["default"],
			description:
				"Generic layout container. The style prop accepts a twrnc class string (e.g. 'flex-row gap-2 p-4 items-center').",
			example: { style: "flex-row gap-2 p-4" },
		},
		Button: {
			props: z.object({
				label: z.string(),
				leadingIcon: z.string().nullable(),
				trailingIcon: z.string().nullable(),
			}),
			events: ["press"],
			slots: [],
			description:
				"Pressable button with a label and optional Feather icons. Icon values are Feather icon names (e.g. 'plus', 'arrow-right'). Bind on.press to trigger an action.",
			example: { label: "Add item", leadingIcon: "plus", trailingIcon: null },
		},
		FeedCard: {
			props: z.object({
				style: z.string().nullable(),
			}),
			slots: ["default"],
			description: "Bordered card container for feed content. The style prop accepts a twrnc class string.",
			example: { style: "p-4 gap-2" },
		},
		SansSerifText: {
			props: z.object({
				text: z.string(),
				style: z.string().nullable(),
			}),
			slots: [],
			description:
				"Sans-serif text (Inter font). The style prop accepts a twrnc class string for size, weight, color, etc.",
			example: { text: "Hello world", style: "text-base font-medium" },
		},
		SerifText: {
			props: z.object({
				text: z.string(),
				style: z.string().nullable(),
			}),
			slots: [],
			description:
				"Serif text (Source Serif 4 font). The style prop accepts a twrnc class string for size, color, etc.",
			example: { text: "Heading", style: "text-xl" },
		},
		MonospaceText: {
			props: z.object({
				text: z.string(),
				style: z.string().nullable(),
			}),
			slots: [],
			description:
				"Monospace text (Menlo font). The style prop accepts a twrnc class string for size, color, etc.",
			example: { text: "const x = 42", style: "text-sm" },
		},
	},
	actions: {},
})
