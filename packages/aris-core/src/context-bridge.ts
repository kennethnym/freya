import type { ContextEntry } from "./context"
import type { ContextProvider } from "./context-provider"

import { contextKey } from "./context"

interface ContextUpdatable {
	pushContextUpdate(entries: readonly ContextEntry[]): void
}

export interface ProviderError {
	key: string
	error: Error
}

export interface RefreshResult {
	errors: ProviderError[]
}

/**
 * Bridges context providers to a feed controller.
 *
 * Subscribes to provider updates and forwards them to the controller.
 * Supports manual refresh to gather current values from all providers.
 *
 * @example
 * ```ts
 * const controller = new FeedController()
 *   .addDataSource(new WeatherDataSource())
 *   .addDataSource(new TflDataSource())
 *
 * const bridge = new ContextBridge(controller)
 *   .addProvider(new LocationProvider())
 *   .addProvider(new MusicProvider())
 *
 * // Manual refresh gathers from all providers
 * await bridge.refresh()
 *
 * // Cleanup
 * bridge.stop()
 * controller.stop()
 * ```
 */
export class ContextBridge {
	private controller: ContextUpdatable
	private providers = new Map<string, ContextProvider>()
	private cleanups: Array<() => void> = []

	constructor(controller: ContextUpdatable) {
		this.controller = controller
	}

	/**
	 * Registers a context provider. Immediately subscribes to updates.
	 */
	addProvider<T>(provider: ContextProvider<T>): this {
		this.providers.set(provider.key, provider as ContextProvider)

		const cleanup = provider.onUpdate((value) => {
			this.controller.pushContextUpdate([[contextKey(provider.key), value]])
		})
		this.cleanups.push(cleanup)

		return this
	}

	/**
	 * Gathers current values from all providers and pushes to controller.
	 * Use for manual refresh when user pulls to refresh.
	 * Returns errors from providers that failed to fetch.
	 */
	async refresh(): Promise<RefreshResult> {
		const collected: ContextEntry[] = []
		const errors: ProviderError[] = []

		const entries = Array.from(this.providers.entries())
		const results = await Promise.allSettled(
			entries.map(([_, provider]) => provider.fetchCurrentValue()),
		)

		entries.forEach(([key], i) => {
			const result = results[i]
			if (result?.status === "fulfilled") {
				collected.push([contextKey(key), result.value])
			} else if (result?.status === "rejected") {
				errors.push({
					key,
					error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
				})
			}
		})

		this.controller.pushContextUpdate(collected)

		return { errors }
	}

	/**
	 * Unsubscribes from all providers.
	 */
	stop(): void {
		this.cleanups.forEach((cleanup) => cleanup())
		this.cleanups = []
	}
}
