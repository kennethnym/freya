import type { Job, JobRegistry } from "./job"
import type { AppLogger } from "./logger"

import { logger as rootLogger } from "./logger"

export interface JobExecutor<JobPayload> {
	execute(job: Job<JobPayload>): Promise<void>
}

export interface WorkerConfig<JobPayload> {
	concurrency: number
	jobFields?: (job: Job<JobPayload>) => Record<string, unknown>
	logger?: AppLogger
	registry: JobRegistry<JobPayload>
	runner: JobExecutor<JobPayload>
	signal: AbortSignal
}

export class Worker<JobPayload> {
	private concurrency: number
	private jobFields: (job: Job<JobPayload>) => Record<string, unknown>
	private logger: AppLogger
	private registry: JobRegistry<JobPayload>
	private runner: JobExecutor<JobPayload>
	private signal: AbortSignal

	constructor({
		concurrency,
		jobFields,
		logger,
		registry,
		runner,
		signal,
	}: WorkerConfig<JobPayload>) {
		this.concurrency = concurrency
		this.jobFields = jobFields ?? emptyJobFields
		this.logger = logger ?? rootLogger.child({ component: "worker" })
		this.registry = registry
		this.runner = runner
		this.signal = signal
	}

	start() {
		if (this.signal.aborted) return
		this.logger.debug({ concurrency: this.concurrency }, "worker started")
		for (let i = 0; i < this.concurrency; i++) {
			void this.pollJobFromRegistry(i)
		}
	}

	private async pollJobFromRegistry(workerId: number) {
		while (!this.signal.aborted) {
			const job = await this.registry.nextJob(this.signal)
			if (!job) {
				return
			}

			const startedAt = Date.now()
			const fields = {
				...this.jobFields(job),
				jobId: job.id,
				workerId,
			}
			this.logger.debug(fields, "job execution started")

			try {
				await this.runner.execute(job)
				this.logger.debug(
					{ ...fields, durationMs: Date.now() - startedAt },
					"job execution completed",
				)
			} catch (err) {
				this.logger.error(
					{ ...fields, durationMs: Date.now() - startedAt, err },
					"job execution failed",
				)
			} finally {
				this.registry.markJobAsCompleted(job)
			}
		}
	}
}

function emptyJobFields<JobPayload>(_job: Job<JobPayload>): Record<string, unknown> {
	return {}
}
