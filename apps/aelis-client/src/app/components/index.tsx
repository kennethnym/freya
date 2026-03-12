import { Link } from "expo-router"
import { FlatList, Pressable, View } from "react-native"
import tw from "twrnc"

import { SansSerifText } from "@/components/ui/sans-serif-text"

const components = [
	{ name: "button", label: "Button" },
	{ name: "feed-card", label: "FeedCard" },
	{ name: "serif-text", label: "SerifText" },
	{ name: "sans-serif-text", label: "SansSerifText" },
	{ name: "monospace-text", label: "MonospaceText" },
] as const

export default function ComponentsScreen() {
	return (
		<View style={tw`flex-1`}>
			<View style={tw`mx-4 mt-4 rounded-xl border border-stone-200 dark:border-stone-800 overflow-hidden`}>
				<FlatList
					data={components}
					keyExtractor={(item) => item.name}
					scrollEnabled={false}
					ItemSeparatorComponent={() => (
						<View style={tw`border-b border-stone-200 dark:border-stone-800`} />
					)}
					renderItem={({ item }) => (
						<Link href={`/components/${item.name}`} asChild>
							<Pressable style={tw`px-4 py-3`}>
								<SansSerifText style={tw`text-base`}>{item.label}</SansSerifText>
							</Pressable>
						</Link>
					)}
				/>
			</View>
		</View>
	)
}
