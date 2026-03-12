import { View } from "react-native"
import tw from "twrnc"

import { SerifText } from "./serif-text"
import { type Showcase, Section } from "../showcase"

function SerifTextShowcase() {
	return (
		<View style={tw`gap-6`}>
			<Section title="Sizes">
				<View style={tw`gap-2`}>
					<SerifText style={tw`text-sm`}>Small serif text</SerifText>
					<SerifText style={tw`text-base`}>Base serif text</SerifText>
					<SerifText style={tw`text-xl`}>Extra large serif text</SerifText>
					<SerifText style={tw`text-3xl`}>3XL serif text</SerifText>
				</View>
			</Section>
		</View>
	)
}

export const serifTextShowcase: Showcase = {
	title: "SerifText",
	component: SerifTextShowcase,
}
