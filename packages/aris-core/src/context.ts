/**
 * Tuple-keyed context system inspired by React Query's query keys.
 *
 * Context keys are arrays that form a hierarchy. Sources write to specific
 * keys (e.g., ["aris.google-calendar", "nextEvent", { account: "work" }])
 * and consumers can query by exact match or prefix match to get all values
 * of a given type across source instances.
 */

// -- Key types --

/** A single segment of a context key: string, number, or a record of primitives. */
export type ContextKeyPart = string | number | Record<string, unknown>

/** A context key is a readonly tuple of parts, branded with the value type. */
export type ContextKey<T> = readonly ContextKeyPart[] & { __contextValue?: T }

/** Creates a typed context key. */
export function contextKey<T>(...parts: ContextKeyPart[]): ContextKey<T> {
	return parts as ContextKey<T>
}

// -- Serialization --

/**
 * Deterministic serialization of a context key for use as a Map key.
 * Object parts have their keys sorted for stable comparison.
 */
export function serializeKey(key: readonly ContextKeyPart[]): string {
	return JSON.stringify(key, (_key, value) => {
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			const sorted: Record<string, unknown> = {}
			for (const k of Object.keys(value).sort()) {
				sorted[k] = value[k]
			}
			return sorted
		}
		return value
	})
}

// -- Key matching --

/** Returns true if `key` starts with all parts of `prefix`. */
function keyStartsWith(key: readonly ContextKeyPart[], prefix: readonly ContextKeyPart[]): boolean {
	if (key.length < prefix.length) return false

	for (let i = 0; i < prefix.length; i++) {
		if (!partsEqual(key[i]!, prefix[i]!)) return false
	}

	return true
}

/** Recursive structural equality, matching React Query's partialMatchKey approach. */
function partsEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (typeof a !== typeof b) return false
	if (a && b && typeof a === "object" && typeof b === "object") {
		const aKeys = Object.keys(a)
		const bKeys = Object.keys(b)
		if (aKeys.length !== bKeys.length) return false
		return aKeys.every((key) =>
			partsEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
		)
	}
	return false
}

// -- Context store --

/** A single context entry: a key-value pair. */
export type ContextEntry<T = unknown> = readonly [ContextKey<T>, T]

/**
 * Mutable context store with tuple keys.
 *
 * Supports exact-match lookups and prefix-match queries.
 * Sources write context in topological order during refresh.
 */
export class Context {
	time: Date
	private readonly store: Map<string, { key: readonly ContextKeyPart[]; value: unknown }>

	constructor(time: Date = new Date()) {
		this.time = time
		this.store = new Map()
	}

	/** Merges entries into this context. */
	set(entries: readonly ContextEntry[]): void {
		for (const [key, value] of entries) {
			this.store.set(serializeKey(key), { key, value })
		}
	}

	/** Exact-match lookup. Returns the value for the given key, or undefined. */
	get<T>(key: ContextKey<T>): T | undefined {
		const entry = this.store.get(serializeKey(key))
		return entry?.value as T | undefined
	}

	/**
	 * Prefix-match query. Returns all entries whose key starts with the given prefix.
	 *
	 * @example
	 * ```ts
	 * // Get all "nextEvent" values across calendar source instances
	 * const events = context.find(contextKey("nextEvent"))
	 * ```
	 */
	find<T>(prefix: ContextKey<T>): Array<{ key: readonly ContextKeyPart[]; value: T }> {
		const results: Array<{ key: readonly ContextKeyPart[]; value: T }> = []

		for (const entry of this.store.values()) {
			if (keyStartsWith(entry.key, prefix)) {
				results.push({ key: entry.key, value: entry.value as T })
			}
		}

		return results
	}

	/** Returns the number of entries (excluding time). */
	get size(): number {
		return this.store.size
	}
}
