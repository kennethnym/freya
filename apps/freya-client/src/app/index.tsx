import { BlurView } from "expo-blur"
import { GlassView } from "expo-glass-effect"
import { Link } from "expo-router"
import { Pressable, View, Text, TextInput } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import tw from "twrnc"

import { Button } from "@/components/ui/button"
import { FeedCard } from "@/components/ui/feed-card"
import { MonospaceText } from "@/components/ui/monospace-text"
import { SansSerifText } from "@/components/ui/sans-serif-text"
import { SerifText } from "@/components/ui/serif-text"

export default function HomeScreen() {
	return (
		<SafeAreaView
			style={tw`bg-stone-100 dark:bg-stone-900 flex-1 px-5 pt-6 gap-4 relative dark:text-stone-100`}
		>
			<FeedCard>
				<SerifText style={tw`text-4xl`}>Hello world asdsadsa</SerifText>
				<SansSerifText style={tw`text-4xl font-bold`}>Hello world</SansSerifText>
				<MonospaceText style={tw`text-4xl`}>asdjsakljdl</MonospaceText>
				<Button style={tw`self-start`} label="Test" />
			</FeedCard>
			<Link href="/components" asChild>
				<Pressable>
					<SansSerifText style={tw`text-teal-600`}>View component library</SansSerifText>
				</Pressable>
			</Link>
			<View style={tw`absolute bottom-10 left-0 right-0 px-3`}>
				<BlurView
					style={tw`flex flex-row w-full py-2 pl-4 pr-2 bg-stone-800 border border-stone-700 rounded-full overflow-hidden`}
				>
					<TextInput
						style={tw`text-stone-300 dark:text-stone-200 flex-1`}
						placeholder="Message Freya..."
					/>
					<Button style={tw`size-8 p-0`} leadingIcon={<Button.Icon name="arrow-up" />} />
				</BlurView>
			</View>
		</SafeAreaView>
	)
}
