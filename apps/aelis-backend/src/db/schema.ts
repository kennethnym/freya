import {
	boolean,
	customType,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core"

// ---------------------------------------------------------------------------
// Better Auth core tables
// Re-exported from CLI-generated schema.
// Regenerate with: bunx --bun auth@latest generate --config auth.ts --output src/db/auth-schema.ts
// ---------------------------------------------------------------------------

export {
	user,
	session,
	account,
	verification,
	userRelations,
	sessionRelations,
	accountRelations,
} from "./auth-schema.ts"

import { user } from "./auth-schema.ts"

// ---------------------------------------------------------------------------
// AELIS — per-user source configuration
// ---------------------------------------------------------------------------

const bytea = customType<{ data: Buffer }>({
	dataType() {
		return "bytea"
	},
})

export const userSources = pgTable(
	"user_sources",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sourceId: text("source_id").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		config: jsonb("config").default({}),
		credentials: bytea("credentials"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [unique("user_sources_user_id_source_id_unique").on(t.userId, t.sourceId)],
)
