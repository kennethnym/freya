import { LocationSource } from "@aris/source-location"
import { Hono } from "hono"

import { registerAuthHandlers } from "./auth/http.ts"
import { requireSession } from "./auth/session-middleware.ts"
import { createFeedEnhancer } from "./enhancement/enhance-feed.ts"
import { createLlmClient } from "./enhancement/llm-client.ts"
import { registerFeedHttpHandlers } from "./feed/http.ts"
import { registerLocationHttpHandlers } from "./location/http.ts"
import { UserSessionManager } from "./session/index.ts"
import { WeatherSourceProvider } from "./weather/provider.ts"

function main() {
	const sessionManager = new UserSessionManager([
		() => new LocationSource(),
		new WeatherSourceProvider({
			credentials: {
				privateKey: process.env.WEATHERKIT_PRIVATE_KEY!,
				keyId: process.env.WEATHERKIT_KEY_ID!,
				teamId: process.env.WEATHERKIT_TEAM_ID!,
				serviceId: process.env.WEATHERKIT_SERVICE_ID!,
			},
		}),
	])

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

	const app = new Hono()

	app.get("/health", (c) => c.json({ status: "ok" }))

	registerAuthHandlers(app)
	registerFeedHttpHandlers(app, {
		sessionManager,
		authSessionMiddleware: requireSession,
		feedEnhancer,
	})
	registerLocationHttpHandlers(app, { sessionManager })

	return app
}

const app = main()

export default {
	port: 3000,
	fetch: app.fetch,
}
