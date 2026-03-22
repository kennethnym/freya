import type { FeedSource } from "@aelis/core"

import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"
import type { FeedSourceProvider } from "./feed-source-provider.ts"

import { UserSession } from "./user-session.ts"

export interface UserSessionManagerConfig {
	providers: FeedSourceProvider[]
	feedEnhancer?: FeedEnhancer | null
}

export class UserSessionManager {
	private sessions = new Map<string, UserSession>()
	private pending = new Map<string, Promise<UserSession>>()
	private readonly providers = new Map<string, FeedSourceProvider>()
	private readonly feedEnhancer: FeedEnhancer | null

	constructor(config: UserSessionManagerConfig) {
		for (const provider of config.providers) {
			this.providers.set(provider.sourceId, provider)
		}
		this.feedEnhancer = config.feedEnhancer ?? null
	}

	getProvider(sourceId: string): FeedSourceProvider | undefined {
		return this.providers.get(sourceId)
	}

	async getOrCreate(userId: string): Promise<UserSession> {
		const existing = this.sessions.get(userId)
		if (existing) return existing

		const inflight = this.pending.get(userId)
		if (inflight) return inflight

		const promise = this.createSession(userId)
		this.pending.set(userId, promise)
		try {
			const session = await promise
			// If remove() was called while we were awaiting, it clears the
			// pending entry. Detect that and destroy the session immediately.
			if (!this.pending.has(userId)) {
				session.destroy()
				throw new Error(`Session for user ${userId} was removed during creation`)
			}
			this.sessions.set(userId, session)
			return session
		} finally {
			this.pending.delete(userId)
		}
	}

	remove(userId: string): void {
		const session = this.sessions.get(userId)
		if (session) {
			session.destroy()
			this.sessions.delete(userId)
		}
		// Cancel any in-flight creation so getOrCreate won't store the session
		this.pending.delete(userId)
	}

	/**
	 * Replaces a provider and updates all active sessions.
	 * The new provider must have the same sourceId as an existing one.
	 * For each active session, re-resolves the source via session.refreshSource.
	 * If the provider fails for a user, the existing source is kept.
	 */
	async replaceProvider(provider: FeedSourceProvider): Promise<void> {
		if (!this.providers.has(provider.sourceId)) {
			throw new Error(
				`Cannot replace provider "${provider.sourceId}": no existing provider with that sourceId`,
			)
		}

		this.providers.set(provider.sourceId, provider)

		const updates: Promise<void>[] = []

		for (const [, session] of this.sessions) {
			updates.push(session.refreshSource(provider))
		}

		// Also update sessions that are currently being created so they
		// don't land in this.sessions with a stale source.
		for (const [, pendingPromise] of this.pending) {
			updates.push(
				pendingPromise
					.then((session) => session.refreshSource(provider))
					.catch(() => {
						// Session creation itself failed — nothing to update.
					}),
			)
		}

		await Promise.all(updates)
	}

	private async createSession(userId: string): Promise<UserSession> {
		const results = await Promise.allSettled(
			Array.from(this.providers.values()).map((p) => p.feedSourceForUser(userId)),
		)

		const sources: FeedSource[] = []
		const errors: unknown[] = []

		for (const result of results) {
			if (result.status === "fulfilled") {
				sources.push(result.value)
			} else {
				errors.push(result.reason)
			}
		}

		if (sources.length === 0 && errors.length > 0) {
			throw new AggregateError(errors, "All feed source providers failed")
		}

		for (const error of errors) {
			console.error("[UserSessionManager] Feed source provider failed:", error)
		}

		return new UserSession(userId, sources, this.feedEnhancer)
	}
}
