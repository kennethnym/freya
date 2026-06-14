import { LocationSource } from "@freya/source-location"
import { ReminderSource } from "@freya/source-reminders"
import { WebSearchSource } from "@freya/source-web-search"
import { describe, expect, test } from "bun:test"

import type { Database } from "../db/index.ts"

import { userSources } from "../db/schema.ts"
import { DEFAULT_ENABLED_SOURCE_IDS, insertDefaultUserSources } from "./default-sources.ts"

interface UserSourceInsertRow {
	userId: string
	sourceId: string
	enabled: boolean
	config: unknown
	createdAt: Date
	updatedAt: Date
}

interface RecordingDb {
	db: Database
	table: () => unknown
	rows: () => UserSourceInsertRow[] | undefined
	conflictTarget: () => readonly unknown[] | undefined
}

function createRecordingDb(): RecordingDb {
	let insertedTable: unknown
	let insertedRows: UserSourceInsertRow[] | undefined
	let target: readonly unknown[] | undefined

	const db = {
		insert(table: unknown) {
			insertedTable = table

			return {
				values(rows: UserSourceInsertRow[]) {
					insertedRows = rows

					return {
						async onConflictDoNothing(options: { target: readonly unknown[] }) {
							target = options.target
						},
					}
				},
			}
		},
	} as unknown as Database

	return {
		db,
		table: () => insertedTable,
		rows: () => insertedRows,
		conflictTarget: () => target,
	}
}

describe("default user sources", () => {
	test("defines default enabled sources", () => {
		expect(DEFAULT_ENABLED_SOURCE_IDS).toEqual([
			LocationSource.id,
			ReminderSource.id,
			WebSearchSource.id,
		])
	})

	test("inserts default enabled source rows for a user", async () => {
		const recording = createRecordingDb()

		await insertDefaultUserSources(recording.db, "user-1")

		const rows = recording.rows()
		if (!rows) {
			throw new Error("Expected default source rows to be inserted")
		}

		expect(recording.table()).toBe(userSources)
		expect(rows).toHaveLength(3)
		expect(rows.map((row) => row.sourceId)).toEqual([...DEFAULT_ENABLED_SOURCE_IDS])
		expect(recording.conflictTarget()).toEqual([userSources.userId, userSources.sourceId])

		for (const row of rows) {
			expect(row.userId).toBe("user-1")
			expect(row.enabled).toBe(true)
			expect(row.config).toEqual({})
			expect(row.createdAt).toBeInstanceOf(Date)
			expect(row.updatedAt).toBe(row.createdAt)
		}
	})
})
