import type { AgentEvent } from "@freya/agent-protocol"

import {
	AssistantMessagePayload,
	ConversationEntryKind,
	UserMessagePayload,
	ToolCallPayload,
	ToolResultPayload,
} from "@freya/core"
import { type } from "arktype"

import type { ConversationStorage } from "../conversations/storage"
import type { Job } from "../lib/job"
import type { JobExecutor } from "../lib/worker"
import type { NotificationCentral } from "../notification/notification-central"
import type { UserSessionManager } from "../session"

import { ConversationResponseStateStatus } from "../db/schema"
import { streamAgentResponse } from "./streaming"

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
				input: { message, signal: job.signal },
			})) {
				if (job.signal.aborted) {
					break
				}

				await this.recordAgentEvent(event, conversation.id)
				await this.notificationCentral.notifyUser(conversation.userId, {
					kind: "agent",
					payload: event,
				})
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

	private async recordAgentEvent(event: AgentEvent, conversationId: string) {
		switch (event.type) {
			case "message_created":
				await this.conversationStorage.appendEntry(conversationId, {
					kind: ConversationEntryKind.AssistantMessage,
					payload: {
						role: "assistant",
						parts: [{ type: "text", text: event.text }],
					} satisfies AssistantMessagePayload,
				})
				break

			case "tool_started":
				await this.conversationStorage.appendEntry(conversationId, {
					kind: ConversationEntryKind.ToolCall,
					payload: {
						toolName: event.toolName,
					} satisfies ToolCallPayload,
				})
				break

			case "tool_finished":
				await this.conversationStorage.appendEntry(conversationId, {
					kind: ConversationEntryKind.ToolResult,
					payload: {
						toolName: event.toolName,
						ok: event.ok,
					} satisfies ToolResultPayload,
				})
				break
		}
	}
}
