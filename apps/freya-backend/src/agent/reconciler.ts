import type { ConversationStorage } from "../conversations/storage"
import type { AgentWorkScheduler } from "./scheduler"

interface AgentResponseReconcilerConfig {
	storage: ConversationStorage
	interval: number
	scheduler: AgentWorkScheduler
	signal: AbortSignal
}

export class AgentResponseReconciler {
	private storage: ConversationStorage
	private interval: number
	private scheduler: AgentWorkScheduler
	private signal: AbortSignal

	private stopLoop: ReturnType<typeof setInterval> | null = null

	constructor({ storage, interval, scheduler, signal }: AgentResponseReconcilerConfig) {
		this.storage = storage
		this.interval = interval
		this.scheduler = scheduler
		this.signal = signal
	}

	start() {
		this.signal.throwIfAborted()

		this.signal.addEventListener(
			"abort",
			() => {
				if (this.stopLoop !== null) {
					clearInterval(this.stopLoop)
					this.stopLoop = null
				}
			},
			{ once: true },
		)

		this.stopLoop = setInterval(this.reconcile.bind(this), this.interval)
	}

	private async reconcile() {
		// enqueue pending responses
		const pendingStates = await this.storage.listPendingResponseStates()
		const now = new Date().getTime()
		for (const state of pendingStates) {
			if (state.maxWaitUntil.getTime() < now) {
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
		if (stuckIds.length > 0) {
			await this.storage.markResponseStateStatus(stuckIds, "pending")
			for (const id of stuckIds) {
				this.scheduler.enqueueAgentResponse(id)
			}
		}
	}
}
