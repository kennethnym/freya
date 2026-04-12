import { View } from "react-native"
import tw from "twrnc"

import { type Showcase, Section } from "../showcase"
import { MonospaceText } from "./monospace-text"

function MonospaceTextShowcase() {
	return (
		<View style={tw`gap-6`}>
			<Section title="Sizes">
				<View style={tw`gap-2`}>
					<MonospaceText style={tw`text-sm`}>Small monospace text</MonospaceText>
					<MonospaceText style={tw`text-base`}>Base monospace text</MonospaceText>
					<MonospaceText style={tw`text-xl`}>Extra large monospace text</MonospaceText>
					<MonospaceText style={tw`text-3xl`}>3XL monospace text</MonospaceText>
				</View>
			</Section>
			<Section title="Code-like usage">
				<View style={tw`bg-stone-200 dark:bg-stone-800 rounded-lg p-3`}>
					<MonospaceText style={tw`text-sm`}>{"const x = 42;"}</MonospaceText>
					<MonospaceText style={tw`text-sm`}>{"console.log(x);"}</MonospaceText>
				</View>
			</Section>
		</View>
	)
}

export const monospaceTextShowcase: Showcase = {
	title: "MonospaceText",
	component: MonospaceTextShowcase,
}
