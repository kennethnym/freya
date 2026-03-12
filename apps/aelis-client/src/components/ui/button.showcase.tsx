import Feather from "@expo/vector-icons/Feather"
import { View } from "react-native"
import tw from "twrnc"

import { Button } from "./button"
import { type Showcase, Section } from "../showcase"

function ButtonShowcase() {
	return (
		<View style={tw`gap-6`}>
			<Section title="Default">
				<Button style={tw`self-start`} label="Press me" />
			</Section>
			<Section title="Leading icon">
				<Button
					style={tw`self-start`}
					label="Add item"
					leadingIcon={<Feather name="plus" size={18} color="#e7e5e4" />}
				/>
			</Section>
			<Section title="Trailing icon">
				<Button
					style={tw`self-start`}
					label="Next"
					trailingIcon={<Feather name="arrow-right" size={18} color="#e7e5e4" />}
				/>
			</Section>
			<Section title="Both icons">
				<Button
					style={tw`self-start`}
					label="Download"
					leadingIcon={<Feather name="download" size={18} color="#e7e5e4" />}
					trailingIcon={<Feather name="chevron-down" size={18} color="#e7e5e4" />}
				/>
			</Section>
		</View>
	)
}

export const buttonShowcase: Showcase = {
	title: "Button",
	component: ButtonShowcase,
}
