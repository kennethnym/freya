export interface ServerEnv {
	betterAuthSecret: string
	credentialEncryptionKey: string
	databaseUrl: string
	exaApiKey: string
	googleMapsApiKey: string
	openrouterApiKey: string
	tflApiKey: string
	weatherkitKeyId: string
	weatherkitPrivateKey: string
	weatherkitServiceId: string
	weatherkitTeamId: string
}

export function ensureEnv(env: Record<string, string | undefined>): ServerEnv {
	const missing: string[] = []

	const betterAuthSecret = readRequiredEnv(env, "BETTER_AUTH_SECRET", missing)
	const credentialEncryptionKey = readRequiredEnv(env, "CREDENTIAL_ENCRYPTION_KEY", missing)
	const databaseUrl = readRequiredEnv(env, "DATABASE_URL", missing)
	const exaApiKey = readRequiredEnv(env, "EXA_API_KEY", missing)
	const openrouterApiKey = readRequiredEnv(env, "OPENROUTER_API_KEY", missing)
	const tflApiKey = readRequiredEnv(env, "TFL_API_KEY", missing)
	const weatherkitPrivateKey = readRequiredEnv(env, "WEATHERKIT_PRIVATE_KEY", missing)
	const weatherkitKeyId = readRequiredEnv(env, "WEATHERKIT_KEY_ID", missing)
	const weatherkitTeamId = readRequiredEnv(env, "WEATHERKIT_TEAM_ID", missing)
	const weatherkitServiceId = readRequiredEnv(env, "WEATHERKIT_SERVICE_ID", missing)
	const googleMapsApiKey = readRequiredEnv(env, "GOOGLE_MAPS_API_KEY", missing)

	if (missing.length > 0) {
		throw new Error(`Missing required environment variables: ${missing.join(", ")}`)
	}

	return {
		betterAuthSecret,
		credentialEncryptionKey,
		databaseUrl,
		exaApiKey,
		googleMapsApiKey,
		openrouterApiKey,
		tflApiKey,
		weatherkitKeyId,
		weatherkitPrivateKey,
		weatherkitServiceId,
		weatherkitTeamId,
	}
}

function readRequiredEnv(
	env: Record<string, string | undefined>,
	name: string,
	missing: string[],
): string {
	const value = readOptionalEnv(env, name)
	if (!value) {
		missing.push(name)
	}
	return value ?? ""
}

function readOptionalEnv(
	env: Record<string, string | undefined>,
	name: string,
): string | undefined {
	const value = env[name]?.trim()
	return value ? value : undefined
}
