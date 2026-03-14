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
		View: ({ props, children }) => <View style={props.style ? tw`${props.style}` : undefined}>{children}</View>,
		Button: ({ props, emit }) => (
			<Button
				label={props.label}
				leadingIcon={props.leadingIcon ? <Button.Icon name={props.leadingIcon as ButtonIconName} /> : undefined}
				trailingIcon={props.trailingIcon ? <Button.Icon name={props.trailingIcon as ButtonIconName} /> : undefined}
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
