import "react-native-reanimated"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import React from "react"
import { useColorScheme } from "react-native"
import tw, { useDeviceContext } from "twrnc"

import { authMiddleware } from "@/api/auth-middleware"
import { ApiClient, ApiClientContext } from "@/api/client"

const queryClient = new QueryClient()
const apiClient = new ApiClient({
	baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
	middlewares: [authMiddleware],
})

export default function RootLayout() {
	useDeviceContext(tw)

	const colorScheme = useColorScheme()
	const headerBg = colorScheme === "dark" ? "#1c1917" : "#f5f5f4"
	const headerTint = colorScheme === "dark" ? "#e7e5e4" : "#1c1917"

	return (
		<ContextProvider>
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
		</ContextProvider>
	)
}

function ContextProvider({ children }: React.PropsWithChildren) {
	return (
		<QueryClientProvider client={queryClient}>
			<ApiClientContext value={apiClient}>{children}</ApiClientContext>
		</QueryClientProvider>
	)
}
