import type { UserEvent } from "@freya/agent-protocol"

import { ConversationEntry, ConversationEntryKind, UserMessagePayload } from "@freya/core"

import type { ConversationStorage } from "../conversations/storage"
import type { AppLogger } from "../lib/logger"
import type { NotificationCentral } from "../notification/notification-central"
import type { UserSessionManager } from "../session"

import { JobRegistry } from "../lib/job"
import { logger as rootLogger } from "../lib/logger"
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
	logger?: AppLogger
}

export class AgentService {
	private readonly storage: ConversationStorage
	private readonly logger: AppLogger
	private readonly scheduler: AgentWorkScheduler
	private readonly reconciler: AgentResponseReconciler
	private readonly worker: Worker<AgentResponseJobPayload>

	private readonly jobRegistry = new JobRegistry<AgentResponseJobPayload>()

	constructor({
		storage,
		userSessionManager,
		notificationCentral,
		signal,
		logger,
	}: AgentServiceConfig) {
		const baseLogger = logger ?? rootLogger

		this.storage = storage
		this.logger = baseLogger.child({ component: "agent_service" })
		this.scheduler = new AgentWorkScheduler({
			storage,
			jobRegistry: this.jobRegistry,
			waitTime: AgentResponseTiming.waitTime,
			maxWaitTime: AgentResponseTiming.maxWaitTime,
			logger: baseLogger.child({ component: "agent_scheduler" }),
		})
		this.reconciler = new AgentResponseReconciler({
			signal,
			storage: this.storage,
			interval: 60 * 1000,
			scheduler: this.scheduler,
			logger: baseLogger.child({ component: "agent_reconciler" }),
		})
		this.worker = new Worker<AgentResponseJobPayload>({
			signal,
			concurrency: 10,
			registry: this.jobRegistry,
			logger: baseLogger.child({ component: "agent_worker" }),
			jobFields: agentResponseJobFields,
			runner: new AgentResponseJobExecutor({
				conversationStorage: storage,
				notificationCentral,
				userSessionManager,
				logger: baseLogger.child({ component: "agent_response_job" }),
			}),
		})
	}

	start() {
		this.logger.info("agent service starting")
		this.worker.start()
		this.reconciler.start()
	}

	async scheduleAgentResponse(conversationId: string, message: string): Promise<ConversationEntry> {
		this.logger.info(
			{ conversationId, messageLength: message.length },
			"scheduling agent response from user message",
		)

		try {
			const scheduledResponse = await this.storage.transaction(async (storage) => {
				const now = new Date()
				const maxWaitUntil = new Date(now.getTime() + AgentResponseTiming.maxWaitTime)

				const entry = await storage.appendEntry(conversationId, {
					kind: ConversationEntryKind.UserMessage,
					payload: {
						role: "user",
						parts: [{ type: "text", text: message }],
					} satisfies UserMessagePayload,
				})

				await storage.upsertConversationResponseState(conversationId, {
					maxWaitUntil,
					pendingSinceEntryId: entry.id,
					status: "pending",
				})

				return { entry, maxWaitUntil }
			})

			this.logger.info(
				{
					conversationId,
					entryId: scheduledResponse.entry.id,
					maxWaitMs: AgentResponseTiming.maxWaitTime,
					maxWaitUntil: scheduledResponse.maxWaitUntil.toISOString(),
					waitMs: AgentResponseTiming.waitTime,
				},
				"agent response state set pending",
			)

			await this.scheduler.scheduleAgentResponse(conversationId)

			return scheduledResponse.entry
		} catch (err) {
			this.logger.error({ err, conversationId }, "failed to schedule agent response")
			throw err
		}
	}

	async handleUserEvent(conversationId: string, event: UserEvent) {
		try {
			await this.scheduler.receiveUserEvent(conversationId, event)
		} catch (err) {
			this.logger.error(
				{ err, conversationId, eventType: event.type },
				"failed to handle user event",
			)
			throw err
		}
	}
}

function agentResponseJobFields(job: {
	payload: AgentResponseJobPayload
}): Record<string, unknown> {
	return {
		conversationId: job.payload.conversationId,
	}
}
