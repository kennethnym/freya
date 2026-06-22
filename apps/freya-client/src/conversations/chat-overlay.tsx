/* eslint-disable react-hooks/immutability */
import MaskedView from "@react-native-masked-view/masked-view"
import { BlurView } from "expo-blur"
import { LinearGradient } from "expo-linear-gradient"
import { atom, useAtomValue, useSetAtom, useStore } from "jotai"
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react"
import { useColorScheme, View, StyleSheet, Platform, Dimensions } from "react-native"
import { easeGradient } from "react-native-easing-gradient"
import { useKeyboardHandler } from "react-native-keyboard-controller"
import Animated, { FadeIn, FadeOut, useSharedValue, withSpring } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import tw from "twrnc"

import { Button } from "@/components/ui/button"
import { TextInput } from "@/components/ui/text-input"

import { ConversationList } from "./conversation-list"

interface BottomProgressiveBlurRef {
	setBlurHeight: (height: number) => void
}

interface ConversationListContainerRef {
	showFullChat: () => void
}

const ChatViewMode = {
	Hidden: "hidden",
	Peek: "peek",
	FullChat: "full-chat",
} as const
type ChatViewMode = (typeof ChatViewMode)[keyof typeof ChatViewMode]

const chatInputHeightAtom = atom(0)
const isChatInputFocusedAtom = atom(false)
const chatViewModeAtom = atom<ChatViewMode>(ChatViewMode.Hidden)

export function ChatOverlay() {
	const theme = useColorScheme()
	const setChatInputHeight = useSetAtom(chatInputHeightAtom)
	const setIsChatInputFocused = useSetAtom(isChatInputFocusedAtom)
	const setChatViewMode = useSetAtom(chatViewModeAtom)
	const store = useStore()

	const conversationListContainerRef = useRef<ConversationListContainerRef>(null)

	const onTextInputFocus = () => {
		setChatViewMode(ChatViewMode.Peek)
	}

	const onConversationListScroll = () => {
		if (store.get(chatViewModeAtom) !== ChatViewMode.FullChat) {
			setChatViewMode(ChatViewMode.FullChat)
			conversationListContainerRef?.current?.showFullChat()
		}
	}

	return (
		<ChatOverlayContainer>
			<OverlayBackdrop />

			<ConversationListContainer ref={conversationListContainerRef}>
				<ConversationList
					ListHeaderComponent={ConversationListHeader}
					ListFooterComponent={ConversationListFooter}
					onScrollBeginDrag={onConversationListScroll}
				/>
			</ConversationListContainer>

			<ChatInputContainer>
				<BlurView
					onLayout={({ nativeEvent: { layout } }) => {
						setChatInputHeight(layout.height)
					}}
					intensity={35}
					tint={theme === "dark" ? "systemThickMaterialDark" : "systemThickMaterialLight"}
					style={tw`flex flex-row w-full py-1 pl-4 pr-1 border border-stone-300 dark:border-stone-700 rounded-full overflow-hidden`}
				>
					<TextInput
						onFocus={onTextInputFocus}
						onBlur={() => {
							setIsChatInputFocused(false)
						}}
						style={tw`flex-1`}
						placeholder="Message Freya..."
					/>
					<Button style={tw`size-8 p-0`}>
						<Button.Icon name="arrow-up" />
					</Button>
				</BlurView>
			</ChatInputContainer>
		</ChatOverlayContainer>
	)
}

function ChatOverlayContainer({ children }: React.PropsWithChildren) {
	const bottom = useSharedValue(0)

	useKeyboardHandler({
		onMove: (event) => {
			"worklet"
			bottom.value = event.height
		},
	})

	return (
		<Animated.View pointerEvents="box-none" style={[tw`absolute top-0 left-0 right-0`, { bottom }]}>
			{children}
		</Animated.View>
	)
}

