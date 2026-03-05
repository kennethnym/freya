import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"
import type { FeedSourceProviderInput } from "./feed-source-provider.ts"

import { UserSession } from "./user-session.ts"

export interface UserSessionManagerConfig {
	providers: FeedSourceProviderInput[]
	feedEnhancer?: FeedEnhancer | null
}

export class UserSessionManager {
	private sessions = new Map<string, UserSession>()
	private readonly providers: FeedSourceProviderInput[]
	private readonly feedEnhancer: FeedEnhancer | null

	constructor(config: UserSessionManagerConfig) {
		this.providers = config.providers
		this.feedEnhancer = config.feedEnhancer ?? null
	}

	getOrCreate(userId: string): UserSession {
		let session = this.sessions.get(userId)
		if (!session) {
			const sources = this.providers.map((p) =>
				typeof p === "function" ? p(userId) : p.feedSourceForUser(userId),
			)
			session = new UserSession(sources, this.feedEnhancer)
			this.sessions.set(userId, session)
		}
		return session
	}

	remove(userId: string): void {
		const session = this.sessions.get(userId)
		if (session) {
			session.destroy()
			this.sessions.delete(userId)
		}
	}
}
