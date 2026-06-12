# FREYA Architecture Draft

> This is a working draft from initial architecture discussions. Not final documentation.

## Overview

FREYA is an AI-powered personal assistant. The core aggregates data from various sources and compiles a feed of contextually relevant items - similar to Google Now. The feed shows users useful information based on their current context (date, time, location).

Examples of feed items:

- Upcoming calendar events
- Nearby locations
- Current weather
- Alerts

## Design Principles

1. **Extensibility**: The core must support different data sources, including third-party sources.
2. **Separation of concerns**: Core handles data and UI description. The client is a thin renderer.
3. **Dependency graph**: Sources declare dependencies on other sources. The engine resolves the graph and runs independent sources in parallel.
4. **Graceful degradation**: Failed sources are skipped; partial results are returned.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Backend                              │
│  ┌─────────────┐    ┌─────────────┐                         │
│  │  freya-core  │    │   Sources   │                         │
│  │             │    │  (plugins)  │                         │
│  │ - FeedEngine│◄───│ - Calendar  │                         │
│  │ - Context   │    │ - Weather   │                         │
│  │ - FeedItem  │    │ - TfL       │                         │
│  │ - Actions   │    │ - Spotify   │                         │
│  └─────────────┘    └─────────────┘                         │
│         │                                                    │
│         ▼                                                    │
│    Feed items (data + ui trees + slots)                      │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼ (WebSocket / JSON-RPC)
┌─────────────────────────────────────────────────────────────┐
│                    Client (React Native)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  json-render + twrnc component map                    │   │
│  │  - Receives feed items with ui trees                  │   │
│  │  - Renders using registered RN components + twrnc     │   │
│  │  - User interactions trigger source actions           │   │
│  │  - Bespoke native components for rich interactions    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Core Package (`freya-core`)

The core is responsible for:

- Defining the context and feed item interfaces
- Providing a `FeedEngine` that orchestrates sources via a dependency graph
- Returning a flat list of prioritized feed items
- Routing action execution to the correct source

### Key Concepts

- **Context**: Time and location (with accuracy) passed to all sources. Sources can contribute to context (e.g., location source provides coordinates, weather source provides conditions).
- **FeedItem**: Has an ID (source-generated, stable), type, timestamp, JSON-serializable data, optional actions, an optional `ui` tree, and optional `slots` for LLM-fillable content.
- **FeedSource**: Interface that first and third parties implement to provide context, feed items, and actions. Uses reverse-domain IDs (e.g., `freya.weather`, `com.spotify`).
- **FeedEngine**: Orchestrates sources respecting their dependency graph, runs independent sources in parallel, returns items and any errors. Routes action execution to the correct source.

## Data Sources

Key decisions:

- Sources receive the full context and decide internally what to use
- Each source returns a single item type (e.g., separate "Calendar Source" and "Location Suggestion Source" rather than a combined "Google Source")
- Sources live in separate packages, not in the core
- Sources declare dependencies on other sources (e.g., weather depends on location)
- Sources are responsible for:
  - Transforming their domain data into feed items
  - Assigning priority based on domain logic (e.g., "event starting in 10 minutes" = high priority)
  - Returning empty arrays when nothing is relevant
  - Providing a `ui` tree for each feed item
  - Declaring and handling actions (e.g., RSVP, complete task, play/pause)

### Configuration

Configuration is passed at source registration time, not per reconcile call. Sources can use config for filtering/limiting (e.g., "max 3 calendar events").

## Feed Output

- Flat list of `FeedItem` objects
- Items carry data, an optional `ui` field describing their layout, and optional `slots` for LLM enhancement
- Items are a discriminated union by `type` field

## UI Rendering: Server-Driven UI

