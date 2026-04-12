# DB Persistence Layer Spec

## Problem Statement

AELIS currently hardcodes the same set of feed sources for every user. Source configuration (TFL lines, weather units, calendar IDs, etc.) and credentials (OAuth tokens) are not persisted. Users cannot customize which sources appear in their feed or configure source-specific settings.

The backend uses a raw `pg` Pool for Better Auth and has no ORM. We need a persistence layer that stores per-user source configuration and credentials, using Drizzle ORM with Bun.sql as the Postgres driver.

## Requirements

### 1. Replace `pg` with `Bun.sql`

- Remove `pg` and `@types/pg` dependencies
- Replace `db.ts` with a Drizzle instance backed by `Bun.sql` (`drizzle-orm/bun-sql`)
- All DB access goes through Drizzle — no raw Pool usage

### 2. Migrate Better Auth to Drizzle adapter

- Use `better-auth/adapters/drizzle` so auth tables are managed through the same Drizzle instance
- Define Better Auth tables (user, session, account, verification) in the Drizzle schema
- Better Auth's `database` option switches from `Pool` to the Drizzle adapter

### 3. User source configuration table

A `user_sources` table stores per-user source state:

| Column        | Type                  | Description                                                    |
| ------------- | --------------------- | -------------------------------------------------------------- |
| `id`          | `uuid` PK             | Row ID                                                         |
| `user_id`     | `text` FK → `user.id` | Owner                                                          |
| `source_id`   | `text`                | Source identifier (e.g., `aelis.tfl`, `aelis.weather`)         |
| `enabled`     | `boolean`             | Whether this source is active in the user's feed               |
| `config`      | `jsonb`               | Source-specific configuration (validated by source at runtime) |
| `credentials` | `bytea`               | Encrypted OAuth tokens / secrets (AES-256-GCM)                 |
| `created_at`  | `timestamp with tz`   | Row creation time                                              |
| `updated_at`  | `timestamp with tz`   | Last modification time                                         |

- Unique constraint on `(user_id, source_id)` — one config row per source per user.
- `config` is a generic `jsonb` column. Each source package exports an arktype schema; the backend provider validates the JSON at source construction time.
- `credentials` is stored as encrypted bytes. Only OAuth tokens and secrets go here — non-sensitive config stays in `config`.

### 4. Credential encryption

- AES-256-GCM encryption for the `credentials` column
- Encryption key sourced from an environment variable (`CREDENTIALS_ENCRYPTION_KEY`)
- A `crypto` utility module in the backend provides `encrypt(plaintext)` → `Buffer` and `decrypt(ciphertext)` → `string`
- IV is generated per-encryption and stored as a prefix to the ciphertext

### 5. Default sources on signup

When a new user is created, seed `user_sources` rows for default sources:

| Source           | Default config                                              |
| ---------------- | ----------------------------------------------------------- |
| `aelis.location` | `{}`                                                        |
| `aelis.weather`  | `{ "units": "metric", "hourlyLimit": 12, "dailyLimit": 7 }` |
| `aelis.tfl`      | `{ "lines": <all default lines> }`                          |

- Seeding happens via a Better Auth `after` hook on user creation, or via application-level logic after signup.
- Sources requiring credentials (Google Calendar, CalDAV) are **not** enabled by default — they require the user to connect an account first.

### 6. Source providers query DB

`FeedSourceProvider.feedSourceForUser` is already async (returns `Promise<FeedSource>`). `UserSessionManager.getOrCreate` is already async with in-flight deduplication and `Promise.allSettled`-based graceful degradation — if a provider throws, the source is skipped and the error is logged.

Each provider receives the Drizzle DB instance and queries `user_sources` internally. If the source is disabled or the row is missing, the provider throws a `SourceDisabledError`. If config validation fails, it throws with a descriptive message. Both cases are handled by `createSession`'s `Promise.allSettled` — the source is excluded from the session and the error is logged.

```typescript
class TflSourceProvider implements FeedSourceProvider {
	constructor(
		private db: DrizzleDb,
		private apiKey: string,
	) {}

	async feedSourceForUser(userId: string): Promise<TflSource> {
		const row = await this.db
			.select()
			.from(userSources)
			.where(
				and(
					eq(userSources.userId, userId),
					eq(userSources.sourceId, "aelis.tfl"),
					eq(userSources.enabled, true),
				),
			)
			.limit(1)

		if (!row[0]) {
			throw new SourceDisabledError("aelis.tfl", userId)
		}

		const config = tflSourceConfig(row[0].config ?? {})
		if (config instanceof type.errors) {
			throw new Error(`Invalid TFL config for user ${userId}: ${config.summary}`)
		}

		return new TflSource({ ...config, apiKey: this.apiKey })
	}
}
```

No interface changes are needed — the existing async `FeedSourceProvider` and `UserSessionManager` signatures are sufficient.

### 7. Drizzle Kit migrations

- Use `drizzle-kit` for schema migrations
- `drizzle.config.ts` at `apps/aelis-backend/drizzle.config.ts`
- Migration files stored in `apps/aelis-backend/drizzle/`
- Scripts in `package.json`: `db:generate`, `db:migrate`, `db:studio`

## Acceptance Criteria

