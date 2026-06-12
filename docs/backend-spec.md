# FREYA Backend Specification

## Problem Statement

FREYA needs a backend service that manages per-user FeedEngine instances and delivers real-time feed updates to clients. The backend must handle authentication, maintain WebSocket connections for live updates, and accept context updates (like location) that trigger feed recalculations.

## Requirements

### Authentication

- Email/password authentication using BetterAuth
- PostgreSQL for session and user storage
- Session tokens validated via `Authorization: Bearer <token>` header
- Auth endpoints exposed via BetterAuth's built-in routes

### FeedEngine Management

- Each authenticated user gets their own FeedEngine instance
- Instances are cached in memory with a 30-minute TTL
- TTL resets on any activity (WebSocket message, location update)
- Default sources registered for each user: `LocationSource`, `WeatherSource`, `TflSource`
- Source configuration is hardcoded initially (customization deferred)

### WebSocket Connection

- Single endpoint: `GET /ws` (upgrades to WebSocket)
- Authentication via `Authorization: Bearer <token>` header on upgrade request
- Rejected before upgrade if token is invalid
- Multiple connections per user allowed (e.g., multiple devices)
- All connections for a user receive the same feed updates
- On connect: immediately send current feed state

### JSON-RPC Protocol

All WebSocket communication uses JSON-RPC 2.0.

**Client → Server (Requests):**

```json
{ "jsonrpc": "2.0", "method": "location.update", "params": { "lat": 51.5, "lng": -0.1, "accuracy": 10, "timestamp": "2025-01-01T12:00:00Z" }, "id": 1 }
{ "jsonrpc": "2.0", "method": "feed.refresh", "params": {}, "id": 2 }
```

**Server → Client (Responses):**

```json
{ "jsonrpc": "2.0", "result": { "ok": true }, "id": 1 }
```

**Server → Client (Notifications - no id):**

```json
{ "jsonrpc": "2.0", "method": "feed.update", "params": { "items": [...], "errors": [...] } }
```

### JSON-RPC Methods

| Method            | Params                              | Description                                 |
| ----------------- | ----------------------------------- | ------------------------------------------- |
| `location.update` | `{ lat, lng, accuracy, timestamp }` | Push location update, triggers feed refresh |
| `feed.refresh`    | `{}`                                | Force manual feed refresh                   |

### Server Notifications

| Method        | Params                       | Description            |
| ------------- | ---------------------------- | ---------------------- |
| `feed.update` | `{ context, items, errors }` | Feed state changed     |
| `error`       | `{ code, message, data? }`   | Source or system error |

### Error Handling

- Source failures during refresh are reported via `error` notification
- Format: `{ "jsonrpc": "2.0", "method": "error", "params": { "code": -32000, "message": "...", "data": { "sourceId": "weather" } } }`

## Acceptance Criteria

1. **Auth Flow**
   - [ ] User can sign up with email/password via `POST /api/auth/sign-up`
   - [ ] User can sign in via `POST /api/auth/sign-in` and receive session token
   - [ ] Invalid credentials return 401

2. **WebSocket Connection**
   - [ ] `GET /ws` with valid `Authorization` header upgrades to WebSocket
   - [ ] `GET /ws` without valid token returns 401 (no upgrade)
   - [ ] On successful connect, client receives `feed.update` notification with current state
   - [ ] Multiple connections from same user all receive updates

3. **FeedEngine Lifecycle**
   - [ ] First connection for a user creates FeedEngine with default sources
   - [ ] Subsequent connections reuse the same FeedEngine
   - [ ] FeedEngine is destroyed after 30 minutes of inactivity
   - [ ] Activity (any WebSocket message) resets the TTL

4. **JSON-RPC Methods**
   - [ ] `location.update` updates LocationSource and triggers feed refresh
   - [ ] `feed.refresh` triggers manual refresh
   - [ ] Both return `{ "ok": true }` on success
   - [ ] Invalid method returns JSON-RPC error

5. **Feed Updates**
   - [ ] FeedEngine subscription pushes updates to all user's WebSocket connections
   - [ ] Updates include `context`, `items`, and `errors`

## Implementation Approach

### Phase 1: Project Setup

1. Create `apps/freya-backend` with Hono
2. Configure TypeScript, add dependencies (hono, better-auth, postgres driver)
3. Set up database connection and BetterAuth

### Phase 2: Authentication

4. Configure BetterAuth with email/password provider
5. Mount BetterAuth routes at `/api/auth/*`
6. Create session validation helper for extracting user from token

### Phase 3: FeedEngine Manager

7. Create `FeedEngineManager` class:
   - `getOrCreate(userId): FeedEngine` - returns cached or creates new
   - `touch(userId)` - resets TTL
   - `destroy(userId)` - manual cleanup
   - Internal TTL cleanup loop
8. Factory function to create FeedEngine with default sources

### Phase 4: WebSocket Handler

9. Create WebSocket upgrade endpoint at `/ws`
10. Validate `Authorization` header before upgrade
11. On connect: register connection, send initial feed state
12. On disconnect: unregister connection

### Phase 5: JSON-RPC Handler

13. Create JSON-RPC message parser and dispatcher
14. Implement `location.update` method
15. Implement `feed.refresh` method
16. Wire FeedEngine subscription to broadcast `feed.update` to all user connections

### Phase 6: Connection Manager

17. Create `ConnectionManager` to track WebSocket connections per user
18. Broadcast helper to send to all connections for a user

### Phase 7: Integration & Testing

19. Integration test: auth → connect → location update → receive feed
20. Test multiple connections receive same updates
21. Test TTL cleanup

## Package Structure

```
apps/freya-backend/
├── package.json
├── src/
│   ├── index.ts              # Entry point, Hono app
│   ├── auth.ts               # BetterAuth configuration
│   ├── db.ts                 # Database connection
│   ├── ws/
│   │   ├── handler.ts        # WebSocket upgrade & message handling
│   │   ├── jsonrpc.ts        # JSON-RPC parser & types
│   │   └── methods.ts        # Method implementations
│   ├── feed/
│   │   ├── manager.ts        # FeedEngineManager (TTL cache)
│   │   ├── factory.ts        # Creates FeedEngine with default sources
│   │   └── connections.ts    # ConnectionManager (user → WebSocket[])
│   └── types.ts              # Shared types
```

## Dependencies

```json
{
	"dependencies": {
		"hono": "^4",
		"better-auth": "^1",
		"postgres": "^3",
		"@freya/core": "workspace:*",
		"@freya/source-location": "workspace:*",
		"@freya/source-weatherkit": "workspace:*",
		"@freya/data-source-tfl": "workspace:*"
	}
}
```

## Open Questions (Deferred)

- User source configuration storage (database schema)
- Rate limiting on WebSocket methods
- Reconnection handling (client-side concern)
- Horizontal scaling (would need Redis for shared state)
