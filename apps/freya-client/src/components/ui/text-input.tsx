import { TextInput as NativeTextInput, type TextInputProps } from "react-native"
import tw from "twrnc"

export function TextInput({ style, ...props }: TextInputProps) {
	return <NativeTextInput style={[tw`text-stone-800 dark:text-stone-200`, style]} {...props} />
}
