import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

import type { Database } from "../db/index.ts"
import * as schema from "../db/schema.ts"

export function createAuth(db: Database) {
	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",
			schema,
		}),
		emailAndPassword: {
			enabled: true,
		},
	})
}

export type Auth = ReturnType<typeof createAuth>
