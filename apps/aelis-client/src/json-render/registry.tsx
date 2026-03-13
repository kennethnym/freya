import Feather from "@expo/vector-icons/Feather"
import { defineRegistry } from "@json-render/react-native"
import { View } from "react-native"
import tw from "twrnc"

import { Button } from "@/components/ui/button"
import { FeedCard } from "@/components/ui/feed-card"
import { MonospaceText } from "@/components/ui/monospace-text"
import { SansSerifText } from "@/components/ui/sans-serif-text"
import { SerifText } from "@/components/ui/serif-text"

import { catalog } from "./catalog"

function featherIcon(name: string | null | undefined) {
	if (!name) return undefined
	return <Feather name={name as React.ComponentProps<typeof Feather>["name"]} size={18} color="#e7e5e4" />
}

export const { registry } = defineRegistry(catalog, {
	components: {
		View: ({ props, children }) => <View style={props.style ? tw`${props.style}` : undefined}>{children}</View>,
		Button: ({ props, emit }) => (
			<Button
				label={props.label}
				leadingIcon={featherIcon(props.leadingIcon)}
				trailingIcon={featherIcon(props.trailingIcon)}
				onPress={() => emit("press")}
			/>
		),
		FeedCard: ({ props, children }) => (
			<FeedCard style={props.style ? tw`${props.style}` : undefined}>{children}</FeedCard>
		),
		SansSerifText: ({ props }) => (
			<SansSerifText style={props.style ? tw`${props.style}` : undefined}>{props.text}</SansSerifText>
		),
		SerifText: ({ props }) => (
			<SerifText style={props.style ? tw`${props.style}` : undefined}>{props.text}</SerifText>
		),
		MonospaceText: ({ props }) => (
			<MonospaceText style={props.style ? tw`${props.style}` : undefined}>{props.text}</MonospaceText>
		),
	},
})
