import { View } from "react-native"
import tw from "twrnc"

import { type Showcase, Section } from "../showcase"
import { Button } from "./button"
import { FeedCard } from "./feed-card"
import { SansSerifText } from "./sans-serif-text"
import { SerifText } from "./serif-text"

function FeedCardShowcase() {
	return (
		<View style={tw`gap-6`}>
			<Section title="Default">
				<FeedCard style={tw`p-4`}>
					<SansSerifText>Card content goes here</SansSerifText>
				</FeedCard>
			</Section>
			<Section title="With mixed content">
				<FeedCard style={tw`p-4 gap-2`}>
					<SerifText style={tw`text-xl`}>Title</SerifText>
					<SansSerifText>Body text inside a feed card.</SansSerifText>
					<Button style={tw`self-start mt-2`}>
						<Button.Label>Action</Button.Label>
					</Button>
				</FeedCard>
			</Section>
		</View>
	)
}

export const feedCardShowcase: Showcase = {
	title: "FeedCard",
	component: FeedCardShowcase,
}
