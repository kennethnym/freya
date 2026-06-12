import { View } from "react-native"
import tw from "twrnc"

import { SansSerifText } from "./ui/sans-serif-text"

export type Showcase = {
	title: string
	component: React.ComponentType
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<View style={tw`gap-3`}>
			<SansSerifText style={tw`text-sm text-stone-500 dark:text-stone-400`}>{title}</SansSerifText>
			{children}
		</View>
	)
}
