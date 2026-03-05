import { betterAuth } from "better-auth"

import { pool } from "../db.ts"

export const auth = betterAuth({
	database: pool,
	emailAndPassword: {
		enabled: true,
	},
})
