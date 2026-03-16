/**
 * Creates an admin user account via Better Auth's server-side API.
 *
 * Usage:
 *   bun run src/scripts/create-admin.ts --name "Admin" --email admin@example.com --password secret123
 *
 * Requires DATABASE_URL and BETTER_AUTH_SECRET to be set (reads .env automatically).
 */

import { parseArgs } from "util"

import { createAuth } from "../auth/index.ts"
import { createDatabase } from "../db/index.ts"

function parseCliArgs(): { name: string; email: string; password: string } {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			name: { type: "string" },
			email: { type: "string" },
			password: { type: "string" },
		},
		strict: true,
	})

	if (!values.name || !values.email || !values.password) {
		console.error(
			"Usage: bun run src/scripts/create-admin.ts --name <name> --email <email> --password <password>",
		)
		process.exit(1)
	}

	return { name: values.name, email: values.email, password: values.password }
}

async function main() {
	const { name, email, password } = parseCliArgs()

	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) {
		console.error("DATABASE_URL is not set")
		process.exit(1)
	}

	const { db, close } = createDatabase(databaseUrl)

	try {
		const auth = createAuth(db)

		const result = await auth.api.createUser({
			body: { name, email, password, role: "admin" },
		})

		console.log(`Admin account created: ${result.user.id} (${result.user.email})`)
	} finally {
		await close()
	}
}

main().catch((err) => {
	console.error("Failed to create admin account:", err)
	process.exit(1)
})
