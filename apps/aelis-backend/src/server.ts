import { LocationSource } from "@aelis/source-location"
import { Hono } from "hono"

import { registerAuthHandlers } from "./auth/http.ts"
import { mockAuthSessionMiddleware, requireSession } from "./auth/session-middleware.ts"
import { CALDAV_SOURCE_ID, calDavRenderer } from "./caldav/renderer-provider.ts"
import { registerFeedHttpHandlers } from "./engine/http.ts"
import { createFeedEnhancer } from "./enhancement/enhance-feed.ts"
import { createLlmClient } from "./enhancement/llm-client.ts"
import { registerLocationHttpHandlers } from "./location/http.ts"
import { FeedRenderer, UserSessionManager } from "./session/index.ts"
import { TFL_SOURCE_ID, tflRenderer } from "./tfl/renderer-provider.ts"
import { WeatherSourceProvider } from "./weather/provider.ts"

function main() {
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

	const allRenderers = {
		[TFL_SOURCE_ID]: tflRenderer,
		[CALDAV_SOURCE_ID]: calDavRenderer,
	}

	const sessionManager = new UserSessionManager({
		providers: [
			() => new LocationSource(),
			new WeatherSourceProvider({
				credentials: {
					privateKey: process.env.WEATHERKIT_PRIVATE_KEY!,
					keyId: process.env.WEATHERKIT_KEY_ID!,
					teamId: process.env.WEATHERKIT_TEAM_ID!,
					serviceId: process.env.WEATHERKIT_SERVICE_ID!,
				},
			}),
		],
		rendererProvider: {
			feedRendererForUser: (_userId) => new FeedRenderer(allRenderers),
		},
		feedEnhancer,
	})

	const app = new Hono()

	app.get("/health", (c) => c.json({ status: "ok" }))

	const isDev = process.env.NODE_ENV !== "production"
	const authSessionMiddleware = isDev ? mockAuthSessionMiddleware("dev-user") : requireSession

	if (!isDev) {
		registerAuthHandlers(app)
	}

	registerFeedHttpHandlers(app, {
		sessionManager,
		authSessionMiddleware,
	})
	registerLocationHttpHandlers(app, { sessionManager })

	return app
}

const app = main()

export default {
	port: 3000,
	fetch: app.fetch,
}
