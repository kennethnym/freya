import type { UserEvent } from "@freya/agent-protocol"

import type { ConversationStorage } from "../conversations/storage"
import type { Job, JobRegistry } from "../lib/job"
import type { AgentResponseJobPayload } from "./job"

import { ConversationNotFoundError } from "../conversations/errors"
import { ConversationResponseStateStatus } from "../db/schema"

interface AgentMessageSchedulerConfig {
	storage: ConversationStorage
	maxWaitTime: number

	/**
	 * How long to wait before responding to the user.
	 */
	waitTIme: number

	jobRegistry: JobRegistry<AgentResponseJobPayload>
}

/**
 * Schedules and manages the flow of messages between the user and the query agent for a specific conversation.
 */
export class AgentWorkScheduler {
	private conversationStorage: ConversationStorage
	private jobRegistry: JobRegistry<AgentResponseJobPayload>

	private timing: {
		maxWaitTime: number
		waitTime: number
	}

	private timers = new Map<string, ReturnType<typeof setTimeout>>()
	private runningJobs = new Map<string, Job<AgentResponseJobPayload>>()

	constructor(config: AgentMessageSchedulerConfig) {
		this.conversationStorage = config.storage
		this.jobRegistry = config.jobRegistry
		this.timing = {
			maxWaitTime: config.maxWaitTime,
			waitTime: config.waitTIme,
		}

		this.jobRegistry.addEventListener("settled", this.eraseJob.bind(this))
		this.jobRegistry.addEventListener("cancelled", this.eraseJob.bind(this))
	}

	async scheduleAgentResponse(conversationId: string) {
		const existing = this.timers.get(conversationId)
		if (existing) {
			clearTimeout(existing)
		}

		this.cancelCurrentJob(conversationId)

		this.timers.set(
			conversationId,
			setTimeout(() => {
				this.enqueueAgentResponse(conversationId)
			}, this.timing.waitTime),
		)
	}

	async receiveUserEvent(conversationId: string, event: UserEvent) {
		if (event.type === "typing") {
			await this.delayAgentResponse(conversationId)
		}
	}

	enqueueAgentResponse(conversationId: string): void {
		const existing = this.timers.get(conversationId)
		if (existing) {
			clearTimeout(existing)
			this.timers.delete(conversationId)
		}

		this.cancelCurrentJob(conversationId)

		const job = this.jobRegistry.addJob({
			payload: { conversationId },
		})
		this.runningJobs.set(conversationId, job)
	}

	private async delayAgentResponse(conversationId: string) {
		this.cancelCurrentJob(conversationId)

		try {
			const ok = await this.conversationStorage.transaction(async (storage) => {
				const state = await storage.findConversationResponseState(conversationId)
				if (state && state.status !== ConversationResponseStateStatus.Failed) {
					await storage.updateConversationResponseState(conversationId, {
						status: ConversationResponseStateStatus.Pending,
						// the agent response was cancelled, so its no longer running
						// clear runningSince timestamp
						runningSince: null,
					})
					return true
				}
				return false
			})
			if (ok) {
				await this.scheduleAgentResponse(conversationId)
			}
		} catch (error) {
			if (error instanceof ConversationNotFoundError) {
				// the user is typing but there isn't a scheduled agent response yet
				// which means the user is typing their first message after the agent has previously responded
				// swallow the error
			} else {
				console.error("[agent response scheduler] error delaying agent response", error)
			}
			return
		}
	}

	/**
	 * cancels the current job for agent response for the given conversation id
	 * no-op if there is no active job for the conversation.
	 */
	private cancelCurrentJob(conversationId: string): void {
		const job = this.runningJobs.get(conversationId)
		if (!job) return

		// If an active response is working on stale context, abort it so the next
		// job can answer using the latest pending user messages.
		this.jobRegistry.cancelJob(job)
	}

	private eraseJob(job: Job<AgentResponseJobPayload>) {
		if (this.runningJobs.get(job.payload.conversationId) === job) {
			this.runningJobs.delete(job.payload.conversationId)
		}
	}
}
