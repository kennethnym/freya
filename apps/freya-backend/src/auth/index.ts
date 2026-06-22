import { expo } from "@better-auth/expo"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"

import type { Database } from "../db/index.ts"

import * as schema from "../db/schema.ts"
import { insertDefaultUserSources } from "../sources/default-sources.ts"

export function createAuth(db: Database) {
	if (!process.env.BETTER_AUTH_SECRET) {
		throw new Error("BETTER_AUTH_SECRET is not set")
	}

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",
			schema,
		}),
		advanced: {
			disableCSRFCheck: process.env.NODE_ENV !== "production",
		},
		emailAndPassword: {
			enabled: true,
		},
		databaseHooks: {
			user: {
				create: {
					async after(user, _context) {
						await insertDefaultUserSources(db, user.id)
					},
				},
			},
		},
		plugins: [admin(), expo()],
	})
}

export type Auth = ReturnType<typeof createAuth>
