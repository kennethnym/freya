import { Hono } from "hono"
import { cors } from "hono/cors"
import { createMiddleware } from "hono/factory"

import { registerAdminHttpHandlers } from "./admin/http.ts"
import { createQueryDebugTools } from "./agent/debug-tools.ts"
import { registerAgentHttpHandlers, registerDebugAgentHttpHandlers } from "./agent/http.ts"
import { AgentService } from "./agent/service.ts"
import { agentWebSocket, registerAgentWebSocketHandlers } from "./agent/ws.ts"
import { createRequireAdmin } from "./auth/admin-middleware.ts"
import { registerAuthHandlers } from "./auth/http.ts"
import { createAuth } from "./auth/index.ts"
import { createRequireSession } from "./auth/session-middleware.ts"
import { CalDavSourceProvider } from "./caldav/provider.ts"
import { registerConversationsHttpHandlers } from "./conversations/http.ts"
import { DrizzleConversationStorage } from "./conversations/storage.ts"
import { createDatabase } from "./db/index.ts"
import { registerFeedHttpHandlers } from "./engine/http.ts"
import { createFeedEnhancer } from "./enhancement/enhance-feed.ts"
import { createLlmClient } from "./enhancement/llm-client.ts"
import { GoogleMapsSourceProvider } from "./google-maps/provider.ts"
import { CredentialEncryptor } from "./lib/crypto.ts"
import { ensureEnv } from "./lib/env.ts"
import { registerLocationHttpHandlers } from "./location/http.ts"
import { LocationSourceProvider } from "./location/provider.ts"
import { NotificationCentral } from "./notification/notification-central.ts"
import { ReminderSourceProvider } from "./reminders/provider.ts"
import { UserSessionManager } from "./session/index.ts"
import { registerSourcesHttpHandlers } from "./sources/http.ts"
import { TflSourceProvider } from "./tfl/provider.ts"
import { WeatherSourceProvider } from "./weather/provider.ts"
import { WebSearchSourceProvider } from "./web-search/provider.ts"

function main() {
	const env = ensureEnv(process.env)

	const { db, close: closeDb } = createDatabase(env.databaseUrl)
	const conversationStorage = new DrizzleConversationStorage(db, false)

	const auth = createAuth(db)

	const abortController = new AbortController()

	const feedEnhancer = createFeedEnhancer({
		client: createLlmClient({
			apiKey: env.openrouterApiKey,
		}),
	})

	const credentialEncryptor = new CredentialEncryptor(env.credentialEncryptionKey)
	const piApiKey = process.env.PI_API_KEY ?? env.openrouterApiKey

	const sessionManager = new UserSessionManager({
		db,
		providers: [
			new CalDavSourceProvider(),
			new LocationSourceProvider(),
			new ReminderSourceProvider({ db }),
			new WeatherSourceProvider({
				credentials: {
					privateKey: env.weatherkitPrivateKey,
					keyId: env.weatherkitKeyId,
					teamId: env.weatherkitTeamId,
					serviceId: env.weatherkitServiceId,
				},
			}),
			new TflSourceProvider({ apiKey: env.tflApiKey }),
			new WebSearchSourceProvider({ apiKey: env.exaApiKey }),
			new GoogleMapsSourceProvider({
				apiKey: env.googleMapsApiKey,
			}),
		],
		feedEnhancer,
		credentialEncryptor,
		queryAgent: {
			apiKey: piApiKey,
		},
	})
	if (!piApiKey) {
		console.warn("[query] PI_API_KEY or OPENROUTER_API_KEY not set — query agent unavailable")
	}

	const notificationCentral = new NotificationCentral()

	const agentService = new AgentService({
		notificationCentral,
		storage: conversationStorage,
		userSessionManager: sessionManager,
		signal: abortController.signal,
	})

	const app = new Hono()

	const isDev = process.env.NODE_ENV !== "production"
	const isDebugMode = isDev
	const allowedOrigins = process.env.CORS_ORIGINS?.split(",").map((o) => o.trim()) ?? []

	function resolveOrigin(origin: string): string | undefined {
		if (isDev) return origin
		return allowedOrigins.includes(origin) ? origin : undefined
	}

	const agentWebSocketCorsMiddleware = createMiddleware(async (c, next) => {
		const origin = c.req.header("origin")
		if (origin && resolveOrigin(origin) === undefined) {
			return c.text("Forbidden", 403)
		}

		await next()
	})

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
	registerAgentHttpHandlers(app, {
		sessionManager,
		authSessionMiddleware,
	})
	registerConversationsHttpHandlers(app, { db, authSessionMiddleware })
	if (isDebugMode) {
		registerDebugAgentHttpHandlers(app, {
			authSessionMiddleware,
			debugTools: createQueryDebugTools(sessionManager),
			debug: isDebugMode,
		})
	}
	registerAdminHttpHandlers(app, { sessionManager, adminMiddleware, db })

	registerAgentWebSocketHandlers(app, {
		agentService,
		notificationCentral,
		storage: conversationStorage,
		authSessionMiddleware,
		corsMiddleware: agentWebSocketCorsMiddleware,
	})

	process.on("SIGTERM", async () => {
		sessionManager.dispose()
		abortController.abort()
		await closeDb()
		process.exit(0)
	})

	agentService.start()

	return app
}

const app = main()

export default {
	port: 3000,
	hostname: "0.0.0.0",
	fetch: app.fetch,
	websocket: agentWebSocket,
}
