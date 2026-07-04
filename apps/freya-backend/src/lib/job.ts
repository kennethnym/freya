import { Queue } from "./queue"

const JobStatus = {
	Pending: "pending",
	Running: "running",
} as const
type JobStatus = (typeof JobStatus)[keyof typeof JobStatus]

export interface Job<Payload> {
	id: number
	payload: Payload
	signal: AbortSignal
}

interface PendingJob<Payload> {
	status: typeof JobStatus.Pending
	controller: AbortController
	job: Job<Payload>
}

interface RunningJob<Payload> {
	status: typeof JobStatus.Running
	controller: AbortController
	job: Job<Payload>
}

type JobState<Payload> = PendingJob<Payload> | RunningJob<Payload>

type JobEventListener<Payload> = (job: Job<Payload>) => void

type JobEvent = "settled" | "cancelled"

export class JobRegistry<Payload> {
	private queue = new Queue<Job<Payload>>()

	private states = new Map<number, JobState<Payload>>()

	private listeners: Record<JobEvent, JobEventListener<Payload>[]> = {
		settled: [],
		cancelled: [],
	}

	addJob({ payload }: { payload: Payload }): Job<Payload> {
		const controller = new AbortController()
		const job: Job<Payload> = {
			id: this.generateJobId(),
			payload,
			signal: controller.signal,
		}
		this.queue.enqueue(job)
		this.states.set(job.id, { status: JobStatus.Pending, controller, job })
		return job
	}

	async nextJob(signal?: AbortSignal): Promise<Job<Payload> | null> {
		while (true) {
			const job = await this.queue.next(signal)
			if (!job) {
				return null
			}

			const state = this.states.get(job.id)

			if (!state || state.job !== job || state.status === JobStatus.Running) {
				continue
			}
			if (state.controller.signal.aborted) {
				this.states.delete(job.id)
				continue
			}

			this.states.set(job.id, { status: JobStatus.Running, controller: state.controller, job })

			return job
		}
	}

	cancelJob(job: Job<unknown>): void {
		const state = this.states.get(job.id)
		if (state?.job === job) {
			state?.controller.abort()
			this.notifyListeners("cancelled", job.id)
			this.states.delete(job.id)
		}
	}

	markJobAsCompleted(job: Job<unknown>): void {
		const state = this.states.get(job.id)
		if (state?.job === job) {
			this.notifyListeners("settled", job.id)
			this.states.delete(job.id)
		}
	}

	addEventListener(event: JobEvent, listener: JobEventListener<Payload>): () => void {
		this.listeners[event].push(listener)
		return () => {
			this.listeners[event] = this.listeners[event].filter((l) => l !== listener)
		}
	}

	private generateJobId(): number {
		let id: number
		do {
			id = Math.floor(Math.random() * 1000000)
		} while (this.states.has(id))
		return id
	}

	private notifyListeners(event: JobEvent, id: number): void {
		const job = this.states.get(id)?.job
		if (job) {
			this.listeners[event].forEach((listener) => listener(job))
		}
	}
}
