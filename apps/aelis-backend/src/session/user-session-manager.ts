import type { FeedSource } from "@aelis/core"

import type { Database } from "../db/index.ts"
import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"
import type { FeedSourceProvider } from "./feed-source-provider.ts"

import { sources } from "../sources/user-sources.ts"
import { UserSession } from "./user-session.ts"

export interface UserSessionManagerConfig {
	db: Database
	providers: FeedSourceProvider[]
	feedEnhancer?: FeedEnhancer | null
}

export class UserSessionManager {
	private sessions = new Map<string, UserSession>()
	private pending = new Map<string, Promise<UserSession>>()
	private readonly db: Database
	private readonly providers = new Map<string, FeedSourceProvider>()
	private readonly feedEnhancer: FeedEnhancer | null

	constructor(config: UserSessionManagerConfig) {
		this.db = config.db
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
	 * For each active session, queries the user's source config from the DB
	 * and re-resolves the source. If the provider fails for a user, the
	 * existing source is kept.
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
			updates.push(this.refreshSessionSource(session, provider))
		}

		// Also update sessions that are currently being created so they
		// don't land in this.sessions with a stale source.
		for (const [, pendingPromise] of this.pending) {
			updates.push(
				pendingPromise
					.then((session) => this.refreshSessionSource(session, provider))
					.catch(() => {
						// Session creation itself failed — nothing to update.
					}),
			)
		}

		await Promise.all(updates)
	}

	/**
	 * Re-resolves a single source for a session by querying the user's config
	 * from the DB and calling the provider. If the provider fails, the existing
	 * source is kept.
	 */
	private async refreshSessionSource(
		session: UserSession,
		provider: FeedSourceProvider,
	): Promise<void> {
		if (!session.hasSource(provider.sourceId)) return

		try {
			const row = await sources(this.db, session.userId).find(provider.sourceId)
			if (!row?.enabled) return

			const newSource = await provider.feedSourceForUser(session.userId, row.config ?? {})
			session.replaceSource(provider.sourceId, newSource)
		} catch (err) {
			console.error(
				`[UserSessionManager] refreshSource("${provider.sourceId}") failed for user ${session.userId}:`,
				err,
			)
		}
	}

	private async createSession(userId: string): Promise<UserSession> {
		const enabledRows = await sources(this.db, userId).enabled()

		const promises: Promise<FeedSource>[] = []
		for (const row of enabledRows) {
			const provider = this.providers.get(row.sourceId)
			if (provider) {
				promises.push(provider.feedSourceForUser(userId, row.config ?? {}))
			}
		}

		if (promises.length === 0) {
			return new UserSession(userId, [], this.feedEnhancer)
		}

		const results = await Promise.allSettled(promises)

		const feedSources: FeedSource[] = []
		const errors: unknown[] = []

		for (const result of results) {
			if (result.status === "fulfilled") {
				feedSources.push(result.value)
			} else {
				errors.push(result.reason)
			}
		}

		if (feedSources.length === 0 && errors.length > 0) {
			throw new AggregateError(errors, "All feed source providers failed")
		}

		for (const error of errors) {
			console.error("[UserSessionManager] Feed source provider failed:", error)
		}

		return new UserSession(userId, feedSources, this.feedEnhancer)
	}
}
