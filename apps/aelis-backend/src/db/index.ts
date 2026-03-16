import { SQL } from "bun"
import { drizzle, type BunSQLDatabase } from "drizzle-orm/bun-sql"

import * as schema from "./schema.ts"

export type Database = BunSQLDatabase<typeof schema>

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
