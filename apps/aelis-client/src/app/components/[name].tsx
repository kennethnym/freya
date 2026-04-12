import { useLocalSearchParams, useNavigation } from "expo-router"
import { useEffect } from "react"
import { ScrollView, View } from "react-native"
import tw from "twrnc"

import { type Showcase } from "@/components/showcase"
import { buttonShowcase } from "@/components/ui/button.showcase"
import { feedCardShowcase } from "@/components/ui/feed-card.showcase"
import { monospaceTextShowcase } from "@/components/ui/monospace-text.showcase"
import { SansSerifText } from "@/components/ui/sans-serif-text"
import { sansSerifTextShowcase } from "@/components/ui/sans-serif-text.showcase"
import { serifTextShowcase } from "@/components/ui/serif-text.showcase"

const showcases: Record<string, Showcase> = {
	button: buttonShowcase,
	"feed-card": feedCardShowcase,
	"serif-text": serifTextShowcase,
	"sans-serif-text": sansSerifTextShowcase,
	"monospace-text": monospaceTextShowcase,
}

export default function ComponentDetailScreen() {
	const { name } = useLocalSearchParams<{ name: string }>()
	const navigation = useNavigation()
	const showcase = showcases[name]

	useEffect(() => {
		if (showcase) {
			navigation.setOptions({ title: showcase.title })
		}
	}, [navigation, showcase])

	if (!showcase) {
		return (
			<View style={tw`bg-stone-100 dark:bg-stone-900 flex-1 items-center justify-center`}>
				<SansSerifText>Component not found</SansSerifText>
			</View>
		)
	}

	const ShowcaseComponent = showcase.component

	return (
		<ScrollView
			style={tw`bg-stone-100 dark:bg-stone-900 flex-1`}
			contentContainerStyle={tw`px-5 pb-10 pt-4 gap-6`}
		>
			<ShowcaseComponent />
		</ScrollView>
	)
}
