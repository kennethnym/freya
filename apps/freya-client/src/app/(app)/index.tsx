import { Link } from "expo-router"
import { Pressable, ScrollView, View } from "react-native"
import tw from "twrnc"

import { FeedCard } from "@/components/ui/feed-card"
import { MonospaceText } from "@/components/ui/monospace-text"
import { SansSerifText } from "@/components/ui/sans-serif-text"
import { SerifText } from "@/components/ui/serif-text"
import { ChatOverlay } from "@/conversations/chat-overlay"

export default function HomeScreen() {
	return (
		<View style={tw`bg-stone-100 dark:bg-stone-950 flex-1 relative`}>
			<ScrollView
				contentContainerStyle={tw`px-5 pt-6 pb-28 gap-3 justify-end flex-grow`}
				showsVerticalScrollIndicator={false}
			>
				<FeedCard style={tw`bg-white dark:bg-stone-900 p-4 gap-3`}>
					<View style={tw`flex-row items-center justify-between gap-3`}>
						<SansSerifText style={tw`text-xs text-stone-500 dark:text-stone-400 uppercase`}>
							Morning brief
						</SansSerifText>
						<MonospaceText style={tw`text-xs text-teal-700 dark:text-teal-300`}>
							08:42
						</MonospaceText>
					</View>
					<SerifText style={tw`text-3xl leading-9`}>
						A calm start with two useful windows.
					</SerifText>
					<SansSerifText style={tw`text-base leading-6 text-stone-600 dark:text-stone-300`}>
						Your morning is light until the project sync. Rain holds off until late afternoon, and
						your last note suggests starting with the proposal outline.
					</SansSerifText>
					<View style={tw`flex-row flex-wrap gap-2`}>
						<View style={tw`rounded-full bg-teal-50 dark:bg-teal-950 px-3 py-1`}>
							<SansSerifText style={tw`text-xs text-teal-700 dark:text-teal-200`}>
								90 min focus
							</SansSerifText>
						</View>
						<View style={tw`rounded-full bg-stone-100 dark:bg-stone-800 px-3 py-1`}>
							<SansSerifText style={tw`text-xs text-stone-600 dark:text-stone-300`}>
								2 reminders
							</SansSerifText>
						</View>
						<View style={tw`rounded-full bg-stone-100 dark:bg-stone-800 px-3 py-1`}>
							<SansSerifText style={tw`text-xs text-stone-600 dark:text-stone-300`}>
								Low email volume
							</SansSerifText>
						</View>
					</View>
				</FeedCard>

				<FeedCard style={tw`bg-white dark:bg-stone-900 p-4 gap-4`}>
					<View style={tw`flex-row items-baseline justify-between gap-3`}>
						<SerifText style={tw`text-2xl`}>Next up</SerifText>
						<SansSerifText style={tw`text-xs text-stone-500 dark:text-stone-400`}>
							Today
						</SansSerifText>
					</View>
					<View style={tw`gap-3`}>
						<View style={tw`flex-row gap-3`}>
							<MonospaceText style={tw`w-14 text-xs text-stone-500 dark:text-stone-400`}>
								09:30
							</MonospaceText>
							<View style={tw`flex-1 gap-1`}>
								<SansSerifText style={tw`font-semibold`}>Project sync prep</SansSerifText>
								<SansSerifText style={tw`text-sm leading-5 text-stone-600 dark:text-stone-300`}>
									Three notes from yesterday are ready to skim.
								</SansSerifText>
							</View>
						</View>
						<View style={tw`h-px bg-stone-200 dark:bg-stone-800`} />
						<View style={tw`flex-row gap-3`}>
							<MonospaceText style={tw`w-14 text-xs text-stone-500 dark:text-stone-400`}>
								11:00
							</MonospaceText>
							<View style={tw`flex-1 gap-1`}>
								<SansSerifText style={tw`font-semibold`}>Quiet work block</SansSerifText>
								<SansSerifText style={tw`text-sm leading-5 text-stone-600 dark:text-stone-300`}>
									Best slot for the proposal before the day gets busy.
								</SansSerifText>
							</View>
						</View>
					</View>
				</FeedCard>

				<FeedCard style={tw`bg-white dark:bg-stone-900 p-4 gap-3`}>
					<View style={tw`flex-row items-center justify-between gap-3`}>
						<SerifText style={tw`text-2xl`}>Personal radar</SerifText>
						<MonospaceText style={tw`text-xs text-stone-500 dark:text-stone-400`}>
							4 signals
						</MonospaceText>
					</View>
					<View style={tw`gap-2.5`}>
						<View style={tw`flex-row gap-2.5`}>
							<View style={tw`mt-1.5 size-2 rounded-full bg-teal-500`} />
							<SansSerifText
								style={tw`flex-1 text-sm leading-5 text-stone-600 dark:text-stone-300`}
							>
								Package is likely to arrive before 2 PM.
							</SansSerifText>
						</View>
						<View style={tw`flex-row gap-2.5`}>
							<View style={tw`mt-1.5 size-2 rounded-full bg-amber-500`} />
							<SansSerifText
								style={tw`flex-1 text-sm leading-5 text-stone-600 dark:text-stone-300`}
							>
								Energy prices dip again after midnight.
							</SansSerifText>
						</View>
						<View style={tw`flex-row gap-2.5`}>
							<View style={tw`mt-1.5 size-2 rounded-full bg-sky-500`} />
							<SansSerifText
								style={tw`flex-1 text-sm leading-5 text-stone-600 dark:text-stone-300`}
							>
								A recipe you saved matches what is in the fridge.
							</SansSerifText>
						</View>
					</View>
				</FeedCard>

				<Link href="/components" asChild>
					<Pressable style={tw`self-start px-1 py-1`}>
						<SansSerifText style={tw`text-sm text-teal-700 dark:text-teal-300`}>
							View component library
						</SansSerifText>
					</Pressable>
				</Link>
			</ScrollView>

			<ChatOverlay />
		</View>
	)
}
