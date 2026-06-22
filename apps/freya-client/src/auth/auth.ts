import { expoClient } from "@better-auth/expo/client"
import { mutationOptions } from "@tanstack/react-query"
import { createAuthClient } from "better-auth/react"
import * as SecureStore from "expo-secure-store"

import type { ApiRequestMiddleware } from "../api/client"

import { BetterAuthError, InvalidCredentialsError } from "./error"

export const auth = createAuthClient({
	baseURL: process.env.EXPO_PUBLIC_SERVER_URL,
	plugins: [
		expoClient({
			scheme: "freya",
			storagePrefix: "chat.freya",
			storage: SecureStore,
		}),
	],
})

export const authMiddleware: ApiRequestMiddleware = (_url, init) => {
	const cookie = auth.getCookie()
	const headers = new Headers(init.headers)
	if (cookie) {
		headers.set("Cookie", cookie)
	}
	return {
		...init,
		credentials: "omit",
		headers,
	}
}

export const signInMutation = mutationOptions({
	mutationFn: async ({ email, password }: { email: string; password: string }) => {
		if (email && password) {
			const result = await auth.signIn.email({
				email,
				password,
			})
			if (result.error?.code) {
				switch (result.error.code) {
					case "INVALID_EMAIL":
						throw new InvalidCredentialsError("Invalid email")
					case "INVALID_PASSWORD":
						throw new InvalidCredentialsError("Invalid password")
					case "INVALID_EMAIL_OR_PASSWORD":
						throw new InvalidCredentialsError("Invalid email or password")
					default:
						throw new BetterAuthError(result.error)
				}
			}
			return result
		}
		return null
	},
})
