import Feather from "@expo/vector-icons/Feather"
import { createContext, useContext } from "react"
import {
	type PressableProps,
	Pressable,
	type TextStyle,
	useColorScheme,
	ActivityIndicator,
} from "react-native"
import tw from "twrnc"

import { rva, type RvaProps } from "@/lib/rva"

import { SansSerifText } from "./sans-serif-text"

type FeatherIconName = React.ComponentProps<typeof Feather>["name"]

const button = rva(
	tw.style("rounded-2xl px-4 py-3 w-fit flex-row items-center justify-center gap-1.5 h-10", {
		borderCurve: "continuous",
	}),
	{
		variants: {
			intent: {
				primary: tw`bg-teal-600`,
				secondary: tw`bg-stone-100 dark:bg-stone-800`,
			},
			pressed: {
				true: tw`translate-y-px`,
				false: null,
			},
			enabled: {
				true: null,
				false: tw`opacity-50`,
			},
			dark: {
				true: null,
				false: null,
			},
		},
		defaultVariants: {
			intent: "primary",
			pressed: false,
			enabled: true,
			dark: false,
		},
		compoundVariants: [
			// primary variants
			{
				intent: "primary",
				enabled: true,
				pressed: false,
				style: {
					boxShadow:
						"inset 0 1px 0 0 #2dd4bf66, inset 0 -1px 0 0 #0f766eb3, 0 2px 4px 0 #0000001a, 0 0 0 1px #0f766e",
				},
			},
			{
				intent: "primary",
				enabled: true,
				pressed: true,
				style: tw.style("bg-teal-700", {
					boxShadow:
						"inset 0 1px 2px 0 #042f2e80, inset 0 0 0 1px #0f766e, inset 0 -1px 0 0 #2dd4bf26",
				}),
			},

			// secondary variants
			{
				intent: "secondary",
				dark: false,
				enabled: true,
				pressed: false,
				style: {
					boxShadow: "inset 0 1px 0 0 #fdfdfd, 0 2px 4px 0 #0000001a, 0 0 0 1px #00000029",
				},
			},
			{
				intent: "secondary",
				dark: false,
				enabled: true,
				pressed: true,
				style: tw.style("bg-stone-200", {
					boxShadow:
						"inset 0 1px 2px 0 #0000001f, inset 0 0 0 1px #00000012, inset 0 -1px 0 0 #ffffff80",
				}),
			},

			{
				intent: "secondary",
				dark: true,
				enabled: true,
				pressed: false,
				style: tw.style("bg-stone-800", {
					boxShadow:
						"inset 0 1px 0 0 #4b4951, inset 0 -1px 0 0 #313036, 0 2px 4px 0 #0000001a, 0 0 0 1px #0d0d0d",
				}),
			},
			{
				intent: "secondary",
				dark: true,
				enabled: true,
				pressed: true,
				style: tw.style("bg-stone-900", {
					boxShadow:
						"inset 0 1px 2px 0 #00000080, inset 0 0 0 1px #00000066, inset 0 -1px 0 0 #ffffff0a",
				}),
			},
		],
	},
)

const label = rva<TextStyle>(
	{},
	{
		variants: {
			intent: {
				primary: tw`text-stone-100 dark:text-stone-200 font-medium`,
				secondary: tw`text-stone-800 dark:text-stone-200 font-medium`,
			},
		},
	},
)

type ButtonVariants = Omit<RvaProps<typeof button>, "dark" | "pressed">
type ButtonProps = PressableProps & ButtonVariants

interface ButtonContext extends ButtonVariants {}

const Context = createContext<ButtonContext>({})

export function Button({ style, intent = "primary", enabled = true, ...props }: ButtonProps) {
	const theme = useColorScheme()

	return (
		<Context value={{ enabled, intent }}>
			<Pressable
				style={(state) => [
					button({
						intent,
						enabled,
						pressed: state.pressed,
						dark: theme === "dark",
					}),
					typeof style === "function" ? style(state) : style,
				]}
				{...props}
			/>
		</Context>
	)
}

type ButtonIconProps = {
	name: FeatherIconName
}

function ButtonIcon({ name }: ButtonIconProps) {
	const context = useContext(Context)

	let color: string
	switch (context.intent) {
		case "primary":
			color = tw.color("text-stone-100 dark:text-stone-200") ?? ""
			break
		case "secondary":
			color = tw.color("text-stone-800 dark:text-stone-200") ?? ""
			break
		default:
			color = ""
			break
	}

	return <Feather name={name} size={18} color={color} />
}

type ButtonLabelProps = React.ComponentProps<typeof SansSerifText>

function ButtonLabel({ style, ...props }: ButtonLabelProps) {
	const context = useContext(Context)
	return (
		<SansSerifText
			style={[
				label({
					intent: context.intent,
				}),
				style,
			]}
			{...props}
		/>
	)
}

function ButtonLoadingIndicator() {
	const context = useContext(Context)

	let color: string
	switch (context.intent) {
		case "primary":
			color = tw.color("text-stone-100 dark:text-stone-200") ?? ""
			break
		case "secondary":
			color = tw.color("text-stone-800 dark:text-stone-200") ?? ""
			break
		default:
			color = ""
			break
	}

	return <ActivityIndicator color={color} />
}

Button.Icon = ButtonIcon
Button.Label = ButtonLabel
Button.Loading = ButtonLoadingIndicator
