import type { FeedSource } from "@aelis/core"

import { type } from "arktype"
import merge from "lodash.merge"

import type { Database } from "../db/index.ts"
import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"
import type { FeedSourceProvider } from "./feed-source-provider.ts"

import { InvalidSourceConfigError, SourceNotFoundError } from "../sources/errors.ts"
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
	private readonly db: Database

	constructor(config: UserSessionManagerConfig) {
		this.db = config.db
		for (const provider of config.providers) {
			this.providers.set(provider.sourceId, provider)
		}
		this.feedEnhancer = config.feedEnhancer ?? null
		this.db = config.db
	}

	getProvider(sourceId: string): FeedSourceProvider | undefined {
		return this.providers.get(sourceId)
	}

	/**
	 * Returns the user's config for a source, or defaults if no row exists.
	 *
	 * @throws {SourceNotFoundError} if the sourceId has no registered provider
	 */
	async fetchSourceConfig(
		userId: string,
		sourceId: string,
	): Promise<{ enabled: boolean; config: unknown }> {
		const provider = this.providers.get(sourceId)
		if (!provider) {
			throw new SourceNotFoundError(sourceId, userId)
		}

		const row = await sources(this.db, userId).find(sourceId)
		return {
			enabled: row?.enabled ?? false,
			config: row?.config ?? {},
		}
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
	 * Merges, validates, and persists a user's source config and/or enabled
	 * state, then invalidates the cached session.
	 *
	 * @throws {SourceNotFoundError} if the source row doesn't exist
	 * @throws {InvalidSourceConfigError} if the merged config fails schema validation
	 */
	async updateSourceConfig(
		userId: string,
		sourceId: string,
		update: { enabled?: boolean; config?: unknown },
	): Promise<void> {
		const provider = this.providers.get(sourceId)
		if (!provider) {
			throw new SourceNotFoundError(sourceId, userId)
		}

		// Nothing to update
		if (update.enabled === undefined && update.config === undefined) {
			// Still validate existence — updateConfig would throw, but
			// we can avoid the DB write entirely.
			if (!(await sources(this.db, userId).find(sourceId))) {
				throw new SourceNotFoundError(sourceId, userId)
			}
			return
		}

		// When config is provided, fetch existing to deep-merge before validating.
		// NOTE: find + updateConfig is not atomic. A concurrent update could
		// read stale config. Use SELECT FOR UPDATE or atomic jsonb merge if
		// this becomes a problem.
		let mergedConfig: Record<string, unknown> | undefined
		if (update.config !== undefined && provider.configSchema) {
			const existing = await sources(this.db, userId).find(sourceId)
			const existingConfig = (existing?.config ?? {}) as Record<string, unknown>
			mergedConfig = merge({}, existingConfig, update.config)

			const validated = provider.configSchema(mergedConfig)
			if (validated instanceof type.errors) {
				throw new InvalidSourceConfigError(sourceId, validated.summary)
			}
		}

		// Throws SourceNotFoundError if the row doesn't exist
		await sources(this.db, userId).updateConfig(sourceId, {
			enabled: update.enabled,
			config: mergedConfig,
		})

		// Refresh the specific source in the active session instead of
		// destroying the entire session.
		const session = this.sessions.get(userId)
		if (session) {
			if (update.enabled === false) {
				session.removeSource(sourceId)
			} else {
				const source = await provider.feedSourceForUser(userId, mergedConfig ?? {})
				session.replaceSource(sourceId, source)
			}
		}
	}

	/**
	 * Validates, persists, and upserts a user's source config, then
	 * refreshes the cached session. Unlike updateSourceConfig, this
	 * inserts a new row if one doesn't exist and fully replaces config
	 * (no merge).
	 *
	 * @throws {SourceNotFoundError} if the sourceId has no registered provider
	 * @throws {InvalidSourceConfigError} if config fails schema validation
	 */
	async upsertSourceConfig(
		userId: string,
		sourceId: string,
		data: { enabled: boolean; config?: unknown },
	): Promise<void> {
		const provider = this.providers.get(sourceId)
		if (!provider) {
			throw new SourceNotFoundError(sourceId, userId)
		}

		if (provider.configSchema && data.config !== undefined) {
			const validated = provider.configSchema(data.config)
			if (validated instanceof type.errors) {
				throw new InvalidSourceConfigError(sourceId, validated.summary)
			}
		}

		const config = data.config ?? {}
		await sources(this.db, userId).upsertConfig(sourceId, {
			enabled: data.enabled,
			config,
		})

		const session = this.sessions.get(userId)
		if (session) {
			if (!data.enabled) {
				session.removeSource(sourceId)
			} else {
				const source = await provider.feedSourceForUser(userId, config)
				if (session.hasSource(sourceId)) {
					session.replaceSource(sourceId, source)
				} else {
					session.addSource(source)
				}
			}
		}
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
