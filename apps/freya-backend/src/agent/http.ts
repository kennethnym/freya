import type { Context, Hono } from "hono"

import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { QueryDebugTools } from "./debug-tools.ts"

type DebugEnv = {
	Variables: {
		debugTools: QueryDebugTools
	}
}

interface AgentDebugHttpHandlersDeps {
	authSessionMiddleware: AuthSessionMiddleware
	debugTools: QueryDebugTools
	debug?: boolean
}

export function registerDebugAgentHttpHandlers(app: Hono, deps: AgentDebugHttpHandlersDeps) {
	const { authSessionMiddleware, debugTools, debug = process.env.NODE_ENV !== "production" } = deps
	if (process.env.NODE_ENV === "production" || !debug) return

	const inject = createMiddleware<DebugEnv>(async (c, next) => {
		c.set("debugTools", debugTools)
		await next()
	})

	app.get("/api/agent/tools", inject, authSessionMiddleware, handleListTools)
	app.post("/api/agent/tools/:toolName", inject, authSessionMiddleware, handleExecuteTool)
}

async function handleListTools(c: Context<DebugEnv>) {
	const debugTools = c.get("debugTools")

	return c.json({ tools: debugTools.list() })
}

async function handleExecuteTool(c: Context<DebugEnv>) {
	const debugTools = c.get("debugTools")

	const toolName = c.req.param("toolName")
	if (!toolName) {
		return c.body(null, 404)
	}

	let params: unknown
	try {
		params = await c.req.json()
	} catch {
		return c.json({ error: "Invalid JSON" }, 400)
	}

	const user = c.get("user")!
	try {
		const result = await debugTools.execute(user.id, toolName, params)
		return c.json({ result })
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
	}
}
