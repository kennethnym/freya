import { mutationOptions, useMutation } from "@tanstack/react-query"
import { useRouter } from "expo-router"
/* eslint-disable react-hooks/immutability */
import { useCallback, useImperativeHandle, useRef } from "react"
import { ActivityIndicator, Alert, View } from "react-native"
import { KeyboardAvoidingView, useKeyboardHandler } from "react-native-keyboard-controller"
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withDelay,
	withSpring,
} from "react-native-reanimated"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import tw from "twrnc"

import { auth, signInMutation } from "@/auth/auth"
import { InvalidCredentialsError, BetterAuthError } from "@/auth/error"
import { Button } from "@/components/ui/button"
import { SansSerifText } from "@/components/ui/sans-serif-text"
import { SerifText } from "@/components/ui/serif-text"
import { TextInput } from "@/components/ui/text-input"

export default function SignInPage() {
	console.log("sing in page ")
	const loginFormRef = useRef<LoginFormContainerRef>(null)
	const emailButtonHeight = useRef(0)

	return (
		<View style={tw`size-full relative`}>
			<SafeAreaView
				style={tw`flex-1 bg-stone-50 dark:bg-stone-900 justify-center items-start px-6`}
			>
				<View style={tw`flex-1 justify-center items-start`}>
					<SerifText style={tw`text-lg mb-1.5`}>I&apos;m Freya!</SerifText>
					<SerifText style={tw`text-lg opacity-70 leading-tight`}>
						Before I can help you with your daily routines, please sign in below.
					</SerifText>
				</View>
				<Button
					onLayout={({ nativeEvent: { layout } }) => {
						emailButtonHeight.current = layout.height
					}}
					intent="secondary"
					style={tw`w-full`}
					onPress={() => {
						loginFormRef.current?.show({
							fromHeight: emailButtonHeight.current,
						})
					}}
				>
					<Button.Label>Continue with email</Button.Label>
				</Button>
			</SafeAreaView>

			<LoginFormContainer ref={loginFormRef}>
				<LoginForm />
			</LoginFormContainer>
		</View>
	)
}

interface LoginFormContainerRef {
	show: ({ fromHeight }: { fromHeight: number }) => void
}

function LoginFormContainer({
	ref,
	children,
}: React.PropsWithChildren<{ ref?: React.Ref<LoginFormContainerRef> }>) {
	console.log("LoginFormContainer")
	const safeAreaInsets = useSafeAreaInsets()

	const opacity = useSharedValue(0)
	const contentOpacity = useSharedValue(0)
	const insetX = useSharedValue(0)
	const bottom = useSharedValue(0)
	const height = useSharedValue(0)
	const finalHeight = useRef(0)

	const show = useCallback(
		({ fromHeight }: { fromHeight: number }) => {
			insetX.value = 24
			bottom.value = safeAreaInsets.bottom
			height.value = fromHeight
			opacity.value = 1

			insetX.value = withSpring(0)
			bottom.value = withSpring(0)
			height.value = withSpring(finalHeight.current)
			contentOpacity.value = withDelay(100, withSpring(1))
		},
		[opacity, insetX, bottom, safeAreaInsets.bottom, height, contentOpacity],
	)

	useImperativeHandle(ref, () => ({ show }))

	useKeyboardHandler({
		onMove: ({ progress, height, duration }) => {
			"worklet"
			bottom.value = height
		},
	})

	const animatedStyle = useAnimatedStyle(() => ({
		height: opacity.value !== 0 ? height.value : undefined,
		opacity: opacity.value,
		left: insetX.value,
		right: insetX.value,
		bottom: bottom.value,
	}))

	return (
		<Animated.View
			onLayout={({ nativeEvent: { layout } }) => {
				finalHeight.current = layout.height
			}}
			style={[
				tw`absolute overflow-hidden border border-stone-200 dark:border-stone-700 rounded-2xl`,
				animatedStyle,
			]}
		>
			<KeyboardAvoidingView behavior="padding">
				<SafeAreaView
					edges={["bottom"]}
					style={tw`px-4 bg-stone-100 dark:bg-stone-800 overflow-hidden`}
				>
					<Animated.View style={[tw`w-full`, { opacity: contentOpacity }]}>
						{children}
					</Animated.View>
				</SafeAreaView>
			</KeyboardAvoidingView>
		</Animated.View>
	)
}

function LoginForm() {
	console.log("LoginForm")
	const emailRef = useRef("")
	const passwordRef = useRef("")
	const router = useRouter()

	const { mutate: signIn, isPending: isSigningIn } = useMutation(
		mutationOptions({
			...signInMutation,
			onSuccess: (data) => {
				if (data) {
					router.replace("/")
				} else {
					// if no data is returned, nothing was done, so do nothing
				}
			},
			onError: (error) => {
				console.log(error)
				if (error instanceof InvalidCredentialsError) {
					Alert.alert("Failed to sign in", "Incorrect email or password")
				} else if (error instanceof BetterAuthError) {
					Alert.alert(
						"Failed to sign in",
						"This is a fault on Freya's end. Please try again later.",
					)
				} else {
					Alert.alert(
						"Unable to connect to Freya",
						"Please check your internet connection and try again.",
					)
				}
			},
		}),
	)

	const handleSignInButtonPress = () => {
		signIn({
			email: emailRef.current,
			password: passwordRef.current,
		})
	}

	return (
		<View style={[tw`w-full py-4`]}>
			<View style={tw`flex flex-row w-full`}>
				<View>
					<View style={tw`h-8 justify-center mr-4`}>
						<SansSerifText>Email</SansSerifText>
					</View>
					<View style={tw`my-1 h-px w-full bg-stone-200 dark:bg-stone-700 rounded-l-full`} />
					<View style={tw`h-8 justify-center mr-4`}>
						<SansSerifText>Password</SansSerifText>
					</View>
				</View>
				<View style={tw`flex-1`}>
					<TextInput
						defaultValue=""
						autoCapitalize="none"
						keyboardType="email-address"
						style={tw`w-full h-8 font-medium`}
						onChangeText={(text) => {
							emailRef.current = text
						}}
					/>
					<View style={tw`my-1 h-px w-full bg-stone-200 dark:bg-stone-700 rounded-r-full`} />
					<TextInput
						defaultValue=""
						secureTextEntry
						style={tw`w-full h-8 font-medium`}
						onChangeText={(text) => {
							passwordRef.current = text
						}}
					/>
				</View>
			</View>
			<Button
				intent="primary"
				style={tw`w-full mt-6`}
				onPress={handleSignInButtonPress}
				enabled={!isSigningIn}
			>
				{isSigningIn ? <Button.Loading /> : <Button.Label>Sign in</Button.Label>}
			</Button>
		</View>
	)
}
