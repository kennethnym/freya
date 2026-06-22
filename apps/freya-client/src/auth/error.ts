import type { auth } from "./auth"

export class InvalidCredentialsError extends Error {
	constructor(cause: unknown) {
		super(`Invalid credentials: ${cause}`)
	}
}

export class BetterAuthError extends Error {
	// the type is copied from the shape of result.error from authClient.signIn.email
	constructor(error: {
		code?: string | undefined
		message?: string | undefined
		status: number
		statusText: string
	}) {
		super(`${error.message ?? "BetterAuthError"}: ${error.status} ${error.statusText}`)
	}
}

type BetterAuthErrorTypes = Partial<Record<keyof typeof auth.$ERROR_CODES, string>>

export const AuthErrorCode = {
	INVALID_EMAIL: "INVALID_EMAIL",
	INVALID_PASSWORD: "INVALID_PASSWORD",
	INVALID_EMAIL_OR_PASSWORD: "INVALID_EMAIL_OR_PASSWORD",
} satisfies BetterAuthErrorTypes
