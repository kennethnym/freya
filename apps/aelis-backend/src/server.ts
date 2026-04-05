import { Hono } from "hono"
import { cors } from "hono/cors"

import { registerAdminHttpHandlers } from "./admin/http.ts"
import { createRequireAdmin } from "./auth/admin-middleware.ts"
import { registerAuthHandlers } from "./auth/http.ts"
import { createAuth } from "./auth/index.ts"
import { createRequireSession } from "./auth/session-middleware.ts"
import { createDatabase } from "./db/index.ts"
import { registerFeedHttpHandlers } from "./engine/http.ts"
import { createFeedEnhancer } from "./enhancement/enhance-feed.ts"
import { createLlmClient } from "./enhancement/llm-client.ts"
import { CredentialEncryptor } from "./lib/crypto.ts"
import { registerLocationHttpHandlers } from "./location/http.ts"
import { LocationSourceProvider } from "./location/provider.ts"
import { UserSessionManager } from "./session/index.ts"
import { registerSourcesHttpHandlers } from "./sources/http.ts"
import { TflSourceProvider } from "./tfl/provider.ts"
import { WeatherSourceProvider } from "./weather/provider.ts"

function main() {
	const { db, close: closeDb } = createDatabase(process.env.DATABASE_URL!)
	const auth = createAuth(db)

	const openrouterApiKey = process.env.OPENROUTER_API_KEY
	const feedEnhancer = openrouterApiKey
		? createFeedEnhancer({
				client: createLlmClient({
					apiKey: openrouterApiKey,
					model: process.env.OPENROUTER_MODEL || undefined,
				}),
			})
		: null
	if (!feedEnhancer) {
		console.warn("[enhancement] OPENROUTER_API_KEY not set — feed enhancement disabled")
	}

	const credentialEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
	const credentialEncryptor = credentialEncryptionKey
		? new CredentialEncryptor(credentialEncryptionKey)
		: null
	if (!credentialEncryptor) {
		console.warn(
			"[credentials] CREDENTIAL_ENCRYPTION_KEY not set — per-user credential storage disabled",
		)
	}

	const sessionManager = new UserSessionManager({
		db,
		providers: [
			new LocationSourceProvider(),
			new WeatherSourceProvider({
				credentials: {
					privateKey: process.env.WEATHERKIT_PRIVATE_KEY!,
					keyId: process.env.WEATHERKIT_KEY_ID!,
					teamId: process.env.WEATHERKIT_TEAM_ID!,
					serviceId: process.env.WEATHERKIT_SERVICE_ID!,
				},
			}),
			new TflSourceProvider({ apiKey: process.env.TFL_API_KEY! }),
		],
		feedEnhancer,
		credentialEncryptor,
	})

	const app = new Hono()

	const isDev = process.env.NODE_ENV !== "production"
	const allowedOrigins = process.env.CORS_ORIGINS?.split(",").map((o) => o.trim()) ?? []

	function resolveOrigin(origin: string): string | undefined {
		if (isDev) return origin
		return allowedOrigins.includes(origin) ? origin : undefined
	}

	app.use(
		"/api/auth/*",
		cors({
			origin: resolveOrigin,
			allowHeaders: ["Content-Type", "Authorization"],
			allowMethods: ["POST", "GET", "OPTIONS"],
			exposeHeaders: ["Content-Length"],
			maxAge: 600,
			credentials: true,
		}),
	)

	app.use(
		"*",
		cors({
			origin: resolveOrigin,
			credentials: true,
		}),
	)

	app.get("/health", (c) => c.json({ status: "ok" }))

	const authSessionMiddleware = createRequireSession(auth)
	const adminMiddleware = createRequireAdmin(auth)

	registerAuthHandlers(app, auth)

	registerFeedHttpHandlers(app, {
		sessionManager,
		authSessionMiddleware,
	})
	registerLocationHttpHandlers(app, { sessionManager, authSessionMiddleware })
	registerSourcesHttpHandlers(app, { sessionManager, authSessionMiddleware })
	registerAdminHttpHandlers(app, { sessionManager, adminMiddleware, db })

	process.on("SIGTERM", async () => {
		await closeDb()
		process.exit(0)
	})

	return app
}

const app = main()

export default {
	port: 3000,
	fetch: app.fetch,
}
