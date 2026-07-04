import { AgentEventKind } from "@freya/agent-protocol"
import {
	AssistantMessagePayload,
	ConversationEntryKind,
	ToolCallPayload,
	ToolResultPayload,
	UserMessagePayload,
} from "@freya/core"
import { type } from "arktype"

import type { ConversationStorage } from "../conversations/storage"
import type { Job } from "../lib/job"
import type { AppLogger } from "../lib/logger"
import type { JobExecutor } from "../lib/worker"
import type { NotificationCentral } from "../notification/notification-central"
import type { UserSessionManager } from "../session"

import { ConversationResponseStateStatus } from "../db/schema"
import { logger as rootLogger } from "../lib/logger"
import {
	AgentResponseStreamEventKind,
	streamAgentResponse,
	type AgentResponseStreamEvent,
} from "./streaming"

export interface AgentResponseJobPayload {
	conversationId: string
}

interface AgentResponseWorkerConfig {
	conversationStorage: ConversationStorage
	logger?: AppLogger
	userSessionManager: UserSessionManager
	notificationCentral: NotificationCentral
}

export class AgentResponseJobExecutor implements JobExecutor<AgentResponseJobPayload> {
	private conversationStorage: ConversationStorage
	private logger: AppLogger
	private userSessionManager: UserSessionManager
	private notificationCentral: NotificationCentral

	constructor({
		conversationStorage,
		logger,
		userSessionManager,
		notificationCentral,
	}: AgentResponseWorkerConfig) {
		this.conversationStorage = conversationStorage
		this.logger = logger ?? rootLogger.child({ component: "agent_response_job" })
		this.userSessionManager = userSessionManager
		this.notificationCentral = notificationCentral
	}

	async execute(job: Job<AgentResponseJobPayload>): Promise<void> {
		const conversationId = job.payload.conversationId
		const startedAt = Date.now()
		const logger = this.logger.child({ conversationId, jobId: job.id })

		logger.info("agent response job started")

		const conversation = await this.conversationStorage.findConversation(conversationId)
		if (!conversation) {
			logger.warn("conversation not found for agent response job")
			return
		}

		const claimed =
			await this.conversationStorage.claimPendingConversationResponseState(conversationId)
		if (!claimed) {
			// conversation response state not found or already claimed
			logger.debug("agent response state was not claimable")
			return
		}

		try {
			const pendingEntries = await this.conversationStorage.listPendingUserConversationEntries(
				conversation.userId,
				conversation.id,
			)
			if (pendingEntries.length === 0) {
				await this.conversationStorage.clearConversationResponseState(conversationId)
				logger.debug("agent response state cleared with no pending user entries")
				return
			}

			let invalidPendingEntryCount = 0
			const message = pendingEntries.reduce((acc, entry) => {
				const payload = UserMessagePayload(entry.payload)
				if (payload instanceof type.errors) {
					invalidPendingEntryCount += 1
					return acc
				}
				return (
					acc +
					"\n" +
					payload.parts.reduce((msg, p) => (p.type === "text" ? msg + p.text : msg), "")
				)
			}, "")

			logger.debug(
				{
					invalidPendingEntryCount,
					messageLength: message.length,
					pendingEntryCount: pendingEntries.length,
				},
				"agent response pending user entries loaded",
			)

			if (invalidPendingEntryCount > 0) {
				logger.warn(
					{ invalidPendingEntryCount },
					"invalid pending user entries skipped for agent response",
				)
			}

			const session = await this.userSessionManager.getOrCreate(conversation.userId)

			for await (const event of streamAgentResponse({
				agent: session.agent,
				input: {
					message,
					conversationId: conversation.id,
					signal: job.signal,
				},
			})) {
				if (job.signal.aborted) {
					break
				}

				await this.handleStreamEvent(event, conversation.id, conversation.userId, logger)
			}

			// if job is aborted, stop everything immediately, including clean up.
			// the aborter is assumed responsibility on how to proceed.
			if (!job.signal.aborted) {
				await this.conversationStorage.clearConversationResponseState(conversationId)
				logger.info({ durationMs: Date.now() - startedAt }, "agent response job completed")
			} else {
				logger.warn({ durationMs: Date.now() - startedAt }, "agent response job aborted")
			}
		} catch (err) {
			const durationMs = Date.now() - startedAt
			if (job.signal.aborted) {
				logger.warn({ durationMs, err }, "agent response job aborted")
				return
			}

			logger.error({ durationMs, err }, "agent response job failed")
			try {
				await this.conversationStorage.markResponseStateStatus(
					[conversationId],
					ConversationResponseStateStatus.Failed,
				)
				logger.warn(
					{ status: ConversationResponseStateStatus.Failed },
					"conversation response state marked failed",
				)
			} catch (markErr) {
				logger.error({ err: markErr }, "failed to mark conversation response state failed")
			}
		}
	}