1. **Bun.sql driver**
   - [ ] `pg` and `@types/pg` are removed from `package.json`
   - [ ] `db.ts` exports a Drizzle instance using `Bun.sql`
   - [ ] All existing DB usage (Better Auth) works with the new driver

2. **Better Auth on Drizzle**
   - [ ] Better Auth uses `drizzle-adapter` with the shared Drizzle instance
   - [ ] Auth tables (user, session, account, verification) are defined in the Drizzle schema
   - [ ] Signup, signin, and session validation work as before

3. **User sources table**
   - [ ] `user_sources` table exists with the schema described above
   - [ ] Unique constraint on `(user_id, source_id)` is enforced
   - [ ] `config` column accepts arbitrary JSON
   - [ ] `credentials` column stores encrypted bytes

4. **Credential encryption**
   - [ ] Encrypt/decrypt utility works with AES-256-GCM
   - [ ] IV is unique per encryption
   - [ ] Missing `CREDENTIALS_ENCRYPTION_KEY` fails fast at startup
   - [ ] Unit tests cover round-trip encrypt → decrypt

5. **Default source seeding**
   - [ ] New user signup creates `user_sources` rows for location, weather, and TFL
   - [ ] Default config values match the table above
   - [ ] Sources requiring credentials are not auto-enabled

6. **Provider DB integration**
   - [ ] Each provider queries `user_sources` for the user's config and credentials
   - [ ] Disabled sources (enabled=false or missing row) throw `SourceDisabledError`, excluded via `Promise.allSettled`
   - [ ] Invalid config logs an error and skips the source (graceful degradation)
   - [ ] `SourceDisabledError` class is created in `src/session/`

   _Note: `FeedSourceProvider` is already async, `UserSessionManager.getOrCreate` is already async with in-flight deduplication and `Promise.allSettled` graceful degradation. No interface changes needed._

7. **Migrations**
   - [ ] `drizzle.config.ts` is configured
   - [ ] Initial migration creates all tables (auth + user_sources)
   - [ ] `bun run db:generate` and `bun run db:migrate` work

## Implementation Approach

### Phase 1: Drizzle + Bun.sql setup

1. Install `drizzle-orm` and `drizzle-kit`; remove `pg` and `@types/pg`
2. Create `src/db/index.ts` — Drizzle instance with `Bun.sql`
3. Create `src/db/schema.ts` — Better Auth tables + `user_sources` table
4. Create `drizzle.config.ts`
5. Add `db:generate`, `db:migrate`, `db:studio` scripts to `package.json`

### Phase 2: Better Auth migration

6. Update `src/auth/index.ts` to use `drizzle-adapter` with the Drizzle instance
7. Verify signup/signin/session validation still work
8. Remove old `src/db.ts` (raw Pool)

### Phase 3: Credential encryption

9. Create `src/lib/crypto.ts` with `encrypt` and `decrypt` functions (AES-256-GCM)
10. Add `CREDENTIALS_ENCRYPTION_KEY` to `.env.example`
11. Write unit tests for encrypt/decrypt round-trip

### Phase 4: User source config

12. Create `src/db/user-sources.ts` — query helpers (get sources for user, upsert config, etc.)
13. Create `src/session/source-disabled-error.ts` — `SourceDisabledError` class
14. Implement default source seeding on user creation
15. Update each provider (Weather, TFL, Location) to accept Drizzle DB instance and query `user_sources` for config/credentials

_`FeedSourceProvider` is already async and `UserSessionManager.getOrCreate` already handles provider failures via `Promise.allSettled`. No interface or caller changes needed._

### Phase 5: Verification

16. Generate and run initial migration
17. Run existing tests, fix any breakage
18. Manual test: signup → default sources created → feed returns data

## File Structure (new/modified)

```
apps/aelis-backend/
├── drizzle.config.ts                    # NEW
├── drizzle/                             # NEW — migration files
├── src/
│   ├── db.ts                            # REPLACE — Drizzle + Bun.sql
│   ├── db/
│   │   ├── schema.ts                    # NEW — all table definitions
│   │   └── user-sources.ts              # NEW — query helpers
│   ├── auth/
│   │   └── index.ts                     # MODIFY — drizzle adapter
│   ├── lib/
│   │   ├── crypto.ts                    # NEW — encrypt/decrypt
│   │   └── crypto.test.ts              # NEW
│   ├── session/
│   │   └── source-disabled-error.ts     # NEW — SourceDisabledError
│   ├── weather/
│   │   └── provider.ts                  # MODIFY — query DB
│   └── tfl/
│       └── provider.ts                  # MODIFY — query DB
```

_`feed-source-provider.ts`, `user-session-manager.ts`, `engine/http.ts`, and `location/http.ts` are already async-ready on master and do not need changes._

## Dependencies

**Add:**

- `drizzle-orm`
- `drizzle-kit` (dev)

**Remove:**

- `pg`
- `@types/pg` (dev)

## Environment Variables

**Add to `.env.example`:**

- `CREDENTIALS_ENCRYPTION_KEY` — 32-byte hex or base64 key for AES-256-GCM

## Open Questions (Deferred)

- HTTP endpoints for CRUD on user source config (settings UI)
- OAuth flow for connecting Google Calendar / CalDAV accounts
- Source config validation schemas exported from each source package (currently only TFL has one)
- Whether to cache DB-loaded config in the UserSession to avoid repeated queries on reconnect
