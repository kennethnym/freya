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
import type { JobExecutor } from "../lib/worker"
import type { NotificationCentral } from "../notification/notification-central"
import type { UserSessionManager } from "../session"

import { ConversationResponseStateStatus } from "../db/schema"
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
	userSessionManager: UserSessionManager
	notificationCentral: NotificationCentral
}

export class AgentResponseJobExecutor implements JobExecutor<AgentResponseJobPayload> {
	private conversationStorage: ConversationStorage
	private userSessionManager: UserSessionManager
	private notificationCentral: NotificationCentral

	constructor({
		conversationStorage,
		userSessionManager,
		notificationCentral,
	}: AgentResponseWorkerConfig) {
		this.conversationStorage = conversationStorage
		this.userSessionManager = userSessionManager
		this.notificationCentral = notificationCentral
	}

	async execute(job: Job<AgentResponseJobPayload>): Promise<void> {
		const conversation = await this.conversationStorage.findConversation(job.payload.conversationId)
		if (!conversation) {
			return
		}

		const claimed = await this.conversationStorage.claimPendingConversationResponseState(
			job.payload.conversationId,
		)
		if (!claimed) {
			// conversation response state not found or already claimed
			return
		}

		const pendingEntries = await this.conversationStorage.listPendingUserConversationEntries(
			conversation.userId,
			conversation.id,
		)
		if (pendingEntries.length === 0) {
			await this.conversationStorage.clearConversationResponseState(job.payload.conversationId)
			return
		}

		const message = pendingEntries.reduce((acc, entry) => {
			const payload = UserMessagePayload(entry.payload)
			if (payload instanceof type.errors) {
				return acc
			}
			return (
				acc + "\n" + payload.parts.reduce((msg, p) => (p.type === "text" ? msg + p.text : msg), "")
			)
		}, "")

		const session = await this.userSessionManager.getOrCreate(conversation.userId)

		try {
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

				await this.handleStreamEvent(event, conversation.id, conversation.userId)
			}

			// if job is aborted, stop everything immediately, including clean up.
			// the aborter is assumed responsibility on how to proceed.
			if (!job.signal.aborted) {
				await this.conversationStorage.clearConversationResponseState(job.payload.conversationId)
			}
		} catch (err) {
			console.error("[agent job executor] error streaming agent response:", err)
			if (!job.signal.aborted) {
				await this.conversationStorage.markResponseStateStatus(
					[job.payload.conversationId],
					ConversationResponseStateStatus.Failed,
				)
			}
		}
	}

	private async handleStreamEvent(
		event: AgentResponseStreamEvent,
		conversationId: string,
		userId: string,
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
				break
		}
	}
}
