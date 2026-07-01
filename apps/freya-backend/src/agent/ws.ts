import type { AgentClientApi, AgentServerApi, UserEvent } from "@freya/agent-protocol"
import type { JrpcChannel, JrpcMessage, JsonRpcMessage } from "@nym.sh/jrpc"
import type { Hono, MiddlewareHandler } from "hono"
import type { WSContext } from "hono/ws"

import { JsonRpcClient, JsonRpcServer, deserializeJrpcMessage } from "@nym.sh/jrpc"
import { upgradeWebSocket, websocket } from "hono/bun"

import type { AuthSessionMiddleware } from "../auth/session-middleware.ts"
import type { ConversationStorage } from "../conversations/storage.ts"
import type {
	NotificationCentral,
	NotificationPayload,
} from "../notification/notification-central.ts"
import type { AgentService } from "./service.ts"

interface AgentWebSocketHandlerDeps {
	agentService: AgentService
	storage: ConversationStorage
	notificationCentral: NotificationCentral
	authSessionMiddleware: AuthSessionMiddleware
	corsMiddleware: MiddlewareHandler
}

export const agentWebSocket = websocket

export function registerAgentWebSocketHandlers(
	app: Hono,
	{
		agentService,
		storage,
		notificationCentral,
		authSessionMiddleware,
		corsMiddleware,
	}: AgentWebSocketHandlerDeps,
): void {
	app.get(
		"/api/agent/ws",
		corsMiddleware,
		authSessionMiddleware,
		upgradeWebSocket(async (c) => {
			const user = c.get("user")
			if (!user) {
				throw new Error("Authenticated WebSocket user missing")
			}

			const conversation = await storage.getOrCreateConversation(user.id)

			const channel = new HonoWebSocketJrpcChannel()
			const connection = new AgentRpcConnection({
				channel,
				notificationCentral,
				agentService,
				userId: user.id,
				conversationId: conversation.id,
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
					connection.close()
					channel.close()
				},
			}
		}),
	)
}

class AgentRpcConnection implements AgentServerApi {
	private readonly client: JsonRpcClient<AgentClientApi>
	private readonly server: JsonRpcServer<AgentServerApi>
	private readonly agentService: AgentService
	private readonly notificationCentral: NotificationCentral
	private readonly userId: string
	private readonly conversationId: string

	private cleanup: (() => void) | null = null

	constructor({
		agentService,
		notificationCentral,
		channel,
		userId,
		conversationId,
	}: {
		agentService: AgentService
		notificationCentral: NotificationCentral
		channel: JrpcChannel
		userId: string
		conversationId: string
	}) {
		this.client = new JsonRpcClient<AgentClientApi>(channel)
		this.agentService = agentService
		this.notificationCentral = notificationCentral
		this.userId = userId
		this.conversationId = conversationId
		this.server = new JsonRpcServer<AgentServerApi>(
			{
				sendMessage: this.sendMessage.bind(this),
				notify: this.notify.bind(this),
				ping: this.ping.bind(this),
			},
			channel,
		)
	}

	notify(event: UserEvent): void {
		this.agentService.handleUserEvent(this.conversationId, event)
	}

	async sendMessage(message: string): Promise<boolean> {
		try {
			await this.agentService.scheduleAgentResponse(this.conversationId, message)
			return true
		} catch (error) {
			console.log("[agent rpc connection] error when scheduling agent response", error)
			return false
		}
	}

	ping(): "pong" {
		return "pong"
	}

	async start() {
		this.cleanup = this.notificationCentral.registerListenerForUser(
			this.userId,
			this.onNotificationReceived.bind(this),
		)
		await this.server.start()
	}

	close() {
		this.cleanup?.()
	}

	private async onNotificationReceived(notification: NotificationPayload) {
		if (notification.kind === "agent") {
			await this.client.call("notify", notification.payload)
		}
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
		if (typeof message !== "string") {
			return
		}

		const parsed = deserializeJrpcMessage(message)
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
