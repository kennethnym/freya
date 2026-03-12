import { View, type ViewProps } from "react-native"
import tw from "twrnc"

export function FeedCard({ style, ...props }: ViewProps) {
	return <View style={[tw`border border-stone-200 dark:border-stone-800 rounded-lg`, style]} {...props} />
}