	private async handleStreamEvent(
		event: AgentResponseStreamEvent,
		conversationId: string,
		userId: string,
		logger: AppLogger,
	): Promise<void> {
		switch (event.kind) {
			case AgentResponseStreamEventKind.ConversationStarted:
				await this.notificationCentral.notifyUser(userId, {
					kind: "agent",
					payload: {
						kind: AgentEventKind.ConversationStarted,
						conversationId: event.conversationId,
					},
				})
				logger.debug(
					{
						eventKind: event.kind,
						upstreamConversationId: event.conversationId,
					},
					"agent conversation started",
				)
				break

			case AgentResponseStreamEventKind.AssistantMessage: {
				const entry = await this.conversationStorage.appendEntry(conversationId, {
					kind: ConversationEntryKind.AssistantMessage,
					payload: {
						role: "assistant",
						parts: [{ type: "text", text: event.text }],
					} satisfies AssistantMessagePayload,
				})
				await this.notificationCentral.notifyUser(userId, {
					kind: "agent",
					payload: {
						kind: AgentEventKind.ConversationEntryCreated,
						entry,
					},
				})
				logger.debug(
					{
						entryId: entry.id,
						eventKind: event.kind,
						textLength: event.text.length,
					},
					"agent assistant message persisted",
				)
				break
			}

			case AgentResponseStreamEventKind.ToolStarted: {
				const entry = await this.conversationStorage.appendEntry(conversationId, {
					kind: ConversationEntryKind.ToolCall,
					payload: {
						toolName: event.toolName,
					} satisfies ToolCallPayload,
				})
				await this.notificationCentral.notifyUser(userId, {
					kind: "agent",
					payload: {
						kind: AgentEventKind.ConversationEntryCreated,
						entry,
					},
				})
				logger.debug(
					{
						entryId: entry.id,
						eventKind: event.kind,
						toolName: event.toolName,
					},
					"agent tool call persisted",
				)
				break
			}

			case AgentResponseStreamEventKind.ToolFinished: {
				const entry = await this.conversationStorage.appendEntry(conversationId, {
					kind: ConversationEntryKind.ToolResult,
					payload: {
						toolName: event.toolName,
						ok: event.ok,
					} satisfies ToolResultPayload,
				})
				await this.notificationCentral.notifyUser(userId, {
					kind: "agent",
					payload: {
						kind: AgentEventKind.ConversationEntryCreated,
						entry,
					},
				})
				logger.debug(
					{
						entryId: entry.id,
						eventKind: event.kind,
						ok: event.ok,
						toolName: event.toolName,
					},
					"agent tool result persisted",
				)
				break
			}

			case AgentResponseStreamEventKind.ResponseFinished:
				await this.notificationCentral.notifyUser(userId, {
					kind: "agent",
					payload: {
						kind: AgentEventKind.ResponseFinished,
						conversationId,
					},
				})
				logger.info({ eventKind: event.kind }, "agent response finished")
				break

			case AgentResponseStreamEventKind.ResponseFailed:
				await this.notificationCentral.notifyUser(userId, {
					kind: "agent",
					payload: {
						kind: AgentEventKind.ResponseFailed,
						conversationId,
						error: event.error,
					},
				})
				logger.warn(
					{ agentError: event.error, eventKind: event.kind },
					"agent response failed event received",
				)
				break
		}
	}
}
