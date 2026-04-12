import { View } from "react-native"
import tw from "twrnc"

import { type Showcase, Section } from "../showcase"
import { SansSerifText } from "./sans-serif-text"

function SansSerifTextShowcase() {
	return (
		<View style={tw`gap-6`}>
			<Section title="Sizes">
				<View style={tw`gap-2`}>
					<SansSerifText style={tw`text-sm`}>Small sans-serif text</SansSerifText>
					<SansSerifText style={tw`text-base`}>Base sans-serif text</SansSerifText>
					<SansSerifText style={tw`text-xl`}>Extra large sans-serif text</SansSerifText>
					<SansSerifText style={tw`text-3xl`}>3XL sans-serif text</SansSerifText>
				</View>
			</Section>
			<Section title="Weights">
				<View style={tw`gap-2`}>
					<SansSerifText style={tw`font-light`}>Light weight</SansSerifText>
					<SansSerifText style={tw`font-normal`}>Normal weight</SansSerifText>
					<SansSerifText style={tw`font-medium`}>Medium weight</SansSerifText>
					<SansSerifText style={tw`font-semibold`}>Semibold weight</SansSerifText>
					<SansSerifText style={tw`font-bold`}>Bold weight</SansSerifText>
				</View>
			</Section>
		</View>
	)
}

export const sansSerifTextShowcase: Showcase = {
	title: "SansSerifText",
	component: SansSerifTextShowcase,
}