function ConversationListContainer({
	ref,
	children,
}: React.PropsWithChildren<{ ref?: React.Ref<ConversationListContainerRef> }>) {
	const chatViewMode = useAtomValue(chatViewModeAtom)
	const height = useSharedValue(Dimensions.get("window").height * 0.4)

	const { colors, locations } = useMemo(
		() =>
			easeGradient({
				colorStops: {
					0: { color: "transparent" },
					0.1: { color: "transparent" },
					0.3: { color: tw.color("bg-stone-100 dark:bg-stone-950")! },
					0.9: { color: tw.color("bg-stone-100 dark:bg-stone-950")! },
					1: { color: tw.color("bg-stone-100 dark:bg-stone-950")! },
				},
			}),
		[],
	)

	const showFullChat = useCallback(() => {
		height.value = withSpring(Dimensions.get("window").height + 80)
	}, [height])

	useImperativeHandle(
		ref,
		() => ({
			showFullChat,
		}),
		[showFullChat],
	)

	return (
		<View pointerEvents="box-none" style={tw.style("absolute top-0 left-0 right-0 bottom-0")}>
			<MaskedView
				pointerEvents="box-none"
				maskElement={
					<Animated.View style={[tw`absolute bottom-0 right-0 left-0`, { height }]}>
						<LinearGradient
							locations={locations as any}
							colors={colors as any}
							style={tw`size-full`}
						/>
					</Animated.View>
				}
				style={tw`size-full`}
			>
				<View
					style={tw.style("size-full", chatViewMode === ChatViewMode.Hidden ? "opacity-0" : "")}
				>
					{children}
				</View>
			</MaskedView>
		</View>
	)
}

function OverlayBackdrop() {
	const chatViewMode = useAtomValue(chatViewModeAtom)
	const bottomProgressiveBlurRef = useRef<BottomProgressiveBlurRef>(null)

	useEffect(() => {
		if (chatViewMode === ChatViewMode.Peek) {
			bottomProgressiveBlurRef?.current?.setBlurHeight(Dimensions.get("window").height * 0.75)
		}
	}, [chatViewMode])

	if (chatViewMode === ChatViewMode.FullChat) {
		return <BlurBackground />
	}
	return <BottomProgressiveBlur ref={bottomProgressiveBlurRef} />
}

function BottomProgressiveBlur({ ref }: { ref?: React.Ref<BottomProgressiveBlurRef> }) {
	const progressiveBlurHeight = useSharedValue(192)
	const colorScheme = useColorScheme()

	const { colors, locations } = useMemo(
		() =>
			easeGradient({
				colorStops: {
					0: { color: "transparent" },
					0.7: { color: tw.color("bg-stone-100 dark:bg-stone-950")! },
					1: { color: tw.color("bg-stone-100 dark:bg-stone-950")! },
				},
			}),
		[],
	)

	const setBlurHeight = useCallback(
		(height: number) => {
			progressiveBlurHeight.value = withSpring(height)
		},
		[progressiveBlurHeight],
	)

	useImperativeHandle(ref, () => ({ setBlurHeight }), [setBlurHeight])

	return (
		<Animated.View
			entering={FadeIn}
			exiting={FadeOut}
			style={[tw`absolute bottom-0 left-0 right-0`, { height: progressiveBlurHeight }]}
		>
			<MaskedView
				maskElement={
					<LinearGradient
						locations={locations as any}
						colors={colors as any}
						style={tw`absolute top-0 bottom-0 left-0 right-0`}
					/>
				}
				style={[StyleSheet.absoluteFill, tw`z-[1]`]}
			>
				<BlurView
					intensity={65}
					tint={Platform.select({
						ios:
							colorScheme === "dark"
								? "systemUltraThinMaterialDark"
								: "systemUltraThinMaterialLight",
						android: "systemMaterialDark",
					})}
					style={StyleSheet.absoluteFill}
				/>
			</MaskedView>
		</Animated.View>
	)
}

function BlurBackground() {
	const colorScheme = useColorScheme()
	return (
		<Animated.View entering={FadeIn} exiting={FadeOut} style={StyleSheet.absoluteFill}>
			<BlurView
				intensity={65}
				tint={Platform.select({
					ios:
						colorScheme === "dark" ? "systemUltraThinMaterialDark" : "systemUltraThinMaterialLight",
					android: "systemMaterialDark",
				})}
				style={StyleSheet.absoluteFill}
			/>
		</Animated.View>
	)
}

function ChatInputContainer({ children }: React.PropsWithChildren) {
	const keyboardHeight = useSharedValue(0)
	const insets = useSafeAreaInsets()

	useKeyboardHandler({
		onMove: (event) => {
			"worklet"
			keyboardHeight.value = Math.max(event.height - insets.bottom + 8, 0)
		},
	})

	return <View style={tw`absolute bottom-0 left-0 right-0 px-4 pb-10`}>{children}</View>
}

function ConversationListHeader() {
	const safeAreaInsets = useSafeAreaInsets()
	return <View style={{ height: safeAreaInsets.top }} />
}

function ConversationListFooter() {
	const chatInputHeight = useAtomValue(chatInputHeightAtom)
	const safeAreaInsets = useSafeAreaInsets()
	return <View style={{ height: chatInputHeight + 24 + safeAreaInsets.bottom }} />
}
