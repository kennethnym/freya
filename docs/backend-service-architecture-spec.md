# Backend Service Architecture: Per-User Refactor

## Problem Statement

The current backend uses a **per-source service** pattern: each source type (Location, Weather, TFL) has its own `XxxService` class that manages a `Map<userId, SourceInstance>`. Adding a new source requires:

1. A new `XxxService` class with identical boilerplate (~30-40 lines: Map, get-or-create, removeUser)
2. Wiring it into `server.ts` constructor
3. Passing it to `FeedEngineService`
4. Optionally adding source-specific tRPC routes

With 3 sources this is manageable. With 10+ (calendar, music, transit, news, etc.) it becomes:

- **Repetitive**: Every service class repeats the same Map + get-or-create + removeUser pattern
- **Fragmented lifecycle**: User cleanup requires calling `removeUser` on every service independently
- **No user-level config**: No unified place to store which sources a user has enabled or their per-source settings
- **Hard to reason about**: User state is scattered across N independent Maps

### Current Flow

```
server.ts
  ├── new LocationService()          ← owns Map<userId, LocationSource>
  ├── new WeatherService(creds)      ← owns Map<userId, WeatherSource>
  ├── new TflService(api)            ← owns Map<userId, TflSource>
  └── FeedEngineService([loc, weather, tfl])
        └── owns Map<userId, FeedEngine>
            └── on create: asks each service for feedSourceForUser(userId)
```

4 independent Maps for 3 sources. Each user's state lives in 4 different places.

## Scope

**Backend only** (`apps/freya-backend`). No changes to `freya-core` or source packages (`packages/freya-source-*`). The `FeedSource` interface and source implementations remain unchanged.

## Architectural Options

### Option A: UserSession Object

A single `UserSession` class owns everything for one user. A `UserSessionManager` is the only top-level Map.

```typescript
class UserSession {
  readonly userId: string
  readonly engine: FeedEngine
  private sources: Map<string, FeedSource>

  constructor(userId: string, sourceFactories: SourceFactory[]) {
    this.engine = new FeedEngine()
    this.sources = new Map()
    for (const factory of sourceFactories) {
      const source = factory.create()
      this.sources.set(source.id, source)
      this.engine.register(source)
    }
    this.engine.start()
  }

  getSource<T extends FeedSource>(id: string): T | undefined {
    return this.sources.get(id) as T | undefined
  }

  destroy(): void {
    this.engine.stop()
    this.sources.clear()
  }
}

class UserSessionManager {
  private sessions = new Map<string, UserSession>()

  getOrCreate(userId: string): UserSession { ... }
  remove(userId: string): void { ... }  // single cleanup point
}
```

**Source-specific operations** use typed accessors:

```typescript
const session = manager.getOrCreate(userId)
const location = session.getSource<LocationSource>("location")
location?.pushLocation({ lat: 51.5, lng: -0.1, ... })
```

**Pros:**

- Single Map, single cleanup point
- All user state co-located
- Easy to add TTL/eviction at one level
- Source factories are simple functions, no service classes needed

**Cons:**

- `getSource<T>("id")` requires callers to know the source ID string and cast type
- Shared resources (e.g., TFL API client) need to be passed through factories

### Option B: Source Registry with Factories

Keep `FeedEngineService` but replace per-source service classes with a registry of factory functions. No `XxxService` classes at all.

```typescript
interface SourceFactory {
  readonly sourceId: string
  create(userId: string): FeedSource
}

// Weather factory — closure over shared credentials
function weatherSourceFactory(creds: WeatherKitCredentials): SourceFactory {
  return {
    sourceId: "weather",
    create: () => new WeatherSource({ credentials: creds }),
  }
}

// TFL factory — closure over shared API client
function tflSourceFactory(api: ITflApi): SourceFactory {
  return {
    sourceId: "tfl",
    create: () => new TflSource({ client: api }),
  }
}

class FeedEngineService {
  private engines = new Map<string, FeedEngine>()
  private userSources = new Map<string, Map<string, FeedSource>>()

  constructor(private readonly factories: SourceFactory[]) {}

  engineForUser(userId: string): FeedEngine { ... }
  getSourceForUser<T extends FeedSource>(userId: string, sourceId: string): T | undefined { ... }
  removeUser(userId: string): void { ... }  // cleans up engine + all sources
}
```

**Pros:**

- Minimal change from current structure — `FeedEngineService` evolves, services disappear
- Factory functions are 5-10 lines each, no classes
- Shared resources handled naturally via closures

**Cons:**

- `FeedEngineService` grows in responsibility (engine + source tracking + source access)
- Still two Maps (engines + userSources), though co-located

### Option C: UserSession + Typed Source Handles (Recommended)

Combines Option A's co-location with type-safe source access. `UserSession` owns everything. Source-specific operations go through **source handles** — thin typed wrappers registered at setup time.

