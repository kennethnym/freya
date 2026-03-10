# FeedSource Actions

## Problem Statement

`FeedSource` is read-only. Sources can provide context and feed items but can't expose write operations (play, RSVP, dismiss). This blocks interactive sources like Spotify, calendar, and tasks.

## Scope

**`aelis-core` only.** Add action support to `FeedSource` and `FeedItem`. No changes to existing fields or methods — purely additive.

## Design

### Why Not MCP

MCP was considered. It doesn't fit because:

- MCP resources don't accept input context (FeedSource needs accumulated context as input)
- MCP has no structured feed items (priority, timestamp, type)
- MCP's isolation model conflicts with AELIS's dependency graph
- Adding these as MCP extensions would mean the extensions are the entire protocol

The interface is designed to be **protocol-compatible** — a future `RemoteFeedSource` adapter can map each field/method to a JSON-RPC operation without changing the interface:

| FeedSource field/method | Future protocol operation |
| ----------------------- | ------------------------- |
| `id`, `dependencies`    | `source/describe`         |
| `listActions()`         | `source/listActions`      |
| `fetchContext()`        | `source/fetchContext`     |
| `fetchItems()`          | `source/fetchItems`       |
| `executeAction()`       | `source/executeAction`    |
| `onContextUpdate()`     | `source/contextUpdated`   |
| `onItemsUpdate()`       | `source/itemsUpdated`     |

No interface changes needed when the transport layer is built.

### Source ID & Action ID Convention

Source IDs use reverse domain notation. Built-in sources use `aelis.<name>`. Third parties use their own domain.

Action IDs are descriptive verb-noun pairs in kebab-case, scoped to their source. The globally unique form is `<sourceId>/<actionId>`.

| Source ID       | Action IDs                                                     |
| --------------- | -------------------------------------------------------------- |
| `aelis.location` | `update-location` (migrated from `pushLocation()`)             |
| `aelis.tfl`      | `set-lines-of-interest` (migrated from `setLinesOfInterest()`) |
| `aelis.weather`  | _(none)_                                                       |
| `com.spotify`   | `play-track`, `pause-playback`, `skip-track`, `like-track`     |
| `aelis.calendar` | `rsvp`, `create-event`                                         |
| `com.todoist`   | `complete-task`, `snooze-task`                                 |

This means existing source packages need their `id` updated (e.g., `"location"` → `"aelis.location"`).

### New Types

```typescript
/** Describes an action a source can perform. */
interface ActionDefinition<TInput = unknown> {
	/** Descriptive action name in kebab-case (e.g., "update-location", "play-track") */
	readonly id: string
	/** Human-readable label for UI (e.g., "Play", "RSVP Yes") */
	readonly label: string
	/** Optional longer description */
	readonly description?: string
	/** Schema for input validation. Accepts any Standard Schema compatible validator (arktype, zod, valibot, etc.). Omit if no params. */
	readonly input?: StandardSchemaV1<TInput>
}
```

