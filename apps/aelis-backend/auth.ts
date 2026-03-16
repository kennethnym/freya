// Used by Better Auth CLI for schema generation.
// Run: bunx --bun auth@latest generate --config auth.ts --output src/db/auth-schema.ts
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { SQL } from "bun"
import { drizzle } from "drizzle-orm/bun-sql"

const client = new SQL({ url: process.env.DATABASE_URL })
const db = drizzle({ client })

export const auth = betterAuth({
	database: drizzleAdapter(db, { provider: "pg" }),
	emailAndPassword: {
		enabled: true,
	},
})

export default auth
