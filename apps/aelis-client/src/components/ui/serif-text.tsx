import { Text, type TextProps } from "react-native"
import tw from "twrnc"

export function SerifText({ children, style, ...props }: TextProps) {
	return (
		<Text style={[tw`text-stone-800 dark:text-stone-200`, { fontFamily: "Source Serif 4" }, style]} {...props}>
			{children}
		</Text>
	)
}