`StandardSchemaV1` is the [Standard Schema](https://github.com/standard-schema/standard-schema) interface implemented by arktype, zod, and valibot. This means sources can use any validator:

```typescript
import { type } from "arktype"
import { z } from "zod"

// With arktype
{ id: "play-track", label: "Play", input: type({ trackId: "string" }) }

// With zod
{ id: "play-track", label: "Play", input: z.object({ trackId: z.string() }) }

// Without validation (e.g., remote sources using raw JSON Schema)
{ id: "play-track", label: "Play" }

/** Result of executing an action. */
interface ActionResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
}

/** Reference to an action on a specific feed item. */
interface ItemAction {
  /** Action ID (matches ActionDefinition.id on the source) */
  actionId: string
  /** Per-item label override (e.g., "RSVP to standup") */
  label?: string
  /** Pre-filled params for this item (e.g., { eventId: "abc" }) */
  params?: Record<string, unknown>
}
```

### Changes to FeedSource

Two optional fields added. Nothing else changes.

```typescript
interface FeedSource<TItem extends FeedItem = FeedItem> {
  readonly id: string                              // unchanged
  readonly dependencies?: readonly string[]        // unchanged
  fetchContext(...): ...                            // unchanged
  onContextUpdate?(...): ...                       // unchanged
  fetchItems?(...): ...                            // unchanged
  onItemsUpdate?(...): ...                         // unchanged

  /** List actions this source supports. Empty record if none. Maps to: source/listActions */
  listActions(): Promise<Record<string, ActionDefinition>>

  /** Execute an action by ID. No-op returning { ok: false } if source has no actions. */
  executeAction(
    actionId: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult>
}
```

### Changes to FeedItem

Optional fields added for actions, server-driven UI, and LLM slots.

```typescript
interface FeedItem<
	TType extends string = string,
	TData extends Record<string, unknown> = Record<string, unknown>,
> {
	id: string // unchanged
	type: TType // unchanged
	priority: number // unchanged
	timestamp: Date // unchanged
	data: TData // unchanged

	/** Actions the user can take on this item. */
	actions?: readonly ItemAction[]

	/** Server-driven UI tree rendered by json-render on the client. */
	ui?: JsonRenderNode

	/** Named slots for LLM-fillable content. See architecture-draft.md. */
	slots?: Record<string, Slot>
}
```

### Changes to FeedEngine

Two new methods. Existing methods unchanged.

```typescript
class FeedEngine {
	// All existing methods unchanged...

	/** Route an action call to the correct source. */
	async executeAction(
		sourceId: string,
		actionId: string,
		params: Record<string, unknown>,
	): Promise<ActionResult>

	/** List all actions across all registered sources. */
	listActions(): { sourceId: string; actions: readonly ActionDefinition[] }[]
}
```

### Example: Spotify Source

```typescript
class SpotifySource implements FeedSource<SpotifyFeedItem> {
	readonly id = "com.spotify"

	async listActions() {
		return {
			"play-track": { id: "play-track", label: "Play", input: type({ trackId: "string" }) },
			"pause-playback": { id: "pause-playback", label: "Pause" },
			"skip-track": { id: "skip-track", label: "Skip" },
			"like-track": { id: "like-track", label: "Like", input: type({ trackId: "string" }) },
		}
	}

	async executeAction(actionId: string, params: Record<string, unknown>): Promise<ActionResult> {
		switch (actionId) {
			case "play-track":
				await this.client.play(params.trackId as string)
				return { ok: true }
			case "pause-playback":
				await this.client.pause()
				return { ok: true }
			case "skip-track":
				await this.client.skip()
				return { ok: true }
			case "like-track":
				await this.client.like(params.trackId as string)
				return { ok: true }
			default:
				return { ok: false, error: `Unknown action: ${actionId}` }
		}
	}

	async fetchContext(): Promise<null> {
		return null
	}

	// Note: for a source with no actions, it would be:
	// async listActions() { return {} }
	// async executeAction(): Promise<ActionResult> {
	//   return { ok: false, error: "No actions supported" }
	// }

	async fetchItems(context: Context): Promise<SpotifyFeedItem[]> {
		const track = await this.client.getCurrentTrack()
		if (!track) return []
		return [
			{
				id: `spotify-${track.id}`,
				type: "spotify-now-playing",
				priority: 0.4,
				timestamp: context.time,
				data: { trackName: track.name, artist: track.artist },
				actions: [
					{ actionId: "pause-playback" },
					{ actionId: "skip-track" },
					{ actionId: "like-track", params: { trackId: track.id } },
				],
				ui: {
					type: "View",
					className: "flex-row items-center p-3 gap-3 bg-white dark:bg-black rounded-xl",
					children: [
						{
							type: "Image",
							source: { uri: track.albumArt },
							className: "w-12 h-12 rounded-lg",
						},
						{
							type: "View",
							className: "flex-1",
							children: [
								{ type: "Text", className: "font-semibold text-black dark:text-white", text: track.name },
								{ type: "Text", className: "text-sm text-gray-500 dark:text-gray-400", text: track.artist },
							],
						},
					],
				},
			},
		]
	}
}
```

## Acceptance Criteria

1. `ActionDefinition` type exists with `id`, `label`, `description?`, `inputSchema?`
2. `ActionResult` type exists with `ok`, `data?`, `error?`
3. `ItemAction` type exists with `actionId`, `label?`, `params?`
4. `FeedSource.listActions()` is a required method returning `Record<string, ActionDefinition>` (empty record if no actions)
5. `FeedSource.executeAction()` is a required method (no-op for sources without actions)
6. `FeedItem.actions` is an optional readonly array of `ItemAction`
6b. `FeedItem.ui` is an optional json-render tree describing server-driven UI
6c. `FeedItem.slots` is an optional record of named LLM-fillable slots
7. `FeedEngine.executeAction()` routes to correct source, returns `ActionResult`
8. `FeedEngine.listActions()` aggregates actions from all sources
9. Existing tests pass unchanged (all changes are additive)
10. New tests: action execution, unknown action ID, unknown source ID, source without actions, `listActions()` aggregation

## Implementation Steps

1. Create `action.ts` in `aelis-core/src` with `ActionDefinition`, `ActionResult`, `ItemAction`
2. Add optional `actions` and `executeAction` to `FeedSource` interface in `feed-source.ts`
3. Add optional `actions` field to `FeedItem` interface in `feed.ts`
4. Add `executeAction()` and `listActions()` to `FeedEngine` in `feed-engine.ts`
5. Export new types from `aelis-core/index.ts`
6. Add tests for `FeedEngine.executeAction()` routing
7. Add tests for `FeedEngine.listActions()` aggregation
8. Add tests for error cases (unknown action, unknown source, source without actions)
9. Update source IDs to reverse-domain format (`"location"` → `"aelis.location"`, etc.) across all source packages
10. Migrate `LocationSource.pushLocation()` → action `update-location` on `aelis.location`
11. Migrate `TflSource.setLinesOfInterest()` → action `set-lines-of-interest` on `aelis.tfl`
12. Add `async listActions() { return {} }` and no-op `executeAction()` to sources without actions (WeatherSource, GoogleCalendarSource, AppleCalendarSource)
13. Update any tests or code referencing old source IDs
14. Run all tests to confirm nothing breaks

## What This Defers

- Transport layer (JSON-RPC over HTTP/WebSocket) — built when remote sources are needed
- `RemoteFeedSource` adapter — mechanical once transport exists
- MCP adapter — wraps MCP servers as FeedSource
- Runtime schema validation of action params
- Action permissions / confirmation UI
- Source discovery / registry API
- Backend service consolidation (separate spec, depends on this one)
