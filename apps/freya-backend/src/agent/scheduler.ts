import type { UserEvent } from "@freya/agent-protocol"

import type { ConversationStorage } from "../conversations/storage"
import type { Job, JobRegistry } from "../lib/job"
import type { AppLogger } from "../lib/logger"
import type { AgentResponseJobPayload } from "./job"

import { ConversationNotFoundError } from "../conversations/errors"
import { ConversationResponseStateStatus } from "../db/schema"
import { logger as rootLogger } from "../lib/logger"

const AgentJobCancellationReason = {
	NewUserActivity: "new_user_activity",
	SupersededByEnqueue: "superseded_by_enqueue",
} as const
type AgentJobCancellationReason =
	(typeof AgentJobCancellationReason)[keyof typeof AgentJobCancellationReason]

interface AgentMessageSchedulerConfig {
	storage: ConversationStorage
	maxWaitTime: number

	/**
	 * How long to wait before responding to the user.
	 */
	waitTime: number

	jobRegistry: JobRegistry<AgentResponseJobPayload>
	logger?: AppLogger
}

/**
 * Schedules and manages the flow of messages between the user and the query agent for a specific conversation.
 */
export class AgentWorkScheduler {
	private conversationStorage: ConversationStorage
	private jobRegistry: JobRegistry<AgentResponseJobPayload>
	private logger: AppLogger

	private timing: {
		maxWaitTime: number
		waitTime: number
	}

	private timers = new Map<string, ReturnType<typeof setTimeout>>()
	private runningJobs = new Map<string, Job<AgentResponseJobPayload>>()

	constructor(config: AgentMessageSchedulerConfig) {
		this.conversationStorage = config.storage
		this.jobRegistry = config.jobRegistry
		this.logger = config.logger ?? rootLogger.child({ component: "agent_scheduler" })
		this.timing = {
			maxWaitTime: config.maxWaitTime,
			waitTime: config.waitTime,
		}

		this.jobRegistry.addEventListener("settled", this.eraseJob.bind(this))
		this.jobRegistry.addEventListener("cancelled", this.eraseJob.bind(this))
	}

	async scheduleAgentResponse(conversationId: string) {
		const existing = this.timers.get(conversationId)
		if (existing) {
			clearTimeout(existing)
			this.logger.debug({ conversationId }, "existing agent response timer replaced")
		}

		this.cancelCurrentJob(conversationId, AgentJobCancellationReason.NewUserActivity)

		this.timers.set(
			conversationId,
			setTimeout(() => {
				this.enqueueAgentResponse(conversationId)
			}, this.timing.waitTime),
		)

		this.logger.info(
			{
				conversationId,
				maxWaitMs: this.timing.maxWaitTime,
				waitMs: this.timing.waitTime,
			},
			"agent response scheduled",
		)
	}

	async receiveUserEvent(conversationId: string, event: UserEvent) {
		if (event.type === "typing") {
			this.logger.debug({ conversationId, eventType: event.type }, "user event received")
			await this.delayAgentResponse(conversationId)
			this.logger.debug({ conversationId }, "agent response delay handled")
		}
	}

	enqueueAgentResponse(conversationId: string): void {
		const existing = this.timers.get(conversationId)
		if (existing) {
			clearTimeout(existing)
			this.timers.delete(conversationId)
			this.logger.debug({ conversationId }, "agent response timer consumed")
		}

		this.cancelCurrentJob(conversationId, AgentJobCancellationReason.SupersededByEnqueue)

		const job = this.jobRegistry.addJob({
			payload: { conversationId },
		})
		this.runningJobs.set(conversationId, job)
		this.logger.info({ conversationId, jobId: job.id }, "agent response job enqueued")
	}

	private async delayAgentResponse(conversationId: string) {
		this.cancelCurrentJob(conversationId, AgentJobCancellationReason.NewUserActivity)

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
			} else {
				this.logger.debug(
					{ conversationId },
					"agent response delay skipped because response state is not pending",
				)
			}
		} catch (error) {
			if (error instanceof ConversationNotFoundError) {
				// the user is typing but there isn't a scheduled agent response yet
				// which means the user is typing their first message after the agent has previously responded
				// swallow the error
				this.logger.debug({ conversationId }, "typing event received without active conversation")
			} else {
				this.logger.error({ err: error, conversationId }, "agent response delay failed")
			}
			return
		}
	}

	/**
	 * cancels the current job for agent response for the given conversation id
	 * no-op if there is no active job for the conversation.
	 */
	private cancelCurrentJob(conversationId: string, reason: AgentJobCancellationReason): void {
		const job = this.runningJobs.get(conversationId)
		if (!job) return

		// If an active response is working on stale context, abort it so the next
		// job can answer using the latest pending user messages.
		this.jobRegistry.cancelJob(job)
		this.logger.info(
			{ conversationId, jobId: job.id, reason },
			"active agent response job cancelled",
		)
	}

	private eraseJob(job: Job<AgentResponseJobPayload>) {
		if (this.runningJobs.get(job.payload.conversationId) === job) {
			this.runningJobs.delete(job.payload.conversationId)
			this.logger.debug(
				{ conversationId: job.payload.conversationId, jobId: job.id },
				"agent response job tracking cleared",
			)
		}
	}
}
