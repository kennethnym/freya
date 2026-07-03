import type { UserEvent } from "@freya/agent-protocol"

import { ConversationEntry, ConversationEntryKind, UserMessagePayload } from "@freya/core"

import type { ConversationStorage } from "../conversations/storage"
import type { NotificationCentral } from "../notification/notification-central"
import type { UserSessionManager } from "../session"

import { JobRegistry } from "../lib/job"
import { Worker } from "../lib/worker"
import { AgentResponseJobExecutor, type AgentResponseJobPayload } from "./job"
import { AgentResponseReconciler } from "./reconciler"
import { AgentWorkScheduler } from "./scheduler"

const AgentResponseTiming = {
	waitTime: 5 * 1000,
	maxWaitTime: 5 * 1000 * 60,
} as const

interface AgentServiceConfig {
	storage: ConversationStorage
	userSessionManager: UserSessionManager
	notificationCentral: NotificationCentral
	signal: AbortSignal
}

export class AgentService {
	private readonly storage: ConversationStorage
	private readonly scheduler: AgentWorkScheduler
	private readonly reconciler: AgentResponseReconciler
	private readonly worker: Worker<AgentResponseJobPayload>

	private readonly jobRegistry = new JobRegistry<AgentResponseJobPayload>()

	constructor({ storage, userSessionManager, notificationCentral, signal }: AgentServiceConfig) {
		this.storage = storage
		this.scheduler = new AgentWorkScheduler({
			storage,
			jobRegistry: this.jobRegistry,
			waitTIme: AgentResponseTiming.waitTime,
			maxWaitTime: AgentResponseTiming.maxWaitTime,
		})
		this.reconciler = new AgentResponseReconciler({
			signal,
			storage: this.storage,
			interval: 60 * 1000,
			scheduler: this.scheduler,
		})
		this.worker = new Worker<AgentResponseJobPayload>({
			signal,
			concurrency: 10,
			registry: this.jobRegistry,
			runner: new AgentResponseJobExecutor({
				conversationStorage: storage,
				notificationCentral,
				userSessionManager,
			}),
		})
	}

	start() {
		this.worker.start()
		this.reconciler.start()
	}

	async scheduleAgentResponse(conversationId: string, message: string): Promise<ConversationEntry> {
		const createdEntry = await this.storage.transaction(async (storage) => {
			const now = new Date()

			const entry = await storage.appendEntry(conversationId, {
				kind: ConversationEntryKind.UserMessage,
				payload: {
					role: "user",
					parts: [{ type: "text", text: message }],
				} satisfies UserMessagePayload,
			})

			await storage.upsertConversationResponseState(conversationId, {
				maxWaitUntil: new Date(now.getTime() + AgentResponseTiming.maxWaitTime),
				pendingSinceEntryId: entry.id,
				status: "pending",
			})

			return entry
		})

		await this.scheduler.scheduleAgentResponse(conversationId)

		return createdEntry
	}

	async handleUserEvent(conversationId: string, event: UserEvent) {
		await this.scheduler.receiveUserEvent(conversationId, event)
	}
}
