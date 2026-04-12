import { View } from "react-native"
import tw from "twrnc"

import { type Showcase, Section } from "../showcase"
import { Button } from "./button"

function ButtonShowcase() {
	return (
		<View style={tw`gap-6`}>
			<Section title="Default">
				<Button style={tw`self-start`} label="Press me" />
			</Section>
			<Section title="Leading icon">
				<Button style={tw`self-start`} label="Add item" leadingIcon={<Button.Icon name="plus" />} />
			</Section>
			<Section title="Trailing icon">
				<Button
					style={tw`self-start`}
					label="Next"
					trailingIcon={<Button.Icon name="arrow-right" />}
				/>
			</Section>
			<Section title="Both icons">
				<Button
					style={tw`self-start`}
					label="Download"
					leadingIcon={<Button.Icon name="download" />}
					trailingIcon={<Button.Icon name="chevron-down" />}
				/>
			</Section>
		</View>
	)
}

export const buttonShowcase: Showcase = {
	title: "Button",
	component: ButtonShowcase,
}
