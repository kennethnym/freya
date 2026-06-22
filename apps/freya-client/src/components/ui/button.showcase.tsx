import { View } from "react-native"
import tw from "twrnc"

import { type Showcase, Section } from "../showcase"
import { Button } from "./button"

function ButtonShowcase() {
	return (
		<View style={tw`gap-6`}>
			<Section title="Default">
				<Button style={tw`self-start`}>
					<Button.Label>Press me</Button.Label>
				</Button>
			</Section>
			<Section title="Leading icon">
				<Button style={tw`self-start`}>
					<Button.Icon name="plus" />
					<Button.Label>Add item</Button.Label>
				</Button>
			</Section>
			<Section title="Trailing icon">
				<Button style={tw`self-start`}>
					<Button.Label>Next</Button.Label>
					<Button.Icon name="arrow-right" />
				</Button>
			</Section>
			<Section title="Both icons">
				<Button style={tw`self-start`}>
					<Button.Icon name="download" />
					<Button.Label>Download</Button.Label>
					<Button.Icon name="chevron-down" />
				</Button>
			</Section>
		</View>
	)
}

export const buttonShowcase: Showcase = {
	title: "Button",
	component: ButtonShowcase,
}
