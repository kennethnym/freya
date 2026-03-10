/**
 * Provides context values reactively and on-demand.
 *
 * Implementations push updates when values change (reactive) and
 * return current values when requested (for manual refresh).
 *
 * @example
 * ```ts
 * class LocationProvider implements ContextProvider<Location> {
 *   readonly key = LocationKey
 *
 *   onUpdate(callback: (value: Location) => void): () => void {
 *     const watchId = navigator.geolocation.watchPosition(pos => {
 *       callback({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
 *     })
 *     return () => navigator.geolocation.clearWatch(watchId)
 *   }
 *
 *   async fetchCurrentValue(): Promise<Location> {
 *     const pos = await getCurrentPosition()
 *     return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
 *   }
 * }
 * ```
 */
export interface ContextProvider<T = unknown> {
	/** The context key this provider populates */
	readonly key: string

	/** Subscribe to value changes. Returns cleanup function. */
	onUpdate(callback: (value: T) => void): () => void

	/** Fetch current value on-demand (used for manual refresh). */
	fetchCurrentValue(): Promise<T>
}