The UI for feed items is **server-driven**. Sources describe how their items look using a JSON tree (the `ui` field on `FeedItem`). The client renders these trees using [json-render](https://json-render.dev/) with a registered set of React Native components styled via [twrnc](https://github.com/jaredh159/tailwind-react-native-classnames).

### How it works

1. Sources return feed items with a `ui` field — a JSON tree describing the card layout using Tailwind class strings.
2. The client passes a component map to json-render. Each component wraps a React Native primitive and resolves `className` via twrnc.
3. json-render walks the tree and renders native components. twrnc parses Tailwind classes at runtime — no build step, arbitrary values work.
4. User interactions (tap, etc.) map to source actions via the `actions` field on `FeedItem`. The client sends action requests to the backend, which routes them to the correct source via `FeedEngine.executeAction()`.

### Styling

- Sources use Tailwind CSS class strings via the `className` prop (e.g., `"p-4 bg-white dark:bg-black rounded-xl"`).
- twrnc resolves classes to React Native style objects at runtime. Supports arbitrary values (`mt-[31px]`, `bg-[#eaeaea]`), dark mode (`dark:bg-black`), and platform prefixes (`ios:pt-4 android:pt-2`).
- Custom colors and spacing are configured via `tailwind.config.js` on the client.
- No compile-time constraint — all styles resolve at runtime.

### Two tiers of UI

- **Server-driven (default):** Any source can return a `ui` tree. Covers most cards — weather, tasks, alerts, package tracking, news, etc. Simple interactions go through source actions. This is the default path for both first-party and third-party sources.
- **Bespoke native:** For cards that need rich client interaction (gestures, animations, real-time updates), a native React Native component is registered in the json-render component map and referenced by type. Third parties that need this level of richness work with the FREYA team to get it integrated.

### Why server-driven

- Feed items are inherently server-driven — the data comes from sources on the backend. Attaching the layout alongside the data is a natural extension.
- Card designs can be updated without shipping an app update.
- Third-party sources can ship their own UI without bundling anything new into the app.

Reference: https://json-render.dev/

## Feed Items with UI and Slots

> Note: the codebase has evolved since the sections above. The engine now uses a dependency graph with topological ordering (`FeedEngine`, `FeedSource`), not the parallel reconciler described above. The `priority` field is being replaced by post-processing (see the ideas doc). This section describes the UI and enhancement architecture going forward.

Feed items carry an optional `ui` field containing a json-render tree, and an optional `slots` field for LLM-fillable content.

```typescript
interface FeedItem<TType, TData> {
	id: string
	type: TType
	timestamp: Date
	data: TData
	ui?: JsonRenderNode
	slots?: Record<string, Slot>
}

interface Slot {
	/** Tells the LLM what this slot wants — the source writes this */
	description: string
	/** LLM-filled text content, null until enhanced */
	content: string | null
}
```

### How it works

The source produces the item with a UI tree and empty slots:

```typescript
// Weather source produces:
{
  id: "weather-current-123",
  type: "weather-current",
  data: { temperature: 18, condition: "cloudy" },
  ui: {
    component: "VStack",
    children: [
      { component: "WeatherHeader", props: { temp: 18, condition: "cloudy" } },
      { component: "Slot", props: { name: "insight" } },
      { component: "HourlyChart", props: { hours: [...] } },
      { component: "Slot", props: { name: "cross-source" } },
    ]
  },
  slots: {
    "insight": {
      description: "A short contextual insight about the current weather and how it affects the user's day",
      content: null
    },
    "cross-source": {
      description: "Connection between weather and the user's calendar events or plans",
      content: null
    }
  }
}
```

The LLM enhancement harness fills `content`:

```typescript
slots: {
  "insight": {
    description: "...",
    content: "Rain after 3pm — grab a jacket before your walk"
  },
  "cross-source": {
    description: "...",
    content: "Should be dry by 7pm for your dinner at The Ivy"
  }
}
```

The client renders the `ui` tree. When it hits a `Slot` node, it looks up `slots[name].content`. If non-null, render the text. If null, render nothing.

### Separation of concerns

- **Sources** own the UI layout and declare what slots exist with descriptions.
- **The LLM** fills slot content. It doesn't know about layout or positioning.
- **The client** renders the UI tree and resolves slots to their content.

Sources define the prompt for each slot via the `description` field. The harness doesn't need to know what slots any source type has — it reads them dynamically from the items.

Each source defines its own slots. The harness handles them automatically — no central registry needed.

## Enhancement Harness

The LLM enhancement harness fills slots and produces synthetic feed items. It runs reactively — triggered by context changes, not by a timer.

### Execution model

```
FeedEngine.refresh()
  → sources produce items with ui + empty slots
         ↓
Fast path (rule-based post-processors, <10ms)
  → group, dedup, affinity, time-adjust
  → merge LAST cached slot fills + synthetic items
  → return feed to UI immediately
         ↓
Background: has context changed since last LLM run?
  (hash of: item IDs + data + slot descriptions + user memory)
         ↓
No  → done, cache is still valid
Yes → run LLM harness async
      → fill slots + generate synthetic items
      → cache result
      → push updated feed to UI via WebSocket
```

The user never waits for the LLM. They see the feed instantly with the previous enhancement applied. If the LLM produces new slot content or synthetic items, the feed updates in place.

### LLM input

The harness serializes items with their unfilled slots into a single prompt. Items without slots are excluded. The LLM sees everything at once and fills whatever slots are relevant.

```typescript
function buildHarnessInput(items: FeedItem[], context: AgentContext): HarnessInput {
	const itemsWithSlots = items
		.filter((item) => item.slots && Object.keys(item.slots).length > 0)
		.map((item) => ({
			id: item.id,
			type: item.type,
			data: item.data,
			slots: Object.fromEntries(
				Object.entries(item.slots!).map(([name, slot]) => [name, slot.description]),
			),
		}))

	return {
		items: itemsWithSlots,
		userMemory: context.preferences,
		currentTime: new Date().toISOString(),
	}
}
```

The LLM sees:

```json
{
	"items": [
		{
			"id": "weather-current-123",
			"type": "weather-current",
			"data": { "temperature": 18, "condition": "cloudy" },
			"slots": {
				"insight": "A short contextual insight about the current weather and how it affects the user's day",
				"cross-source": "Connection between weather and the user's calendar events or plans"
			}
		},
		{
			"id": "calendar-event-456",
			"type": "calendar-event",
			"data": {
				"title": "Dinner at The Ivy",
				"startTime": "19:00",
				"location": "The Ivy, West St"
			},
			"slots": {
				"context": "Background on this event, attendees, or previous meetings with these people",
				"logistics": "Travel time, parking, directions to the venue",
				"weather": "Weather conditions relevant to this event's time and location"
			}
		}
	],
	"userMemory": { "commute": "victoria-line", "preference.walking_distance": "1 mile" },
	"currentTime": "2025-02-26T14:30:00Z"
}
```

### LLM output

A flat map of item ID → slot name → text content. Slots left null are unfilled.

```json
{
	"slotFills": {
		"weather-current-123": {
			"insight": "Rain after 3pm — grab a jacket before your walk",
			"cross-source": "Should be dry by 7pm for your dinner at The Ivy"
		},
		"calendar-event-456": {
			"context": null,
			"logistics": "20-minute walk from home — leave by 18:40",
			"weather": "Rain clears by evening, you'll be fine"
		}
	},
	"syntheticItems": [
		{
			"id": "briefing-morning",
			"type": "briefing",
			"data": {},
			"ui": {
				"component": "Text",
				"props": { "text": "Light afternoon — just your dinner at 7. Rain clears by then." }
			}
		}
	],
	"suppress": [],
	"rankingHints": {}
}
```

### Enhancement manager

One per user, living in the `FeedEngineManager` on the backend:

```typescript
class EnhancementManager {
	private cache: EnhancementResult | null = null
	private lastInputHash: string | null = null
	private running = false

	async enhance(items: FeedItem[], context: AgentContext): Promise<EnhancementResult> {
		const hash = computeHash(items, context)

		if (hash === this.lastInputHash && this.cache) {
			return this.cache
		}

		if (this.running) {
			return this.cache ?? emptyResult()
		}

		this.running = true
		this.runHarness(items, context)
			.then((result) => {
				this.cache = result
				this.lastInputHash = hash
				this.notifySubscribers(result)
			})
			.finally(() => {
				this.running = false
			})

		return this.cache ?? emptyResult()
	}
}

interface EnhancementResult {
	slotFills: Record<string, Record<string, string | null>>
	syntheticItems: FeedItem[]
	suppress: string[]
	rankingHints: Record<string, number>
}
```

### Merging

After the harness runs, the engine merges slot fills into items:

```typescript
function mergeEnhancement(items: FeedItem[], result: EnhancementResult): FeedItem[] {
	return items.map((item) => {
		const fills = result.slotFills[item.id]
		if (!fills || !item.slots) return item

		const mergedSlots = { ...item.slots }
		for (const [name, content] of Object.entries(fills)) {
			if (name in mergedSlots && content !== null) {
				mergedSlots[name] = { ...mergedSlots[name], content }
			}
		}

		return { ...item, slots: mergedSlots }
	})
}
```

### Cost control

- **Hash-based cache gate.** Most refreshes reuse the cached result.
- **Debounce.** Rapid context changes (location updates) settle before triggering a run.
- **Skip inactive users.** Don't run if the user hasn't opened the app in 2+ hours.
- **Exclude slotless items.** Only items with slots are sent to the LLM.
- **Text-only output.** Slots produce strings, not UI trees — fewer output tokens, less variance.

## Open Questions

- How third parties authenticate/register their sources
- Exact set of React Native components exposed in the json-render component map
- Validation/sandboxing of third-party ui trees
- How synthetic items define their UI (full json-render tree vs. registered component)
- Should slots support rich content (json-render nodes) in the future, or stay text-only?
- How to handle slot content that references other items (e.g., "your dinner at The Ivy" linking to the calendar card)
