import type { AgentClientApi, AgentServerApi, SendMessageResult } from "@freya/agent-protocol"
import type { JrpcChannel, JrpcMessage, JsonRpcMessage } from "@nym.sh/jrpc"
import type { Hono, MiddlewareHandler } from "hono"
import type { WSContext } from "hono/ws"

import { JsonRpcClient, JsonRpcServer } from "@nym.sh/jrpc"
import { type } from "arktype"
import { upgradeWebSocket, websocket } from "hono/bun"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { UserSessionManager } from "../session/index.ts"

import { streamAgentResponse } from "./streaming.ts"

interface AgentWebSocketHandlerDeps {
	sessionManager: UserSessionManager
	authSessionMiddleware: AuthSessionMiddleware
	corsMiddleware: MiddlewareHandler
}

interface ValidSendMessageInput {
	message: string
}

export const agentWebSocket = websocket

const SendMessageInputBody = type({
	"+": "reject",
	message: "string",
})

export function registerAgentWebSocketHandlers(
	app: Hono,
	{ sessionManager, authSessionMiddleware, corsMiddleware }: AgentWebSocketHandlerDeps,
): void {
	app.get(
		"/api/agent/ws",
		corsMiddleware,
		authSessionMiddleware,
		upgradeWebSocket((c) => {
			const user = c.get("user")
			if (!user) {
				throw new Error("Authenticated WebSocket user missing")
			}

			const channel = new HonoWebSocketJrpcChannel()
			const connection = new AgentRpcConnection({
				channel,
				sessionManager,
				userId: user.id,
			})

			return {
				onOpen(_event, ws) {
					channel.attach(ws)
					void connection.start().catch((err: unknown) => {
						console.error("[query] Agent WebSocket JSON-RPC failed:", errorMessage(err))
						ws.close(1011, "Agent RPC connection failed")
					})
				},

				onMessage(event) {
					channel.receive(event.data)
				},

				onClose() {
					channel.close()
				},
			}
		}),
	)
}

class AgentRpcConnection implements AgentServerApi {
	private readonly client: JsonRpcClient<AgentClientApi>
	private readonly server: JsonRpcServer<AgentServerApi>
	private activeMessage: Promise<SendMessageResult> | null = null
	private readonly sessionManager: UserSessionManager
	private readonly userId: string

	constructor({
		channel,
		sessionManager,
		userId,
	}: {
		channel: JrpcChannel
		sessionManager: UserSessionManager
		userId: string
	}) {
		this.sessionManager = sessionManager
		this.userId = userId
		this.client = new JsonRpcClient<AgentClientApi>(channel)
		this.server = new JsonRpcServer<AgentServerApi>(
			{
				sendMessage: this.sendMessage.bind(this),
				ping: this.ping.bind(this),
			},
			channel,
		)
	}

	start(): Promise<void> {
		return this.server.start()
	}

	async sendMessage(message: string): Promise<SendMessageResult> {
		const parsed = SendMessageInputBody({ message })
		if (parsed instanceof type.errors) {
			throw new Error(parsed.summary)
		}

		if (this.activeMessage) {
			throw new Error("A message is already running")
		}

		const run = this.runMessage(parsed)
		this.activeMessage = run

		try {
			return await run
		} finally {
			if (this.activeMessage === run) {
				this.activeMessage = null
			}
		}
	}

	ping(): "pong" {
		return "pong"
	}

	private async runMessage(input: ValidSendMessageInput): Promise<SendMessageResult> {
		const session = await this.sessionManager.getOrCreate(this.userId)
		let result: SendMessageResult | null = null

		for await (const item of streamAgentResponse({ agent: session.agent, input })) {
			switch (item.type) {
				case "event":
					await this.client.call("notify", item.event)
					break
				case "result":
					result = item.result
					break
			}
		}

		if (!result) {
			throw new Error("Agent response stream ended without a result")
		}

		return result
	}
}

class HonoWebSocketJrpcChannel implements JrpcChannel {
	private closed = false
	private queue: JrpcMessage[] = []
	private waiters: Array<(result: IteratorResult<JrpcMessage, void>) => void> = []
	private ws: WSContext | null = null

	attach(ws: WSContext): void {
		this.ws = ws
	}

	async send(msg: JsonRpcMessage): Promise<void> {
		if (this.closed || !this.ws) {
			throw new Error("JSON-RPC WebSocket channel is closed")
		}

		this.ws.send(JSON.stringify(msg))
	}

	receive(message: unknown): void {
		const parsed = parseJrpcMessage(message)
		if (!parsed) {
			this.ws?.close(1003, "Invalid JSON-RPC message")
			return
		}

		this.push(parsed)
	}

	async next(): Promise<IteratorResult<JrpcMessage, void>> {
		const msg = this.queue.shift()
		if (msg) {
			return { done: false, value: msg }
		}

		if (this.closed) {
			return { done: true, value: undefined }
		}

		return new Promise((resolve) => {
			this.waiters.push(resolve)
		})
	}

	async return(): Promise<IteratorResult<JrpcMessage, void>> {
		this.close()
		this.ws?.close()
		return { done: true, value: undefined }
	}

	async throw(error?: unknown): Promise<IteratorResult<JrpcMessage, void>> {
		this.close()
		throw error
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.return()
	}

	close(): void {
		if (this.closed) return

		this.closed = true
		for (const resolve of this.waiters.splice(0)) {
			resolve({ done: true, value: undefined })
		}
	}

	[Symbol.asyncIterator](): AsyncGenerator<JrpcMessage, void, unknown> {
		return this
	}

	private push(msg: JrpcMessage): void {
		if (this.closed) return

		const resolve = this.waiters.shift()
		if (resolve) {
			resolve({ done: false, value: msg })
			return
		}

		this.queue.push(msg)
	}
}

function parseJrpcMessage(message: unknown): JrpcMessage | null {
	const text = webSocketMessageText(message)
	if (text === null) return null

	try {
		const value: unknown = JSON.parse(text)
		return isJrpcMessage(value) ? value : null
	} catch {
		return null
	}
}

function webSocketMessageText(message: unknown): string | null {
	if (typeof message === "string") return message
	if (message instanceof ArrayBuffer) return Buffer.from(message).toString("utf8")
	if (ArrayBuffer.isView(message)) {
		return Buffer.from(message.buffer, message.byteOffset, message.byteLength).toString("utf8")
	}

	return null
}

function isJrpcMessage(value: unknown): value is JrpcMessage {
	if (typeof value !== "object" || value === null) return false
	if (!("jsonrpc" in value) || value.jsonrpc !== "2.0") return false

	if ("method" in value) {
		return "id" in value && typeof value.id === "number" && typeof value.method === "string"
	}

	if ("result" in value) {
		return "id" in value && typeof value.id === "number"
	}

	if ("error" in value) {
		return (
			"id" in value &&
			typeof value.id === "number" &&
			typeof value.error === "object" &&
			value.error !== null
		)
	}

	return false
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
