import { Text, type TextProps } from "react-native"
import tw from "twrnc"

export function SansSerifText({ children, style, ...props }: TextProps) {
	return (
		<Text style={[tw`text-stone-800 dark:text-stone-200`, { fontFamily: "Inter" }, style]} {...props}>
			{children}
		</Text>
	)
}
