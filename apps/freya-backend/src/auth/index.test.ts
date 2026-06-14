import { afterEach, describe, expect, test } from "bun:test"

import type { Database } from "../db/index.ts"

import { DEFAULT_ENABLED_SOURCE_IDS } from "../sources/default-sources.ts"
import { createAuth } from "./index.ts"

interface UserSourceInsertRow {
	sourceId: string
}

interface RecordingDb {
	db: Database
	rows: () => UserSourceInsertRow[] | undefined
}

const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET

function createRecordingDb(): RecordingDb {
	let insertedRows: UserSourceInsertRow[] | undefined

	const db = {
		insert() {
			return {
				values(rows: UserSourceInsertRow[]) {
					insertedRows = rows

					return {
						async onConflictDoNothing() {},
					}
				},
			}
		},
	} as unknown as Database

	return {
		db,
		rows: () => insertedRows,
	}
}

afterEach(() => {
	if (originalBetterAuthSecret === undefined) {
		delete process.env.BETTER_AUTH_SECRET
		return
	}

	process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret
})

describe("createAuth", () => {
	test("inserts default sources after Better Auth creates a user", async () => {
		process.env.BETTER_AUTH_SECRET = "test-secret"
		const recording = createRecordingDb()
		const auth = createAuth(recording.db)
		const afterCreateUser = auth.options.databaseHooks?.user?.create?.after

		if (!afterCreateUser) {
			throw new Error("Expected a user create after hook")
		}

		const now = new Date()
		await afterCreateUser(
			{
				id: "user-1",
				name: "Test User",
				email: "test@example.com",
				emailVerified: false,
				image: null,
				createdAt: now,
				updatedAt: now,
			},
			null,
		)

		const rows = recording.rows()
		if (!rows) {
			throw new Error("Expected the auth hook to insert default sources")
		}

		expect(rows.map((row) => row.sourceId)).toEqual([...DEFAULT_ENABLED_SOURCE_IDS])
	})
})
