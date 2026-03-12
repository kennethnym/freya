import "react-native-reanimated"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useColorScheme } from "react-native"
import tw, { useDeviceContext } from "twrnc"

export default function RootLayout() {
	useDeviceContext(tw)
	const colorScheme = useColorScheme()
	const headerBg = colorScheme === "dark" ? "#1c1917" : "#f5f5f4"
	const headerTint = colorScheme === "dark" ? "#e7e5e4" : "#1c1917"

	return (
		<>
			<Stack
				screenOptions={{
					headerShown: false,
					contentStyle: { backgroundColor: headerBg },
				}}
			>
				<Stack.Screen
					name="components/index"
					options={{
						headerShown: true,
						title: "Components",
						headerStyle: { backgroundColor: headerBg },
						headerTintColor: headerTint,
						headerShadowVisible: false,
					}}
				/>
				<Stack.Screen
					name="components/[name]"
					options={{
						headerShown: true,
						title: "",
						headerStyle: { backgroundColor: headerBg },
						headerTintColor: headerTint,
						headerShadowVisible: false,
					}}
				/>
			</Stack>
			<StatusBar style="auto" />
		</>
	)
}
