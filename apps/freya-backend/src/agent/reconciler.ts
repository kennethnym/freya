import type { ConversationStorage } from "../conversations/storage"
import type { AppLogger } from "../lib/logger"
import type { AgentWorkScheduler } from "./scheduler"

import { logger as rootLogger } from "../lib/logger"

interface AgentResponseReconcilerConfig {
	storage: ConversationStorage
	interval: number
	logger?: AppLogger
	scheduler: AgentWorkScheduler
	signal: AbortSignal
}

export class AgentResponseReconciler {
	private storage: ConversationStorage
	private interval: number
	private logger: AppLogger
	private scheduler: AgentWorkScheduler
	private signal: AbortSignal

	private stopLoop: ReturnType<typeof setInterval> | null = null

	constructor({ storage, interval, logger, scheduler, signal }: AgentResponseReconcilerConfig) {
		this.storage = storage
		this.interval = interval
		this.logger = logger ?? rootLogger.child({ component: "agent_reconciler" })
		this.scheduler = scheduler
		this.signal = signal
	}

	start() {
		this.signal.throwIfAborted()
		this.logger.debug({ intervalMs: this.interval }, "agent response reconciler started")

		this.signal.addEventListener(
			"abort",
			() => {
				if (this.stopLoop !== null) {
					clearInterval(this.stopLoop)
					this.stopLoop = null
					this.logger.debug("agent response reconciler stopped")
				}
			},
			{ once: true },
		)

		this.stopLoop = setInterval(() => {
			void this.reconcile()
		}, this.interval)
	}

	private async reconcile() {
		try {
			// enqueue pending responses
			const pendingStates = await this.storage.listPendingResponseStates()
			const now = new Date().getTime()
			this.logger.debug({ pendingCount: pendingStates.length }, "agent response reconcile tick")
			for (const state of pendingStates) {
				if (state.maxWaitUntil.getTime() < now) {
					this.logger.info(
						{
							conversationId: state.conversationId,
							maxWaitUntil: state.maxWaitUntil.toISOString(),
						},
						"pending agent response reached max wait",
					)
					this.scheduler.enqueueAgentResponse(state.conversationId)
				}
			}

			// re-enqueue stuck responses
			const runningStates = await this.storage.listRunningResponseStates()
			const stuckIds: string[] = []
			for (const state of runningStates) {
				if (state.runningSince && Math.max(now - state.runningSince.getTime(), 0) > 5 * 1000 * 60) {
					// if the response is running for more than 5 minutes
					// we assume that its stuck and enqueue it for retry
					stuckIds.push(state.conversationId)
				}
			}
			this.logger.debug(
				{ runningCount: runningStates.length, stuckCount: stuckIds.length },
				"agent response running states reconciled",
			)
			if (stuckIds.length > 0) {
				await this.storage.markResponseStateStatus(stuckIds, "pending")
				this.logger.warn(
					{ conversationIds: stuckIds, count: stuckIds.length },
					"stuck agent responses requeued",
				)
				for (const id of stuckIds) {
					this.scheduler.enqueueAgentResponse(id)
				}
			}
		} catch (err) {
			this.logger.error({ err }, "agent response reconciliation failed")
		}
	}
}
