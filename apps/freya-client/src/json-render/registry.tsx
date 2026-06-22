import { defineRegistry } from "@json-render/react-native"
import { View } from "react-native"
import tw from "twrnc"

import { Button } from "@/components/ui/button"
import { FeedCard } from "@/components/ui/feed-card"
import { MonospaceText } from "@/components/ui/monospace-text"
import { SansSerifText } from "@/components/ui/sans-serif-text"
import { SerifText } from "@/components/ui/serif-text"

import { catalog } from "./catalog"

type ButtonIconName = React.ComponentProps<typeof Button.Icon>["name"]

export const { registry } = defineRegistry(catalog, {
	components: {
		View: ({ props, children }) => (
			<View style={props.style ? tw`${props.style}` : undefined}>{children}</View>
		),
		Button: ({ props, children, emit }) => (
			<Button intent={props.intent ?? undefined} onPress={() => emit("press")}>
				{children}
			</Button>
		),
		ButtonIcon: ({ props }) => <Button.Icon name={props.name as ButtonIconName} />,
		ButtonLabel: ({ props }) => <Button.Label>{props.text}</Button.Label>,
		FeedCard: ({ props, children }) => (
			<FeedCard style={props.style ? tw`${props.style}` : undefined}>{children}</FeedCard>
		),
		SansSerifText: ({ props }) => (
			<SansSerifText style={props.style ? tw`${props.style}` : undefined}>
				{props.text}
			</SansSerifText>
		),
		SerifText: ({ props }) => (
			<SerifText style={props.style ? tw`${props.style}` : undefined}>{props.text}</SerifText>
		),
		MonospaceText: ({ props }) => (
			<MonospaceText style={props.style ? tw`${props.style}` : undefined}>
				{props.text}
			</MonospaceText>
		),
	},
})
