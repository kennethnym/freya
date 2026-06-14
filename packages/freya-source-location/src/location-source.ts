import type { ActionDefinition, ContextEntry, FeedSource } from "@freya/core"

import { Context, UnknownActionError, contextKey, type ContextKey } from "@freya/core"
import { type } from "arktype"

import { Location, type LocationSourceOptions } from "./types.ts"

/**
 * A FeedSource that provides location context.
 *
 * This source accepts external location pushes and does not query location itself.
 * Use `pushLocation` to update the location from an external provider (e.g., GPS, network).
 *
 * Does not produce feed items - always returns empty array from `fetchItems`.
 */
export class LocationSource implements FeedSource {
	static readonly id = "freya.location"

	readonly id = LocationSource.id

	private readonly historySize: number
	private locations: Location[] = []
	private listeners = new Set<(entries: readonly ContextEntry[]) => void>()

	constructor(options: LocationSourceOptions = {}) {
		this.historySize = options.historySize ?? 1
	}

	async listActions(): Promise<Record<string, ActionDefinition>> {
		return {
			"update-location": {
				id: "update-location",
				description: "Push a new location update",
				input: Location,
			},
		}
	}

	async executeAction(actionId: string, params: unknown): Promise<void> {
		switch (actionId) {
			case "update-location": {
				const result = Location(params)
				if (result instanceof type.errors) {
					throw new Error(result.summary)
				}
				this.pushLocation(result)
				return
			}
			default:
				throw new UnknownActionError(actionId)
		}
	}

	/**
	 * Push a new location update. Notifies all context listeners.
	 */
	pushLocation(location: Location): void {
		this.locations.push(location)
		if (this.locations.length > this.historySize) {
			this.locations.shift()
		}
		const entries: readonly ContextEntry[] = [[LocationKey, location]]
		this.listeners.forEach((listener) => {
			listener(entries)
		})
	}

	/**
	 * Most recent location, or null if none pushed.
	 */
	get lastLocation(): Location | null {
		return this.locations[this.locations.length - 1] ?? null
	}

	/**
	 * Location history, oldest first. Length limited by `historySize`.
	 */
	get locationHistory(): readonly Location[] {
		return this.locations
	}

	onContextUpdate(callback: (entries: readonly ContextEntry[]) => void): () => void {
		this.listeners.add(callback)
		return () => {
			this.listeners.delete(callback)
		}
	}

	async fetchContext(): Promise<readonly ContextEntry[] | null> {
		if (this.lastLocation) {
			return [[LocationKey, this.lastLocation]]
		}
		return null
	}

	async fetchItems(): Promise<[]> {
		return []
	}
}

export const LocationKey: ContextKey<Location> = contextKey(LocationSource.id, "location")