```typescript
// Source handle: typed wrapper for source-specific operations
interface SourceHandle<T extends FeedSource = FeedSource> {
	readonly source: T
}

class UserSession {
	readonly engine: FeedEngine
	private handles = new Map<string, SourceHandle>()

	register<T extends FeedSource>(source: T): SourceHandle<T> {
		this.engine.register(source)
		const handle: SourceHandle<T> = { source }
		this.handles.set(source.id, handle)
		return handle
	}

	destroy(): void {
		this.engine.stop()
		this.handles.clear()
	}
}

// In setup code — handles are typed at creation time
function createSession(userId: string, deps: SessionDeps): UserSession {
	const session = new UserSession(userId)

	const locationHandle = session.register(new LocationSource())
	const weatherHandle = session.register(new WeatherSource(deps.weatherCreds))
	const tflHandle = session.register(new TflSource({ client: deps.tflApi }))

	return session
}
```

**Source-specific operations** use the typed handles returned at registration:

```typescript
// In the tRPC router or wherever source-specific ops happen:
// The handle is obtained during session setup and stored where needed
locationHandle.source.pushLocation({ ... })
tflHandle.source.setLinesOfInterest(["northern"])
```

**Pros:**

- Single Map, single cleanup
- Type-safe source access without string-based lookups or casts
- No boilerplate service classes
- Handles can be extended later (e.g., add per-source config, metrics)
- Shared resources passed directly to constructors

**Cons:**

- Handles need to be threaded to where they're used (tRPC routers, etc.)
- Slightly more setup code in the factory function

## Source-Specific Operations: Approaches

Orthogonal to the session model, there are three ways to handle operations like `pushLocation` or `setLinesOfInterest`:

### Approach 1: Direct Source Access (Recommended)

Callers get a typed reference to the source and call methods directly. This is what all three options above use in different ways.

```typescript
locationSource.pushLocation(location)
tflSource.setLinesOfInterest(lines)
```

**Why this works:** Source packages already define these methods. The backend just needs to expose the source instance to the right caller. No new abstraction needed.

### Approach 2: Command Dispatch

A generic `dispatch(command)` method on the session routes typed commands to sources.

```typescript
session.dispatch({ type: "location.update", payload: { lat: 51.5, ... } })
```

**Tradeoff:** Adds indirection and a command type registry. Useful if sources are dynamically loaded plugins, but over-engineered for the current case where sources are known at compile time.

### Approach 3: Context-Only

All input goes through `FeedEngine` context updates. Sources react to context changes.

```typescript
engine.pushContext({ [LocationKey]: location })
// LocationSource picks this up via onContextUpdate
```

**Tradeoff:** Location already works this way (it's a context provider). But not all operations map to context — `setLinesOfInterest` is configuration, not context. Would require stretching the context concept.

## User Source Configuration (DB-Persisted)

Regardless of which option is chosen, user source config needs a storage model:

```sql
CREATE TABLE user_source_config (
  user_id    TEXT NOT NULL REFERENCES users(id),
  source_id  TEXT NOT NULL,          -- e.g., "weather", "tfl", "location"
  enabled    BOOLEAN NOT NULL DEFAULT true,
  config     JSONB NOT NULL DEFAULT '{}',  -- source-specific settings
  PRIMARY KEY (user_id, source_id)
);
```

On session creation:

1. Load `user_source_config` rows for the user
2. Only create sources where `enabled = true`
3. Pass `config` JSON to the source factory/constructor

New users get default config rows inserted on first login.

## Recommendation

**Option C (UserSession + Typed Source Handles)** with **Approach 1 (Direct Source Access)**.

Rationale:

- Eliminates all per-source service boilerplate
- Single user lifecycle management point
- Type-safe without string-based lookups in hot paths
- Minimal new abstraction — `UserSession` is a thin container, not a framework
- Handles are just typed references, not a new pattern to learn
- Natural extension point for per-user config loading from DB

## Acceptance Criteria

1. **No per-source service classes**: `LocationService`, `WeatherService`, `TflService` are removed
2. **Single user state container**: All per-user state (engine, sources) lives in one object
3. **Single cleanup**: Removing a user requires one call, not N
4. **Type-safe source access**: Source-specific operations don't require string-based lookups or unsafe casts at call sites
5. **Existing tests pass**: `FeedEngineService` tests are migrated to the new structure
6. **tRPC routes work**: Location update route works through the new architecture
7. **DB config table**: `user_source_config` table exists; session creation reads from it
8. **Default config**: New users get default source config on first session

## Implementation Steps

1. Create `user_source_config` DB table and migration
2. Create `UserSession` class with `register()`, `destroy()`, typed handle return
3. Create `UserSessionManager` with `getOrCreate()`, `remove()`, config loading
4. Create `createSession()` factory that reads DB config and registers enabled sources
5. Refactor `server.ts` to use `UserSessionManager` instead of individual services
6. Refactor tRPC router to receive session/handles instead of individual services
7. Delete `LocationService`, `WeatherService`, `TflService` classes
8. Migrate existing tests to new structure
9. Add tests for session lifecycle (create, destroy, config loading)

## Open Questions

- **TTL/eviction**: Should `UserSessionManager` handle idle session cleanup? (Currently deferred in backend-spec.md)
- **Hot reload config**: If a user changes their source config, should the session be recreated or patched in-place?
- **Shared source instances**: Some sources (e.g., TFL) share an API client. Should the factory receive shared deps, or should there be a DI container?
