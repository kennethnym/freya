import type { Context, Hono } from "hono"

import { type } from "arktype"
import { createMiddleware } from "hono/factory"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { UserSessionManager } from "../session/index.ts"
import type { QueryDebugTools } from "./debug-tools.ts"

import { collectQueryAgentResponse, QueryAgentError } from "./query-agent.ts"

type Env = {
	Variables: {
		sessionManager: UserSessionManager
	}
}

type DebugEnv = {
	Variables: {
		debugTools: QueryDebugTools
	}
}

interface AgentHttpHandlersDeps {
	sessionManager: UserSessionManager
	authSessionMiddleware: AuthSessionMiddleware
}

interface AgentDebugHttpHandlersDeps {
	authSessionMiddleware: AuthSessionMiddleware
	debugTools: QueryDebugTools
	debug?: boolean
}

const AgentAskRequestBody = type({
	"+": "reject",
	message: "string",
})

export function registerAgentHttpHandlers(
	app: Hono,
	{ sessionManager, authSessionMiddleware }: AgentHttpHandlersDeps,
) {
	const inject = createMiddleware<Env>(async (c, next) => {
		c.set("sessionManager", sessionManager)
		await next()
	})

	app.post("/api/agent", inject, authSessionMiddleware, handleAgentAsk)
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

async function handleAgentAsk(c: Context<Env>) {
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: "Invalid JSON" }, 400)
	}

	const parsed = AgentAskRequestBody(body)
	if (parsed instanceof type.errors) {
		return c.json({ error: parsed.summary }, 400)
	}

	const user = c.get("user")!
	const sessionManager = c.get("sessionManager")

	try {
		const session = await sessionManager.getOrCreate(user.id)
		const response = await collectQueryAgentResponse(session.agent, {
			message: parsed.message,
		})
		return c.json(response)
	} catch (err) {
		if (err instanceof QueryAgentError) {
			console.error("[query] Query agent failed:", err)
			return c.json({ error: err.message }, 500)
		}
		throw err
	}
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
