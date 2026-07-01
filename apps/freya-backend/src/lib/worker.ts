import type { Job, JobRegistry } from "./job"
import type { Queue } from "./queue"

export interface JobExecutor<JobPayload> {
	execute(job: Job<JobPayload>): Promise<void>
}

export interface WorkerConfig<Job> {
	concurrency: number
	registry: JobRegistry<Job>
	runner: JobExecutor<Job>
	signal: AbortSignal
}

export class Worker<Job> {
	private concurrency: number
	private registry: JobRegistry<Job>
	private runner: JobExecutor<Job>
	private signal: AbortSignal

	constructor({ concurrency, registry, runner, signal }: WorkerConfig<Job>) {
		this.concurrency = concurrency
		this.registry = registry
		this.runner = runner
		this.signal = signal
	}

	start() {
		if (this.signal.aborted) return
		for (let i = 0; i < this.concurrency; i++) {
			void this.pollJobFromRegistry()
		}
	}

	private async pollJobFromRegistry() {
		while (!this.signal.aborted) {
			const job = await this.registry.nextJob(this.signal)
			if (!job) {
				return
			}

			try {
				await this.runner.execute(job)
			} catch {
				// TODO: handle logging of job execution errors
			} finally {
				this.registry.markJobAsCompleted(job)
			}
		}
	}
}
