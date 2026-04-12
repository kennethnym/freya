import { and, eq } from "drizzle-orm"

import type { Database } from "../db/index.ts"

import { userSources } from "../db/schema.ts"
import { SourceNotFoundError } from "./errors.ts"

export function sources(db: Database, userId: string) {
	return {
		/** Returns all enabled sources for the user. */
		async enabled() {
			return db
				.select()
				.from(userSources)
				.where(and(eq(userSources.userId, userId), eq(userSources.enabled, true)))
		},

		/** Returns a specific source by ID, or undefined. */
		async find(sourceId: string) {
			const rows = await db
				.select()
				.from(userSources)
				.where(and(eq(userSources.userId, userId), eq(userSources.sourceId, sourceId)))
				.limit(1)

			return rows[0]
		},

		/** Like find(), but acquires a row lock to prevent concurrent modifications. Must be called inside a transaction. */
		async findForUpdate(sourceId: string) {
			const rows = await db
				.select()
				.from(userSources)
				.where(and(eq(userSources.userId, userId), eq(userSources.sourceId, sourceId)))
				.limit(1)
				.for("update")

			return rows[0]
		},

		/** Enables a source for the user. Throws if the source row doesn't exist. */
		async enableSource(sourceId: string) {
			const rows = await db
				.update(userSources)
				.set({ enabled: true, updatedAt: new Date() })
				.where(and(eq(userSources.userId, userId), eq(userSources.sourceId, sourceId)))
				.returning({ id: userSources.id })

			if (rows.length === 0) {
				throw new SourceNotFoundError(sourceId, userId)
			}
		},

		/** Disables a source for the user. Throws if the source row doesn't exist. */
		async disableSource(sourceId: string) {
			const rows = await db
				.update(userSources)
				.set({ enabled: false, updatedAt: new Date() })
				.where(and(eq(userSources.userId, userId), eq(userSources.sourceId, sourceId)))
				.returning({ id: userSources.id })

			if (rows.length === 0) {
				throw new SourceNotFoundError(sourceId, userId)
			}
		},

		/** Updates an existing user source row. Throws if the row doesn't exist. */
		async updateConfig(sourceId: string, update: { enabled?: boolean; config?: unknown }) {
			const set: Record<string, unknown> = { updatedAt: new Date() }
			if (update.enabled !== undefined) {
				set.enabled = update.enabled
			}
			if (update.config !== undefined) {
				set.config = update.config
			}
			const rows = await db
				.update(userSources)
				.set(set)
				.where(and(eq(userSources.userId, userId), eq(userSources.sourceId, sourceId)))
				.returning({ id: userSources.id })

			if (rows.length === 0) {
				throw new SourceNotFoundError(sourceId, userId)
			}
		},

		/** Inserts a new user source row or fully replaces enabled/config on an existing one. */
		async upsertConfig(sourceId: string, data: { enabled: boolean; config: unknown }) {
			const now = new Date()
			await db
				.insert(userSources)
				.values({
					userId,
					sourceId,
					enabled: data.enabled,
					config: data.config,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [userSources.userId, userSources.sourceId],
					set: {
						enabled: data.enabled,
						config: data.config,
						updatedAt: now,
					},
				})
		},

		/** Updates the encrypted credentials for a source. Throws if the source row doesn't exist. */
		async updateCredentials(sourceId: string, credentials: Buffer) {
			const rows = await db
				.update(userSources)
				.set({ credentials, updatedAt: new Date() })
				.where(and(eq(userSources.userId, userId), eq(userSources.sourceId, sourceId)))
				.returning({ id: userSources.id })

			if (rows.length === 0) {
				throw new SourceNotFoundError(sourceId, userId)
			}
		},
	}
}
