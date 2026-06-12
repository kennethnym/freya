import { Link } from "expo-router"
import { Pressable } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import tw from "twrnc"

import { Button } from "@/components/ui/button"
import { FeedCard } from "@/components/ui/feed-card"
import { MonospaceText } from "@/components/ui/monospace-text"
import { SansSerifText } from "@/components/ui/sans-serif-text"
import { SerifText } from "@/components/ui/serif-text"

export default function HomeScreen() {
	return (
		<SafeAreaView style={tw`bg-stone-100 dark:bg-stone-900 flex-1 px-5 pt-6 gap-4`}>
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
		</SafeAreaView>
	)
}
