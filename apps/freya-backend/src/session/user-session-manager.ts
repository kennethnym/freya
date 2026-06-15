import type { FeedSource } from "@freya/core"

import { type } from "arktype"
import merge from "lodash.merge"

import type { Database } from "../db/index.ts"
import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"
import type { CredentialEncryptor } from "../lib/crypto.ts"
import type { FeedSourceProvider } from "./feed-source-provider.ts"

import {
	CredentialStorageUnavailableError,
	InvalidSourceConfigError,
	SourceNotFoundError,
} from "../sources/errors.ts"
import { sources } from "../sources/user-sources.ts"
import { UserSession, type UserSessionAgentConfig } from "./user-session.ts"

export interface UserSessionManagerConfig {
	db: Database
	providers: FeedSourceProvider[]
	feedEnhancer?: FeedEnhancer | null
	credentialEncryptor?: CredentialEncryptor | null
	queryAgent?: UserSessionAgentConfig
}

export class UserSessionManager {
	private sessions = new Map<string, UserSession>()
	private pending = new Map<string, Promise<UserSession>>()
	private readonly db: Database
	private readonly providers = new Map<string, FeedSourceProvider>()
	private readonly feedEnhancer: FeedEnhancer | null
	private readonly encryptor: CredentialEncryptor | null
	private readonly queryAgentConfig: UserSessionAgentConfig | undefined

	constructor(config: UserSessionManagerConfig) {
		this.db = config.db
		for (const provider of config.providers) {
			this.providers.set(provider.sourceId, provider)
		}
		this.feedEnhancer = config.feedEnhancer ?? null
		this.encryptor = config.credentialEncryptor ?? null
		this.queryAgentConfig = config.queryAgent
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

	dispose(): void {
		for (const session of this.sessions.values()) {
			session.destroy()
		}
		this.sessions.clear()
		this.pending.clear()
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

		// Use a transaction with SELECT FOR UPDATE to prevent lost updates
		// when concurrent PATCH requests merge config against the same base.
		const { existingRow, mergedConfig } = await this.db.transaction(async (tx) => {
			const existingRow = await sources(tx, userId).findForUpdate(sourceId)

			let mergedConfig: Record<string, unknown> | undefined
			if (update.config !== undefined && provider.configSchema) {
				const existingConfig = (existingRow?.config ?? {}) as Record<string, unknown>
				mergedConfig = merge({}, existingConfig, update.config)

				const validated = provider.configSchema(mergedConfig)
				if (validated instanceof type.errors) {
					throw new InvalidSourceConfigError(sourceId, validated.summary)
				}
			}

			// Throws SourceNotFoundError if the row doesn't exist
			await sources(tx, userId).updateConfig(sourceId, {
				enabled: update.enabled,
				config: mergedConfig,
			})

			return { existingRow, mergedConfig }
		})

		// Refresh the specific source in the active session instead of
		// destroying the entire session.
		const session = this.sessions.get(userId)
		if (session) {
			if (update.enabled === false) {
				session.removeSource(sourceId)
			} else {
				const credentials = existingRow?.credentials
					? this.decryptCredentials(existingRow.credentials)
					: null
				const source = await provider.feedSourceForUser(userId, mergedConfig ?? {}, credentials)
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
	 * When `credentials` is provided, they are encrypted and persisted
	 * alongside the config in the same flow, avoiding the race condition
	 * of separate config + credential requests.
	 *
	 * @throws {SourceNotFoundError} if the sourceId has no registered provider
	 * @throws {InvalidSourceConfigError} if config fails schema validation
	 * @throws {CredentialStorageUnavailableError} if credentials are provided but no encryptor is configured
	 */
	async saveSourceConfig(
		userId: string,
		sourceId: string,
		data: { enabled: boolean; config?: unknown; credentials?: unknown },
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

		if (data.credentials !== undefined && !this.encryptor) {
			throw new CredentialStorageUnavailableError()
		}

		const config = data.config ?? {}

		// Run the upsert + credential update atomically so a failure in
		// either step doesn't leave the row in an inconsistent state.
		const existingRow = await this.db.transaction(async (tx) => {
			const existing = await sources(tx, userId).find(sourceId)

			await sources(tx, userId).upsertConfig(sourceId, {
				enabled: data.enabled,
				config,
			})

			if (data.credentials !== undefined && this.encryptor) {
				const encrypted = this.encryptor.encrypt(JSON.stringify(data.credentials))
				await sources(tx, userId).updateCredentials(sourceId, encrypted)
			}

			return existing
		})

		const session = this.sessions.get(userId)
		if (session) {
			if (!data.enabled) {
				session.removeSource(sourceId)
			} else {
				// Prefer the just-provided credentials over what was in the DB.
				let credentials: unknown = null
				if (data.credentials !== undefined) {
					credentials = data.credentials
				} else if (existingRow?.credentials) {
					credentials = this.decryptCredentials(existingRow.credentials)
				}
				const source = await provider.feedSourceForUser(userId, config, credentials)
				if (session.hasSource(sourceId)) {
					session.replaceSource(sourceId, source)
				} else {
					session.addSource(source)
				}
			}
		}
	}

	/**
	 * Validates, encrypts, and persists per-user credentials for a source,
	 * then refreshes the active session.
	 *
	 * @throws {SourceNotFoundError} if the source row doesn't exist or has no registered provider
	 * @throws {CredentialStorageUnavailableError} if no CredentialEncryptor is configured
	 */
	async updateSourceCredentials(
		userId: string,
		sourceId: string,
		credentials: unknown,
	): Promise<void> {
		const provider = this.providers.get(sourceId)
		if (!provider) {
			throw new SourceNotFoundError(sourceId, userId)
		}

		if (!this.encryptor) {
			throw new CredentialStorageUnavailableError()
		}

		const encrypted = this.encryptor.encrypt(JSON.stringify(credentials))
		await sources(this.db, userId).updateCredentials(sourceId, encrypted)

		// Refresh the source in the active session.
		// If feedSourceForUser throws (e.g. provider rejects the credentials),
		// the DB already has the new credentials but the session keeps the old
		// source. The next session creation will pick up the persisted credentials.
		const session = this.sessions.get(userId)
		if (session && session.hasSource(sourceId)) {
			const row = await sources(this.db, userId).find(sourceId)
			if (row?.enabled) {
				const source = await provider.feedSourceForUser(userId, row.config ?? {}, credentials)
				session.replaceSource(sourceId, source)
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

			const credentials = row.credentials ? this.decryptCredentials(row.credentials) : null
			const newSource = await provider.feedSourceForUser(
				session.userId,
				row.config ?? {},
				credentials,
			)
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
				const credentials = row.credentials ? this.decryptCredentials(row.credentials) : null
				promises.push(provider.feedSourceForUser(userId, row.config ?? {}, credentials))
			}
		}

		if (promises.length === 0) {
			return new UserSession(userId, [], this.feedEnhancer, this.queryAgentConfig)
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

		return new UserSession(userId, feedSources, this.feedEnhancer, this.queryAgentConfig)
	}

	/**
	 * Decrypts a credentials buffer from the DB, returning parsed JSON or null.
	 * Returns null (with a warning) if decryption or parsing fails — e.g. due to
	 * key rotation, data corruption, or malformed JSON.
	 */
	private decryptCredentials(credentials: Buffer): unknown {
		if (!this.encryptor) return null
		try {
			return JSON.parse(this.encryptor.decrypt(credentials))
		} catch (err) {
			console.warn("[UserSessionManager] Failed to decrypt credentials:", err)
			return null
		}
	}
}
