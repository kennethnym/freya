import type { FeedSource } from "@aelis/core"

import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"
import type { FeedSourceProviderInput } from "./feed-source-provider.ts"

import { UserSession } from "./user-session.ts"

export interface UserSessionManagerConfig {
	providers: FeedSourceProviderInput[]
	feedEnhancer?: FeedEnhancer | null
}

export class UserSessionManager {
	private sessions = new Map<string, UserSession>()
	private pending = new Map<string, Promise<UserSession>>()
	private readonly providers: FeedSourceProviderInput[]
	private readonly feedEnhancer: FeedEnhancer | null

	constructor(config: UserSessionManagerConfig) {
		this.providers = config.providers
		this.feedEnhancer = config.feedEnhancer ?? null
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
	}

	private async createSession(userId: string): Promise<UserSession> {
		const results = await Promise.allSettled(
			this.providers.map((p) =>
				typeof p === "function" ? p(userId) : p.feedSourceForUser(userId),
			),
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

		return new UserSession(sources, this.feedEnhancer)
	}
}
