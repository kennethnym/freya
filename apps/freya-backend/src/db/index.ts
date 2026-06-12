import type { PgDatabase } from "drizzle-orm/pg-core"

import { SQL } from "bun"
import { drizzle, type BunSQLQueryResultHKT } from "drizzle-orm/bun-sql"

import * as schema from "./schema.ts"

/** Covers both the top-level drizzle instance and transaction handles. */
export type Database = PgDatabase<BunSQLQueryResultHKT, typeof schema>

export interface DatabaseConnection {
	db: Database
	close: () => Promise<void>
}

export function createDatabase(url: string): DatabaseConnection {
	if (!url) {
		throw new Error("DATABASE_URL is required")
	}

	const client = new SQL({ url })
	return {
		db: drizzle({ client, schema }),
		close: () => client.close(),
	}
}
