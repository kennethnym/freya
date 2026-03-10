import type { Context } from "./context"
import type { DataSource } from "./data-source"
import type { FeedItem } from "./feed"

export interface ReconcilerConfig {
	timeout?: number
}

export interface SourceError {
	sourceType: string
	error: Error
}

export interface ReconcileResult<TItem extends FeedItem = FeedItem> {
	items: TItem[]
	errors: SourceError[]
}

interface RegisteredSource {
	source: DataSource<FeedItem, unknown>
	config: unknown
}

const DEFAULT_TIMEOUT = 5000

export class Reconciler<TItems extends FeedItem = never> {
	private sources = new Map<string, RegisteredSource>()
	private timeout: number

	constructor(config?: ReconcilerConfig) {
		this.timeout = config?.timeout ?? DEFAULT_TIMEOUT
	}

	register<TItem extends FeedItem, TConfig>(
		source: DataSource<TItem, TConfig>,
		config?: TConfig,
	): Reconciler<TItems | TItem> {
		this.sources.set(source.type, {
			source: source as DataSource<FeedItem, unknown>,
			config,
		})
		return this as Reconciler<TItems | TItem>
	}

	unregister<T extends TItems["type"]>(sourceType: T): Reconciler<Exclude<TItems, { type: T }>> {
		this.sources.delete(sourceType)
		return this as unknown as Reconciler<Exclude<TItems, { type: T }>>
	}

	async reconcile(context: Context): Promise<ReconcileResult<TItems>> {
		const entries = Array.from(this.sources.values())

		const results = await Promise.allSettled(
			entries.map(({ source, config }) =>
				withTimeout(source.query(context, config), this.timeout, source.type),
			),
		)

		const items: FeedItem[] = []
		const errors: SourceError[] = []

		results.forEach((result, i) => {
			const sourceType = entries[i]!.source.type

			if (result.status === "fulfilled") {
				items.push(...result.value)
			} else {
				errors.push({
					sourceType,
					error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
				})
			}
		})

		return { items, errors } as ReconcileResult<TItems>
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number, sourceType: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Source "${sourceType}" timed out after ${ms}ms`)), ms),
		),
	])
}
