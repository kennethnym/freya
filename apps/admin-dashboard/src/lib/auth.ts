import { getServerUrl } from "./server-url"

function authBase() {
	return `${getServerUrl()}/api/auth`
}

export interface AuthUser {
	id: string
	name: string
	email: string
	image: string | null
}

export interface AuthSession {
	user: AuthUser
	session: { id: string; token: string }
}

export async function getSession(): Promise<AuthSession | null> {
	const res = await fetch(`${authBase()}/get-session`, {
		credentials: "include",
	})
	if (!res.ok) return null
	const data = (await res.json()) as AuthSession | null
	return data
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
	const res = await fetch(`${authBase()}/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({ email, password }),
	})
	if (!res.ok) {
		const data = (await res.json()) as { message?: string }
		throw new Error(data.message ?? `Sign in failed: ${res.status}`)
	}
	return (await res.json()) as AuthSession
}

export async function signOut(): Promise<void> {
	await fetch(`${authBase()}/sign-out`, {
		method: "POST",
		credentials: "include",
	})
}
