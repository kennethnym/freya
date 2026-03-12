import { type PressableProps, Pressable, View } from "react-native"
import tw from "twrnc"

import { SansSerifText } from "./sans-serif-text"

type ButtonProps = Omit<PressableProps, "children"> & {
	label: string
	leadingIcon?: React.ReactNode
	trailingIcon?: React.ReactNode
}

export function Button({ style, label, leadingIcon, trailingIcon, ...props }: ButtonProps) {
	const hasIcons = leadingIcon != null || trailingIcon != null

	const textElement = <SansSerifText style={tw`text-stone-200 font-medium`}>{label}</SansSerifText>

	return (
		<Pressable style={[tw`rounded-full bg-teal-600 px-4 py-3 w-fit`, style]} {...props}>
			{hasIcons ? (
				<View style={tw`flex-row items-center gap-1.5`}>
					{leadingIcon}
					{textElement}
					{trailingIcon}
				</View>
			) : (
				textElement
			)}
		</Pressable>
	)
}
