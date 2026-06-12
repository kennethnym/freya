# FREYA Agent Vision

## What We're Building

A personal assistant that feels like a person, not a tool.

The best human assistants don't wait to be asked. They prepare your briefing before the meeting. They remember you promised to call someone back. They know you hate early mornings and quietly rearrange things. They notice your mom's birthday is next week before you do.

That's the bar. Not "an app that shows you your calendar." A presence that knows you, anticipates you, and handles things so you don't have to think about them.

Everything below serves that goal.

---

## The Source Graph

The source graph is the foundation. It's the single shared substrate that both the feed and all agents read from.

Sources (calendar, weather, location, transit, etc.) form a dependency graph. The `FeedEngine` runs them in topological order, accumulating a shared context, then collects feed items. Reactive updates propagate through dependencies automatically.

Agents don't fetch their own data. They read what the graph already knows.

```
Sources → Source Graph → FeedEngine
                              ↓
                    ┌─────────┴──────────┐
                    ↓                    ↓
               Feed Items           Agent Layer
                    ↓                    ↓
                   UI              Proactive actions,
                                   enrichment, nudges
```

### Why this matters

- **No duplicate API calls.** The weather agent doesn't re-fetch weather — it reads what the weather source already fetched.
- **Consistent state.** Agents and feed see the same data. No drift between "what the feed shows" and "what the agent thinks."
- **Dependency ordering is free.** The Preparation Agent depends on calendar and contacts. The graph already handles execution order.
- **Agents can be sources.** A Summary Agent is just a `FeedSource` that depends on other sources and produces `summary`-type feed items. It participates in the graph like anything else.
- **Reactive propagation.** Location changes → graph re-runs dependents → agents that care about location re-evaluate automatically.

### One harness, not many agents

The "agents" in this doc describe _behaviors_, not separate running processes. A human PA is one person — they don't have a "calendar agent" and a "follow-up agent" in their head. They look at your whole situation and act on whatever matters.

FREYA works the same way. One LLM harness receives all feed items, all context, all user memory, and all available tools. It returns a single `FeedEnhancement`. Every behavior (preparation, follow-up, anomaly detection, tone adjustment, cross-source reasoning) is an instruction in the system prompt, not a separate agent.

The advantage: the LLM sees everything at once. It doesn't need agent-to-agent communication because there's no separation. It naturally connects "rain at 6pm" with "dinner at 7pm" because both are in the same context window.

The only separate LLM call is the **Query Agent** — because it's user-initiated and synchronous. But it uses the same system prompt and context. It's the same "person," just responding to a question instead of proactively enhancing the feed.

Everything else is either:

- **Rule-based post-processors** — pure functions, no LLM, run on every refresh
- **The single LLM harness** — runs periodically, produces cached `FeedEnhancement`
- **Background jobs** — daily summary compression, weekly pattern discovery

### Component categories

| Component                      | What it is                                | Examples                                                              |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------- |
| **FeedSource nodes**           | Graph participants that produce items     | Briefing, Preparation, Anomaly Detection, Follow-up, Social Awareness |
| **Rule-based post-processors** | Pure functions that rerank/filter/group   | TimeOfDay, CalendarGrouping, Deduplication, UserAffinity              |
| **LLM enhancement harness**    | Single background LLM call, cached output | Card rewriting, cross-source synthesis, tone, narrative arcs          |
| **Query interface**            | Synchronous LLM call, user-initiated      | Conversational Q&A, web search, delegation, actions                   |
| **Background jobs**            | Periodic data processing                  | Daily summary compression, weekly pattern discovery                   |
| **Persistence**                | Stored state that feeds into everything   | Memory store, affinity model, conversation history, feed snapshots    |

### AgentContext

The LLM harness and post-processors need a unified view of the user's world: current feed items, accumulated context, preferences, conversation history, feed snapshots. This is `AgentContext`.

`AgentContext` is **not** on the engine. The engine's job is source orchestration — running sources in dependency order, accumulating context, collecting items. It shouldn't know about user preferences, conversation history, or feed snapshots. Those are separate concerns.

`AgentContext` is a separate object that _reads from_ the engine and composes its output with other data stores:

```typescript
interface AgentContext {
	/** Current accumulated context from all sources */
	context: Context

	/** Recent feed items (last N refreshes or time window) */
	recentItems: FeedItem[]

	/** Query items from a specific source */
	itemsFrom(sourceId: string): FeedItem[]

	/** User preference and memory store */
	preferences: UserPreferences

	/** Conversation history */
	conversationHistory: ConversationEntry[]
}

// Constructed by composing the engine with persistence layers
const agentContext = new AgentContext({
	engine, // reads current context + items
	memoryStore, // reads/writes user preferences, discovered patterns
	snapshotStore, // reads feed history for pattern discovery
	conversationStore, // reads conversation history
})
```

This keeps the engine usable as a pure feed library without the AI layer — useful for testing and for anyone who wants `freya-core` without the agent features.

**Implementation:** `AgentContext` lives in a new package (`packages/freya-agent-context` or alongside the enhancement layer). It wraps a `FeedEngine` instance and the persistence stores. The ring buffer for recent items (last N=10 refreshes) lives here, not on the engine — `AgentContext` subscribes to the engine via `engine.subscribe()` and accumulates snapshots. The `itemsFrom(sourceId)` method filters the ring buffer by item type prefix. This is Phase 0 work.

---

## Feed Enhancement

Sources produce raw items with data. They don't decide ranking — that's the enhancement layer's job. It sits between the source graph output and the UI, transforming a flat bag of items into a feed that feels curated by a person.

The enhancement runs in two passes:

1. **Fast path (every refresh, no LLM, <10ms).** Deterministic rules that handle grouping, suppression, boosting, deduplication, and time-aware reranking. This is what makes the feed feel responsive.
2. **Slow path (periodic, LLM, every 15-30 minutes).** Produces cached enhancements — synthetic items, annotations, narrative framing — that the fast path merges in on subsequent refreshes. The user never waits for an LLM call.

```
Sources → Graph → Raw Items
                      ↓
              Fast path (rules)
              - group, suppress, boost, dedup, time-adjust
              - merge cached LLM enhancements
                      ↓
              Enhanced feed → UI

         ┌──────────────────────┐
         │  Slow path (LLM)    │
         │  runs in background  │
         │  output cached       │──→ cached enhancements
         └──────────────────────┘
```

The enhancement output:

```typescript
interface FeedEnhancement {
	/** New items to inject (briefings, nudges, suggestions) */
	syntheticItems: FeedItem[]

	/** Annotations attached to existing items, keyed by item ID */
	annotations: Record<string, string>

	/** Items to group together with a summary card */
	groups: Array<{ itemIds: string[]; summary: string }>

	/** Item IDs to suppress or deprioritize */
	suppress: string[]

	/** Ranking hints: item ID → relative importance (0-1) */
	rankingHints: Record<string, number>
}
```

**Implementation:** Add a `postProcessors` array to `FeedEngine`. After `refresh()` collects raw items, it runs each processor in sequence. Each processor receives the current items + `AgentContext` and returns a `FeedEnhancement`. The engine merges all enhancements: injects synthetic items, attaches annotations to matching item IDs, applies grouping, filters suppressed items, and applies ranking hints as score adjustments. The `AgentContext` is passed in from outside — the engine doesn't construct it. The LLM slow path is a separate background loop that writes its `FeedEnhancement` to a cache (in-memory or Redis). The fast path reads from that cache on every refresh and merges it alongside the rule-based enhancements.

```typescript
interface FeedPostProcessor {
  id: string
  process(items: FeedItem[], context: AgentContext): Promise<FeedEnhancement>
}

// On FeedEngine:
registerPostProcessor(processor: FeedPostProcessor): void
```

### Rule-Based Enhancements (no LLM)

These run on every refresh. Fast, deterministic, and cover most of the ranking quality.

**Group calendar events by time window.** Three meetings between 2-5pm become one card: "Busy afternoon — 3 back-to-back meetings starting at 2pm." Overlap detection is comparing start/end times.

**Suppress weather on normal days.** If condition is clear and no calendar events have locations, deprioritize weather to the bottom. On a day with an outdoor event or severe weather, promote it.

**Boost TfL alerts for your route.** Match TfL line disruptions against calendar event locations near stations on that line. The haversine distance calculation already exists in the TfL source.

**Time-of-day reranking.** Morning: boost weather, commute info, first meeting. Pre-meeting window (30 min before): boost that meeting's card, suppress low-priority items. Evening: suppress work calendar, boost personal items. Weekend: different weights entirely.

**Freshness decay.** Track which items the user has seen by ID. Decay ranking for items that haven't changed since last view. A weather card showing the same temperature for 3 hours straight should sink.

**Deduplication across sources.** Apple Calendar and Google Calendar showing the same event — match on title + time window, keep one.

**"You haven't talked to X in N months."** Count days since last calendar event with a person. Pure threshold check against contact frequency history.

**Anomaly detection.** Compare event start times against the user's historical distribution. A 6am meeting when the user never has meetings before 9am is a statistical outlier — flag it.

**User affinity scoring.** Track implicit signals per source type per time-of-day bucket:

- Dismissals: user swipes away weather cards → decay affinity for weather
- Taps: user taps calendar items frequently → boost affinity for calendar
- Dwell time: user reads TfL alerts carefully → boost

No LLM needed. A simple decay/boost model:

```typescript
interface UserAffinityModel {
	affinities: Record<string, Record<TimeBucket, number>>
	dismissalDecay: number
	tapBoost: number
}
```

**Implementation:** Build these as individual `FeedPostProcessor` implementations in a `packages/freya-feed-enhancers` package. Each enhancer is a pure function: items in, enhancement out. Start with three: `TimeOfDayEnhancer`, `CalendarGroupingEnhancer`, `UserAffinityEnhancer`. The affinity model needs a persistence layer — a simple JSON blob per user stored in the database, updated on each dismiss/tap event sent from the client via the WebSocket `feed.interact` method (new JSON-RPC method to add). Time buckets: morning (6-12), afternoon (12-17), evening (17-22), night (22-6).

### LLM-Powered Enhancements

These run periodically in the background. Their output is cached and merged into the fast path. Everything here requires understanding meaning, not just comparing numbers.

**Contextual card rewriting.** The calendar source produces "Q3 Budget Review" as the title. The assistant rewrites the card: "Your quarterly budget review with Sarah and the finance team — you presented the revised numbers last time, they may have follow-up questions." Same event, but now it tells you what to expect.

**Cross-source synthesis.** Rain forecast at 6pm + dinner reservation at 7pm → "Rain expected at 6pm — bring an umbrella for your dinner at The Ivy." The detection (rain + evening event) could be rule-based. The natural language card needs an LLM.

**Narrative daily arc.** Instead of isolated cards, a single synthesized card that tells the story of the day: "Your morning is meetings-heavy, but you're free after 2pm. Weather clears up around 3 — good window for that walk you've been skipping. Dinner at 7, 20-minute walk from home."

**Mood-aware tone.** 8 meetings, no breaks, a deadline → terse, no fluff, just facts across all cards. Light day with sunshine → warmer: "Nice afternoon ahead — just your 2pm with James, then you're free." Weekend → casual: "Nothing on the calendar. Weather's gorgeous. Maybe that hike you keep saying you'll do?"

**"Why this matters" annotations.** A TfL alert for the Northern line normally just says "Minor delays." The assistant adds: "This is your usual line to the office, and you have a 9am — leave 15 minutes early." Connects the disruption to the user's actual life.

**Conflict resolution suggestions.** Two meetings overlap. Instead of just flagging it: "Your 2pm with Sarah and 2:30 with the design team overlap. The design sync is recurring and you've skipped it twice before without issues — you could skip it again, or ask Sarah to start 30 minutes earlier."

**Speculative suggestions.** "You have a 2-hour gap between meetings near Shoreditch. Last time you were there you went to that coffee shop on Redchurch Street — want to go again?" Requires understanding location, free time, and past behavior, then generating a suggestion that feels personal.

**Proactive research.** "You're meeting with Acme Corp tomorrow. They just announced a new product line last week and their stock dropped 4%. Their CTO published a blog post about pivoting to AI. Might come up." The assistant searched the web, filtered for relevance, and summarized without being asked.

**Travel narrative.** User has a flight tomorrow. Instead of separate cards for flight, weather, calendar, hotel: "You land in Edinburgh at 11am. It'll be 8°C and overcast. First meeting isn't until 3pm, so you have time to check in and grab lunch. Hotel is 20 minutes from the airport by tram."

**Emotional context on people.** "Meeting with Alex at 3pm" becomes "Meeting with Alex at 3pm — heads up, your last two 1:1s ran long and you seemed frustrated afterward. Might be worth setting a hard stop." Requires sentiment analysis of past interaction patterns.

**Gift and occasion suggestions.** "Sarah's birthday is Saturday. Last year you got her a book. She's mentioned recently she's been into pottery — maybe a class voucher?" Remembers past gifts, extracts interests from conversations, generates a creative suggestion.

**Reframing bad news.** "Your flight is delayed 2 hours" becomes "Your flight is delayed until 3pm. Silver lining — your 1pm meeting that was going to be tight now has plenty of buffer. Use the extra time at the airport to prep for tomorrow's presentation."

**Connecting forgotten dots.** "You bookmarked a restaurant called Padella three weeks ago and said you wanted to try it. You have a free evening Thursday and it's a 10-minute walk from your last meeting. Want me to check if they take reservations?"

**Post-event reflection prompts.** After a big meeting or presentation: "Your pitch to the investors just ended. How did it go? Anything you want to remember for next time?" The assistant knows the event just ended and prompts reflection.

**Subtle ranking explanations.** Occasional small annotation on why something is shown first: "Showing this first because you have 10 minutes before you need to leave, and traffic is heavier than usual." Builds trust without the user asking "why am I seeing this?"

**Weekend personality shift.** On weekdays the assistant is efficient and professional. On weekends it's a different mode — not just different tone, but different thinking about what to surface. Leisure suggestions, personal errands, social nudges over work items.

### Slot Ideas

These enhancements are delivered via slots on source-produced feed items. Each source declares slots with descriptions; the LLM fills them with text. See the architecture doc for the slot mechanism.

**Weather cards:**

- `insight` — "Rain after 3pm — grab a jacket before your walk"
- `cross-source` — "Should be dry by 7pm for your dinner at The Ivy"
- `suggestion` — "Good window for a walk between 1-3pm"

**Weather alerts:**

- `impact` — "This is your usual commute line — leave 15 minutes early"
- `action` — "Your 9am meeting is near King's Cross — consider the bus instead"

**Calendar events:**

- `context` — "Third meeting with Sarah this month. Last time you discussed Q3 budget."
- `prep` — "She mentioned sending revised numbers — check your email"
- `attendees-insight` — "Heads up — your last two 1:1s with Alex ran long"
- `logistics` — "25-minute walk or 8-minute Uber. Street parking is difficult."
- `conflict` — "Overlaps with design sync at 2:30 — you've skipped it twice before without issues"
- `weather` — "Rain expected at that time — bring an umbrella"
- `post-event` — "Your pitch just ended. How did it go?"

**All-day events:**

- `context` — "Sarah's birthday — last year you got her a book. She's been into pottery lately."
- `suggestion` — "Maybe a pottery class voucher?"

**TfL alerts:**

- `impact` — "This is your usual line to the office"
- `alternative` — "Victoria line is running normally — 5 minutes longer but no delays"
- `calendar-link` — "You have a 9am meeting — leave by 8:15 instead of 8:30"

**Future sources (tasks, email, etc.):**

- Task card `urgency` — "The birthday party is tomorrow — this is getting urgent"
- Task card `scheduling` — "You have a free hour at 2pm — good time to knock this out"
- Email card `context` — "Sarah sent this 3 days ago — you said you'd reply by Monday"
- Email card `summary` — "She's asking about the Q3 timeline. Last you discussed, it was end of October."

**Implementation:** See "How the Harness Runs" below for the reactive execution model.

---

## Emergent Behavior

Most of what makes FREYA feel like a person isn't hardcoded. It emerges from giving the LLM the right context and the right prompt.

### What's hardcoded vs. what's emergent

There are three layers:

**Emergent (prompt instructions, no code).** About half the behaviors in this doc need zero logic. They're instructions in the system prompt + the full feed context. The LLM figures out the rest.

- Contextual Preparation — "Here are upcoming events + web search tool. Prepare the user."
- Daily Briefing — "Here are all items. Summarize the day."
- Anticipatory Logistics — "Work backward from this event. What does the user need to do?"
- Anticipating Questions — "What would the user want to know? Search for answers."
- Cross-Source Reasoning — "Look for connections between items." Happens naturally when the LLM sees everything at once.
- Decision Support — "The user has conflicting events. Lay out the options."
- Energy Awareness — "The user has been in meetings for 4 hours. Notice this."
- Health Nudges — "The user hasn't moved. Gently mention it."
- Context Switching — "The next event is very different. Help the user transition."
- Micro-Moments — "There's a short gap. What's changed since the user last checked?"
- Celebration — "Notice positive patterns and occasionally acknowledge them."
- Personality, Confidence, Handoff — all system prompt tone instructions.

None of these have `if` statements. The LLM reads the feed, reads the user's memory, and decides what to say. Add a new source (Spotify, email, tasks) and the LLM automatically incorporates it — no new behavior code needed.

**Infrastructure (plumbing needed, but logic is emergent).** These need tables, APIs, and background jobs. But the _decision-making_ — what to extract, when to surface, how to phrase — is all LLM.

- Gentle Follow-up — needs: extraction pipeline after each conversation turn, `commitments` table. The LLM decides what counts as a commitment and when to remind.
- Memory — needs: `memories` table, read/write API. The LLM decides what to remember and how to use it.
- Learning from Corrections — needs: correction detection pipeline, memory writes. The LLM decides what counts as a correction.
- Routine Learning — needs: snapshot storage, daily compression job, weekly pattern discovery trigger. The LLM discovers patterns dynamically.
- Taste & Preference — needs: storage layer, decay model. The LLM extracts preferences from conversation.
- Query & Conversation — needs: WebSocket method, conversation history, tool routing. The LLM decides how to answer.
- Web Search — needs: search API wrapper, cache. The LLM decides when and what to search.
- Delegation — needs: confirmation flow, write-back infrastructure. The LLM decides what the user wants done.
- Financial Awareness — needs: `financial_events` table, email extraction. The LLM decides what financial events matter.

**Hardcoded rules (fast path, must be deterministic).** These run on every refresh in <10ms. They _should_ be rules because they need to be fast and predictable.

- User affinity scoring — decay/boost math on tap/dismiss events
- Deduplication — title + time matching across sources
- Calendar grouping — time-window overlap detection
- Time-of-day reranking — morning/afternoon/evening weight buckets
- Notification routing — push/digest/silent threshold rules
- State detection — calendar density → busy, no activity → sleeping
- Hold queue — sleep hours suppression, pre-meeting suppression
- Silence / "all clear" — item count threshold
- Memory decay — confidence score decay math
- Freshness — seen/unseen tracking

These are ~10 small pure functions. Everything else is the LLM reading context and responding.

### The system prompt

The core of FREYA's behavior is one prompt. Roughly:

```
You are FREYA, a personal assistant. Here is everything happening
in the user's life right now:

[serialized feed items from all sources]

Here is what you know about them:

[user preferences, discovered patterns, memory]

Here is their recent conversation history:

[last N turns]

Here are your tools:

[web search, calendar query, ...]

Look at all of this and produce a FeedEnhancement:
- What new cards should the user see?
- What existing cards need context or annotations?
- What should be grouped together?
- What should be suppressed?
- How should items be ranked?

Guidelines:
- Be warm but concise. Say "I" not "we."
- When inferring, hedge. Don't state guesses as facts.
- Notice positive things, not just problems.
- If the user's day is simple, say so. Don't pad the feed.
- Work backward from events — what does the user need to do?
- Look for connections between items across sources.
- Match your tone to the user's current state.
- When you can't do something, say so and suggest alternatives.
```

As you add sources, the `[serialized feed items]` section grows. As the user interacts, the `[memory]` section grows. The prompt stays the same. The behavior evolves because the context evolves.

---

## How the Harness Runs

The harness doesn't run on a timer. It runs reactively — triggered by context changes, not by a clock.

### The execution model

```
User opens app / pull-to-refresh / context change
         ↓
    FeedEngine.refresh()
    → runs sources in dependency order
    → collects raw items
         ↓
    Fast path (rule-based post-processors, <10ms)
    → group, dedup, affinity, time-adjust
    → merge LAST cached FeedEnhancement
    → return feed to UI immediately
         ↓
    Background: has context changed?
    (hash of items + location + time bucket + preferences)
         ↓
    No  → done, cached enhancement is still valid
    Yes → run LLM harness async
          → cache new FeedEnhancement
          → push updated feed to UI via WebSocket
```

The user never waits for the LLM. They see the feed instantly with the previous enhancement applied. If the LLM produces something new, the feed updates in place a moment later.

### The enhancement manager

One per user, living in the `FeedEngineManager` on the backend:

```typescript
class EnhancementManager {
	private cache: FeedEnhancement | null = null
	private lastInputHash: string | null = null
	private running = false

	async enhance(items: FeedItem[], context: AgentContext): Promise<FeedEnhancement> {
		const hash = computeHash(items, context)

		// Nothing changed — return cache
		if (hash === this.lastInputHash && this.cache) {
			return this.cache
		}

		// Already running — return stale cache
		if (this.running) {
			return this.cache ?? emptyEnhancement()
		}

		// Run in background, update cache when done
		this.running = true
		this.runHarness(items, context, hash)
			.then((enhancement) => {
				this.cache = enhancement
				this.lastInputHash = hash
				this.notifySubscribers(enhancement)
			})
			.finally(() => {
				this.running = false
			})

		// Return stale cache immediately
		return this.cache ?? emptyEnhancement()
	}
}
```

### When the harness runs

Most refreshes don't trigger the LLM — the hash matches and the cache is reused. The harness only runs when something actually changed:

- New calendar event appeared
- Location shifted significantly (>500m)
- Weather conditions changed
- Time bucket changed (morning → afternoon)
- User preferences updated
- New items from any source

### Scheduled exceptions

A few things run on a schedule rather than reactively:

- **Morning briefing** — generated at the user's wake-up time (from Routine Learning), even if nothing changed overnight
- **Evening recap** — generated at the user's wind-down time
- **Weekly pattern discovery** — the Routine Learning job that analyzes daily summaries
- **Memory decay** — nightly job that reduces confidence scores

These are background jobs on the backend, not part of the refresh cycle.

### Cost control

The hash-based cache gate is the primary cost control. Additional measures:

- **Debounce rapid changes.** If location updates 10 times in a minute, only run the harness once after the updates settle.
- **Skip if user isn't active.** If the user hasn't opened the app in 2 hours, don't run the harness on background refreshes — just accumulate changes and run once when they return.
- **Input truncation.** If there are 30+ items, summarize older/lower-relevance items before sending to the LLM to keep token count manageable.
- **Model selection.** Use a cheap model (GPT-4.1 mini, Gemini Flash) for enhancement runs. Reserve capable models for query responses where the user is waiting.

---

## Behaviors

What the assistant does, organized by what makes it feel like a person. These aren't separate agents — they're capabilities of the single LLM harness and the rule-based post-processors. Some are implemented as `FeedSource` nodes in the graph, some as post-processor functions, some as instructions in the harness prompt.

---

### It Knows What's Coming

#### Contextual Preparation

The most important agent for the human-assistant feel. A good PA prepares you for things before you ask.

- Before a meeting: attendee backgrounds, last email thread with them, shared docs, previous meeting notes
- Before a flight: weather at destination, terminal info, transit options from airport, visa/currency if international
- Before a dinner: restaurant menu, dress code, parking, reviews
- Before a presentation: audience context, previous deck versions
- Before a doctor's appointment: last visit notes, insurance info

Triggered by upcoming calendar events. Runs 30-60 minutes before. Classifies the event type (meeting, travel, social, medical) and tailors the prep. Produces a "prep card" feed item.

This is the feature that makes someone say "how did it know I needed that?"

**Implementation:** Emergent from the harness. The LLM sees upcoming calendar events in the feed context and naturally generates prep cards. The system prompt says: "For events in the next 60 minutes, prepare the user. Use web search for attendee/company lookups, venue details, travel info." No event-type classifier needed — the LLM infers whether it's a meeting, dinner, or flight from the event title and details. **Infrastructure needed:** web search tool available to the harness, cache prep cards by event ID so they're not regenerated on every run.

#### Daily Briefing & Recap

Morning: "You have 4 meetings today. Busiest window is 2-4pm. Weather is rain after 3pm — you might want to move your walk. Sarah's birthday is tomorrow."

Evening: "You completed 5 tasks. You have an early meeting tomorrow at 8am. Your flight to Edinburgh is in 2 days — here's what to prepare."

Weekly: "You had 12 meetings this week, completed 8 tasks, 3 are overdue. Next week looks lighter."

These are `FeedSource` nodes that depend on calendar, tasks, weather, and other sources. They synthesize, they don't just list.

**Implementation:** Emergent from the harness. The LLM sees all items + time of day and naturally produces a summary when appropriate. The system prompt says: "In the morning, synthesize a briefing. In the evening, recap the day." **Infrastructure needed:** scheduled harness runs at morning/evening windows (see "Scheduled exceptions" in How the Harness Runs). Store last briefing timestamp to avoid regenerating within the same window.

#### Anticipatory Logistics

Works backward from events to tell you what you need to _do_ to be ready.

- Flight at 6am → "You need to leave by 4am, which means waking at 3:30. I'd suggest packing tonight."
- Dinner at a new restaurant → "It's a 25-minute walk or 8-minute Uber. Street parking is difficult — there's a car park on the next street."
- Presentation tomorrow → "Your slides are in Google Drive. Last edit was 3 days ago. Want to review them tonight?"
- Guest coming to your flat → "You mentioned the spare room needs tidying. They arrive at 2pm."

Not just "what's happening" but "what do you need to do before it happens."

**Implementation:** Emergent from the harness. Part of the prep card generation — the system prompt says: "Work backward from events. What does the user need to do beforehand? Consider travel time, preparation, packing." The LLM reasons about event type and timing naturally. **Infrastructure needed:** a maps/directions API (Google Directions or Apple Maps) exposed as a tool for travel time calculations.

#### Context Switching Buffers

Surfaces a transition card when you're about to shift between very different activities.

- Deep-focus coding session → client meeting in 10 minutes: "Switching context — your meeting with the client is in 10 minutes. You've been heads-down for 2 hours. Key topics: budget approval, timeline for Phase 2."
- Back-to-back meetings with different teams: "Next up is the design review — different group, different topic. Here's the agenda."
- Work → personal evening: "Last meeting just ended. You have dinner at 7 — that's 2 hours from now. Nothing else on the work calendar."

**Implementation:** Emergent from the harness. The LLM sees adjacent calendar events and naturally notices when they're very different. The system prompt says: "When the user is about to switch between very different activities, help them transition." No rule-based trigger needed — the LLM reads the calendar and decides if a transition card is warranted.

#### Anticipating Questions

Answers questions before they're asked by pre-fetching information related to upcoming events.

- Just booked a flight → "Your flight is with BA, terminal 5, 2 bags included, check-in opens 24 hours before. Heathrow Express from Paddington takes 15 minutes."
- New restaurant on the calendar → menu, reviews, parking, dress code — all pre-fetched
- Meeting with a new client → company background, recent news, attendee LinkedIn summaries
- Doctor's appointment → "Bring your insurance card. Last visit was 6 months ago."

**Implementation:** Emergent from the harness. The LLM sees new calendar events and anticipates what the user would want to know. The system prompt says: "For new events, think about what questions the user would have and search for answers." **Infrastructure needed:** web search tool, annotation cache per event ID. For flights specifically, a flight tracking source (FlightAware API) would provide real-time data.

#### Anomaly Detection

Surfaces things that break routine, because those are the things you miss.

- "You have a meeting at 6am tomorrow — that's unusual for you"
- "This is your first free afternoon in 2 weeks"
- "You haven't completed any tasks in 3 days"
- "Your calendar is empty tomorrow — did you mean to block time?"
- "You have 3 meetings that overlap between 2-3pm"

**Implementation:** Mostly rule-based — no LLM needed for detection. Build as a `FeedSource` (`freya.anomaly`) that depends on calendar sources. Maintain a rolling histogram of the user's meeting start times (stored in the preference/memory DB). On each refresh, compare upcoming events against the histogram. Flag events outside 2 standard deviations. Overlap detection is comparing time ranges. "First free afternoon in N weeks" requires storing daily busyness scores. The anomaly items are `FeedItem`s with type `anomaly` — the LLM is only needed to phrase the message naturally, which can be done with simple templates for v1 ("You have a meeting at {time} — that's unusual for you").

---

### It Remembers

#### Gentle Follow-up

Tracks loose ends — things you said but never wrote down as tasks.

- "You said you'd send that proposal to Sarah on Monday — did you?"
- "You mentioned wanting to book a dentist appointment last week"
- "You told James you'd review his PR — it's been 3 days"
- "You promised to call your mom this weekend"

The key difference from task tracking: this catches things that fell through the cracks _because_ they were never formalized.

**How intent extraction works:**

The realistic v1 has two channels:

1. **FREYA conversations (free, no privacy concerns).** Every conversation flows through the Query Agent. When the user says "I'll send that to Sarah tomorrow," the system extracts the intent (action: send something, person: Sarah, deadline: tomorrow) and stores it. No extra permissions needed — the user is already talking to FREYA.

2. **Email scanning (opt-in).** Connect Gmail/Outlook as a source. Scan outbound emails for commitment language: "I'll get back to you," "let me check on that," "I'll send this by Friday." LLM extracts intent + deadline + person. This catches most professional commitments since email is where they're made. Privacy-sensitive — must be explicit opt-in.

Later channels (harder, deferred): meeting transcripts (Otter, Fireflies, Google Meet) for action items from meetings. Calendar heuristics ("you met Sarah 3 days ago and haven't emailed her since") as a weaker signal. Cross-app monitoring (Slack, iMessage) is mostly impractical due to access restrictions.

**Behavior:**

Surfaces gentle reminders — not nagging, more like "hey, just in case." Learns which follow-ups the user appreciates vs. dismisses. Backs off on topics the user ignores repeatedly.

**Implementation:** Two parts: extraction and surfacing. Extraction runs as a side-effect of the Query Agent — after every conversation turn, pass the user's message through an LLM with a structured output schema: `{ hasCommitment: boolean, action?: string, person?: string, deadline?: string }`. Store extracted commitments in a `commitments` table (user_id, action, person, deadline, status, created_at, dismissed_count). Surfacing is a `FeedSource` (`freya.followup`) that queries the commitments table for items past their deadline or approaching it. If the user dismisses a follow-up, increment `dismissed_count`; stop showing after 3 dismissals. Email scanning (v2) adds a second extraction path: a background job that processes new sent emails through the same LLM extraction.

#### Memory

Long-term memory of interactions and preferences. Feeds into every other agent.

- Remembers user dismissed a recurring item 5 times → stops showing it
- Knows user's home/work locations from patterns
- Tracks what times user typically checks the feed
- Remembers stated preferences from conversations
- Builds implicit preference model over time

**Implementation:** A key-value store per user. Keys are namespaced: `memory.location.home`, `memory.location.work`, `memory.preference.morning_check_time`, `memory.dismissed.weather_count`. Updated by multiple agents — the affinity model writes dismissal counts, the routine learning agent writes detected patterns, the query agent writes explicit preferences from conversation ("I prefer morning meetings" → `memory.preference.meeting_time = morning`). Use a simple `memories` table (user_id, key, value_json, updated_at, source_agent). Every agent that needs user context reads from this table via the `AgentContext.preferences` field. Start with explicit writes only; implicit pattern detection comes with Routine Learning.

#### Taste & Preference

A persistent profile that builds over time. Not an agent itself — a system that makes every other agent smarter.

Learns from:

- Explicit statements: "I prefer morning meetings"
- Implicit behavior: user always dismisses evening suggestions
- Feedback: user rates suggestions as helpful/not
- Cross-source patterns: always books aisle seats, always picks the cheaper option

Used by:

- Proactive Agent suggests restaurants the user would actually like
- Delegation Agent books the right kind of hotel room
- Summary Agent uses the user's preferred level of detail
- Tone & Timing knows the user checks their phone at 7am, not 6am

**Implementation:** Not a separate service — it's the Memory store with two write paths. Explicit: the Query Agent extracts preferences from conversation using an LLM ("I hate early mornings" → `preference.morning_aversion = true`). Implicit: the affinity model and routine learning agent write observed patterns. The preference store is included in every LLM prompt as part of the system context, so all agents automatically adapt. Schema: same `memories` table, but with a `confidence` field (0-1) — explicit statements get confidence 1.0, implicit observations start at 0.3 and increase with repetition.

#### Routine Learning

Detects daily/weekly routines without being told — and discovers patterns you'd never think to hardcode.

- Notices user goes to the gym every Tuesday and Thursday → pre-surfaces gym bag reminder
- Detects weekly grocery shopping on Sundays → surfaces shopping list Saturday evening
- Learns commute pattern → only alerts on deviations
- Knows user reviews email at 9am and 2pm → batches summaries accordingly
- Recognizes wind-down routine → stops surfacing work items after 6pm
- Discovers patterns across new sources automatically — add Spotify and it might notice "lo-fi every morning while checking the feed"

Passive observation. The patterns aren't hardcoded — the LLM discovers them from feed history.

**Implementation:** Three-stage pipeline: snapshot storage, daily compression, weekly pattern discovery.

**Stage 1: Snapshot storage (every refresh).** Store each post-enhancement feed snapshot with timestamp. A snapshot is the full `FeedItem[]` + context + interaction events (taps, dismissals). ~5-15KB per snapshot, 100-200/day = 1-3MB/day/user. Store in a `feed_snapshots` table. Trim raw snapshots older than 7 days.

**Stage 2: Daily summary (rule-based, nightly job).** Compress each day's snapshots into a structured summary — no LLM needed:

```typescript
interface DailySummary {
	date: string
	feedCheckTimes: string[] // when the user opened the feed
	itemTypeCounts: Record<string, number> // how many of each type appeared
	interactions: Array<{
		// what the user tapped/dismissed
		itemType: string
		action: "tap" | "dismiss" | "dwell"
		time: string
	}>
	locations: Array<{
		// where the user was throughout the day
		lat: number
		lng: number
		time: string
	}>
	calendarSummary: Array<{
		// what events happened
		title: string
		startTime: string
		endTime: string
		location?: string
		attendees?: string[]
	}>
	weatherConditions: string[] // conditions seen throughout the day
}
```

~1-2KB per daily summary. Store in a `daily_summaries` table. Keep for 90 days.

**Stage 3: Pattern discovery (LLM, weekly background job).** Feed the last 14-30 daily summaries to the LLM. Prompt: "What recurring patterns do you see in this person's life? Look for routines, habits, preferences, and anything that repeats on a schedule." The LLM returns dynamically discovered patterns:

```typescript
interface DiscoveredPattern {
	/** What the pattern is, in natural language */
	description: string
	/** How confident (0-1) */
	confidence: number
	/** When this pattern is relevant */
	relevance: {
		daysOfWeek?: number[]
		timeRange?: { start: string; end: string }
		conditions?: string[]
	}
	/** How this should affect the feed */
	feedImplication: string
	/** Suggested card to surface when pattern is relevant */
	suggestedAction?: string
}
```

Store discovered patterns in the `memories` table. The enhancement harness includes them in its system prompt and naturally adapts — "it's Tuesday evening, which is usually free for this user, so surface leisure suggestions."

**Why LLM-driven pattern discovery matters:** You don't define what patterns to look for. The LLM finds them. As you add new sources, it automatically discovers patterns involving them. No new code needed. A hardcoded approach would require writing a detector for every possible pattern — commute patterns, meeting patterns, weather preferences, social habits. The LLM handles all of these with a single prompt.

**Cost:** 30 daily summaries × 2KB = ~60KB input ≈ 15K tokens. One call per week per user. Negligible.

---

### It Notices

#### Social Awareness

Maintains awareness of relationships and surfaces timely nudges.

- "It's your mom's birthday next week"
- "You haven't talked to James in 3 months — you used to meet monthly"
- "Sarah mentioned she's been sick — you might want to check in"
- "You and Alex have a meeting tomorrow — last time was tense, heads up"
- "Tom just started a new job — might be worth a congratulations"

Needs: contacts with birthday/anniversary data, calendar history for meeting frequency, email/message signals, optionally social media.

This is what makes an assistant feel like it _cares_. Most tools are transactional. This one remembers the people in your life.

Beyond frequency, the assistant can understand relationship _dynamics_:

- "You and Sarah always have productive meetings. You and Alex tend to go off-track — maybe set a tighter agenda."
- "You've cancelled on Tom three times — he might be feeling deprioritized."
- "Your meetings with the design team have been getting longer — they averaged 30 min last month, now they're 50 min."

**Implementation:** Requires a contacts source (Apple Contacts via CardDAV, or Google People API) — build this as a new `FeedSource` that provides contact context (birthdays, anniversaries) to the graph. The social awareness agent is a `FeedSource` (`freya.social`) that depends on the contacts source and calendar sources. Birthday/anniversary detection: compare contact dates against current date, surface items 7 days before. Meeting frequency: query calendar history for events containing a contact's name, compute average interval, flag when current gap exceeds 2x the average. The "Sarah mentioned she's been sick" level requires email/message scanning — defer to v2. For v1, stick to birthdays + meeting frequency, which are purely rule-based.

#### Ambient Context

Monitors the world for things that affect you, beyond weather and location.

- Train strike on your commute line tomorrow
- The restaurant you booked just closed permanently
- A package you ordered is delayed
- Your flight's aircraft was swapped
- Local event causing road closures near your office
- Price drop on something you've been watching
- Breaking news relevant to your industry

A human assistant would flag these without being asked. You shouldn't have to go looking for problems.

**Implementation:** A collection of specialized `FeedSource` nodes, each monitoring a specific external signal. Start with what's closest to existing sources: `freya.tfl` already handles transit — extend it to check for planned strikes/closures (TfL API has this data). Package tracking: a new source (`freya.packages`) that polls tracking APIs (Royal Mail, UPS) given tracking numbers extracted from email (requires email source). News: a source (`freya.news`) that uses a news API (NewsAPI, Google News) filtered by user interests from the preference store. Each of these is independent and produces its own feed items. The cross-source connection ("train strike affects your commute") happens in the LLM enhancement layer, not in the source itself.

#### Energy Awareness

Notices when you're running on empty and suggests recovery.

- "You've been in back-to-back meetings since 9am with no break. Your 3pm presentation is important — grab lunch during your 1:30 gap. There's a Pret 2 minutes from your office."
- "You have 6 hours of meetings today and no lunch blocked. Want me to block 12:30-1pm?"
- "You've had 3 intense meetings this morning. Your next one isn't until 3pm — good time to decompress."
- "It's 7pm and you're still in meetings. You've been going for 10 hours."

**Implementation:** Emergent from the harness. The LLM sees the full calendar and naturally notices meeting density, missing breaks, and long stretches. The system prompt says: "Notice when the user has been in meetings for a long time without a break. Suggest recovery." **Infrastructure needed:** a places API (Google Places) exposed as a tool for location-aware suggestions ("Pret 2 minutes away").

#### Health Nudges

Gentle, not preachy. A PA who notices you're not taking care of yourself and says something once.

- "You've been sitting in meetings for 4 hours straight — maybe take a walk."
- "You haven't left the house today." (inferred from location not changing)
- "It's been 6 months since you mentioned wanting to book a dentist."
- "You've been working past 10pm three nights this week."
- "Nice weather outside and you have a free hour — good time for some air."

**Implementation:** Emergent from the harness. The LLM sees location context (unchanged for hours), calendar patterns (late-night events), and memory (mentioned wanting to book a dentist). The system prompt says: "Gently notice when the user isn't taking care of themselves. Say it once, casually, not preachy." **Infrastructure needed:** nudge cooldown tracking in the memory table — store last nudge timestamp per type, back off for a week if dismissed. This is the one piece of hardcoded logic: the cooldown prevents the LLM from nagging.

#### Cross-Source Reasoning

Connects information across sources to surface insights no single source could produce.

- Calendar shows dinner reservation + weather shows rain → "Bring an umbrella to dinner"
- Flight delayed + calendar has meeting after landing → "Your 3pm meeting may be affected"
- Task "buy birthday gift" + calendar shows birthday party tomorrow → boosts task priority
- Email mentions address + maps knows traffic → "Leave by 2pm to make your 3pm"

This is where the source graph pays off. All the data is already there — the assistant just draws connections.

**Implementation:** Fully emergent. The LLM sees all items from all sources in a single context window. It naturally connects rain + dinner, flight delay + meeting, task + calendar event. The system prompt says: "Look for connections between items across different sources. When you find one, synthesize a card explaining the connection." No rule-based matching needed — the LLM handles both simple cases (weather + calendar) and nuanced ones ("is this event outdoors?").

---

### It Talks to You Right

#### Tone & Timing

Controls _when_ and _how_ information is delivered. The difference between useful and annoying.

- Bad news before morning coffee? Hold it.
- Three notifications in a row? Batch them.
- In a meeting? Hold everything except emergencies.
- Just landed after a long flight? Gentle summary, not a wall of alerts.
- Friday evening? Don't surface work items unless urgent.
- User seems stressed (many conflicts, short responses)? Reduce volume.

Maintains a model of user state: busy, relaxed, traveling, sleeping, focused. Adjusts delivery timing, grouping, and tone. Respects explicit modes (DND, Focus) and infers implicit ones.

Invisible when done right. The user just notices the assistant "gets" them.

**Implementation:** A `FeedPostProcessor` that wraps around all other post-processors. It maintains a user state model: `{ state: "busy" | "relaxed" | "traveling" | "sleeping" | "focused", confidence: number }`. State is inferred from: calendar density (3+ overlapping events = busy), location velocity (moving fast = traveling), time of day + no activity (sleeping), DND/Focus mode from device (if available via client). The processor adjusts delivery: in "busy" state, suppress everything below a threshold except the current/next meeting. In "sleeping", queue items for morning delivery. In "relaxed", allow more items through with warmer tone hints. The tone hints are passed to the LLM enhancer as part of its prompt context. For notification decisions, this processor sets a `notify: boolean` flag on each item — the backend's push notification system reads this flag.

#### Temporal Empathy

Understanding that the same information feels different at different times.

- "You have a meeting at 9am tomorrow" feels neutral on Sunday evening. At 11pm when you're trying to sleep, it feels stressful. Save it for the morning briefing.
- Flight delay notification at 2am? Hold it until morning unless the flight is in the next 4 hours.
- Bad performance review feedback from email? Don't surface it right before a client meeting.
- Weekend morning? Don't lead with Monday's meeting load. Let them enjoy the morning first.

This goes beyond Tone & Timing rules — it's about understanding the emotional weight of information at specific moments.

**Implementation:** An extension of the Tone & Timing post-processor. Add an `emotionalWeight` assessment to each item: `low` (weather, routine info), `medium` (upcoming meetings, tasks), `high` (conflicts, delays, bad news, stressful items). The LLM harness assigns emotional weight during its enhancement run. The Tone & Timing processor then applies time-based suppression rules: high-weight items are held during sleep hours (22:00-07:00) and pre-meeting windows unless they're time-critical (e.g., flight in 4 hours). Held items are queued and released during the next appropriate window (morning briefing, post-meeting gap). Store the hold queue in memory, scoped per user.

#### Feed Curation

Sits between the graph and UI. Reranks and filters based on learned preferences and context.

- User always dismisses weather in the morning → deprioritize
- User taps calendar items before meetings → boost them 30 minutes prior
- Groups related items: "3 meetings in the next hour"
- Time-of-day patterns: work items in morning, personal in evening
- Deduplicates across sources

**Implementation:** This is the combined output of all rule-based `FeedPostProcessor` implementations. Not a separate agent — it's the aggregate effect of `TimeOfDayEnhancer`, `UserAffinityEnhancer`, `CalendarGroupingEnhancer`, and `DeduplicationEnhancer` running in sequence. The deduplication enhancer matches items across sources by comparing `(title, startTime ± 5min)` tuples — if two calendar sources produce the same event, keep the one with more data and suppress the other.

#### Notification Decisions

Decides what deserves a push notification vs. passive feed presence.

- High-priority items get pushed
- Learns what user actually responds to
- Batches low-priority items into digests
- Respects focus modes

Reduces notification fatigue while ensuring important items aren't missed.

**Implementation:** Part of the Tone & Timing processor. Each item gets a `notify` flag and a `notifyChannel` field (`push | digest | silent`). Rules: items with ranking hint > 0.8 get `push`. Items the user has historically tapped within 5 minutes of appearing get `push`. Everything else gets `digest` (batched into a periodic summary notification) or `silent` (feed-only). Track notification response rates per item type in the affinity model — if the user never opens push notifications for weather, stop pushing them. The client sends a `notification.opened` event via WebSocket so the backend can learn.

---

### It Does Things

#### Query & Conversation

The primary interface. This isn't a feed query tool — it's the person you talk to.

The user should be able to ask FREYA anything they'd ask a knowledgeable friend. Some questions are about their data. Most aren't.

**About their life (reads from the source graph):**

- "What's on my calendar tomorrow?"
- "When's my next flight?"
- "Do I have any conflicts this week?"
- "What should I prepare for this meeting?"
- "Tell me more about this" (anchored to a feed item)

**About the world (falls through to web search):**

- "How do I unclog a drain?"
- "What should I make with chicken and broccoli?"
- "What's the best way to get from King's Cross to Heathrow?"
- "What's the capital of Kazakhstan?"
- "How do I fix a leaking tap?"
- "What are some good date night restaurants in Shoreditch?"

**Contextual blend (graph + web):**

- "What's the dress code for The Ivy?" (calendar shows dinner there tonight)
- "Will I need an umbrella?" (location + weather, but could also web-search venue for indoor/outdoor)
- "What should I know before my meeting with Acme Corp?" (calendar + web search for company info)

The routing logic: try the source graph first. If the graph has relevant data, use it. If not, or if the answer needs enrichment, fall through to web search. The user shouldn't know or care which path was taken.

This is also where intent extraction happens for the Gentle Follow-up Agent. Every conversation flows through here, so when the user says "I'll send that to Sarah tomorrow," the system captures the commitment without the user doing anything explicit.

**Implementation:** A new JSON-RPC method on the WebSocket: `query.ask` with params `{ message: string, feedItemId?: string }`. The backend handler: (1) builds a prompt with the user's message, current `AgentContext` (serialized feed items + context), conversation history, and user preferences; (2) determines routing — if the message references feed data, include relevant items; if it's a general question, include a web search tool; (3) calls the LLM with tool use enabled (web search, calendar query, etc.); (4) streams the response back via a `query.response` notification. The `feedItemId` parameter anchors the conversation to a specific card ("tell me more about this"). Side-effects: after each user turn, run intent extraction for the Follow-up Agent. Store conversation history in a `conversations` table (user_id, role, content, timestamp), capped at last 50 turns.

#### Web Search

The backbone for general knowledge. Makes FREYA a person you can ask things, not just a dashboard you look at.

**Reactive (user asks):**

- Recipe ideas, how-to questions, factual lookups, recommendations
- Anything the source graph can't answer

**Proactive (agents trigger):**

- Contextual Preparation enriches calendar events: venue info, attendee backgrounds, parking
- Feed shows a concert → pre-fetches setlist, venue details
- Ambient Context checks for disruptions, closures, news

Returns summarized, conversational answers — not a list of links. The user is talking to a person, not using a search engine.

**Implementation:** Wrap a search API (Tavily is purpose-built for LLM consumption — returns clean text, not HTML. Brave Search API is cheaper. Google Custom Search is an option but returns raw snippets). Expose as a tool the LLM can call during query handling and during the slow-path enhancement run. The tool interface: `search(query: string): Promise<SearchResult[]>` where `SearchResult` has `title`, `url`, `content` (cleaned text). The LLM summarizes the results into a conversational answer. Cache search results by query (TTL: 1 hour for factual queries, 15 minutes for time-sensitive ones like traffic/news). For proactive use by other agents (Contextual Preparation, Ambient Context), expose the search tool via the `AgentContext` so any agent can call it.

#### Decision Support

When you're facing a choice, lays out the information so you can decide quickly — without deciding for you.

- "You have two events at the same time. The team standup is recurring and you've attended 90% of them. The client call is a one-off requested by the VP. Here's what you'd miss from each."
- "You could take the train (1h 20m, £45) or drive (1h 40m but door-to-door, parking is £15). Weather is clear so driving is fine."
- "Three restaurants match your evening — here's how they compare on distance, reviews, and price."

Not "skip the standup" — just structured information for a fast decision.

**Implementation:** Emergent from the harness. The LLM sees overlapping calendar events or multiple options and naturally lays out a comparison. The system prompt says: "When the user faces a choice, lay out the options with pros/cons. Don't decide for them." **Infrastructure needed:** web search tool for gathering options (travel routes, restaurant comparisons). The client needs a `decision` card type that renders structured comparisons.

#### Financial Awareness

Not full budgeting — just awareness of money-related things in your life.

- "Your subscription to X renews tomorrow — £12.99."
- "The hotel for your Edinburgh trip is refundable until Thursday."
- "You mentioned wanting to cancel that gym membership — the cancellation deadline is next week."

**Implementation:** Primarily driven by the Follow-up Agent's commitment store (user mentioned cancelling something) and email scanning (subscription confirmations, booking confirmations with cancellation deadlines). Extract financial events from email using the LLM: `{ type: "subscription_renewal" | "refund_deadline" | "payment_due", amount?, date, description }`. Store in a `financial_events` table. A rule-based post-processor checks for upcoming financial events within 48 hours and surfaces them. No separate financial source needed for v1 — this piggybacks on email scanning and conversation memory.

#### Micro-Moments

Fills tiny gaps in your day with contextual micro-briefings.

- Waiting for a meeting to start: "While you wait — Sarah replied to your email about the budget, and the weather is clearing up for your evening walk."
- In transit: "Your meeting is in 12 minutes. The one thing you should know: they're going to ask about the timeline."
- Just finished a meeting, 5 minutes until the next: "Quick update — your package was delivered while you were in that meeting."

These aren't full cards — they're contextual snippets that appear in the right 30-second window.

**Implementation:** Emergent from the harness. The LLM sees the current time, the next event, and recent changes since the last run. It naturally fills short gaps with relevant updates. The system prompt says: "When there's a short gap before the next event, surface a quick update on what changed." **Infrastructure needed:** the client needs a `micro-briefing` card type rendered more compactly than full cards.

#### Errand & Logistics

Handles practical logistics a human assistant would manage.

- "You need to pick up dry cleaning — the shop closes at 6pm and you have a meeting until 5:30. Go during your 1pm gap instead."
- "Your prescription is ready. The pharmacy is on your way home."
- "You have 3 errands on the east side — here's an optimal route between your 2pm and 4pm."
- "Your car MOT expires next week. Here are garages near your office with availability."

Combines tasks, calendar, location, and business hours. Groups nearby errands. Warns about deadlines.

**Implementation:** A `FeedSource` (`freya.errands`) that depends on a task source (Todoist, Apple Reminders — needs to be built), calendar sources, and location. On each refresh, it queries tasks tagged as errands or with locations, cross-references against calendar free slots and current location, and uses a simple greedy algorithm to suggest optimal windows. Business hours: either hardcode common defaults or use Google Places API for specific venues. For v1, skip route optimization — just identify "you have a gap near this errand's location." The LLM enhancer can phrase the suggestion naturally. Requires a task source to exist first.

#### Delegation

Handles tasks the user delegates via natural language.

- "Remind me about this tomorrow"
- "Schedule a meeting with John next week"
- "Add milk to my shopping list"
- "Find a time that works for both me and Sarah"

Requires write access to sources. Confirmation UX for anything destructive or costly.

**Implementation:** Extends the Query Agent. When the LLM determines the user wants to _do_ something (not just ask), it calls a delegation tool with structured output: `{ action: "create_reminder" | "schedule_meeting" | "add_task", params: {...} }`. The backend maps this to `executeAction()` on the relevant source. For "find a time that works for both me and Sarah," the agent queries both calendars (requires Sarah to be a known contact with calendar access — or the agent asks the user to share availability). All write actions go through a confirmation step: the backend sends a `delegation.confirm` notification with the proposed action, and the client shows a confirmation UI. The user approves or modifies before execution. Store delegation history for the Follow-up Agent.

#### Actions

Executes actions on feed items.

- "Snooze this for 1 hour"
- "RSVP yes"
- "Mark as done"
- "Send a quick reply saying I'll be late"

Uses `executeAction()` on the relevant source. Needs per-source OAuth write scopes.

**Implementation:** The `executeAction()` infrastructure already exists on `FeedSource`. The gap is OAuth write scopes — current sources only request read access. Each source that supports actions needs to declare required scopes, and the auth flow needs to request them. Add an `actions` field to the `FeedItem` type so the client knows what actions are available on each card (e.g., a calendar event card shows "RSVP" and "Snooze" buttons). The client sends `feed.action` via WebSocket with `{ itemId, actionId, params }`. The backend resolves the item's source and calls `executeAction()`. Snooze is special — it's not a source action but a feed-level operation that suppresses an item for a duration. Handle it in the post-processor layer.

---

### It Helps You Set Up

#### Source Configuration

Helps users tune sources through conversation.

- "Show me fewer emails"
- "Only show calendar events for work"
- "Prioritize tasks over calendar"
- "Add my Spotify account"

Translates natural language into source config changes. Explains what each source does. Helps troubleshoot.

**Implementation:** Part of the Query Agent's tool set. When the LLM detects a configuration intent ("show me fewer emails"), it calls a `configure_source` tool: `{ sourceId: string, action: "enable" | "disable" | "set_option", option?: string, value?: unknown }`. Source options are stored per-user in the database and passed to sources at registration time. Each source declares its configurable options via a new `describeOptions()` method on `FeedSource`. The LLM sees these descriptions and can explain them conversationally.

#### Onboarding

Guides new users through setup conversationally.

- "What apps do you use for calendar?"
- "Would you like to see weather in your feed?"
- "What's most important to you — tasks, calendar, or communications?"

Progressively enables sources. Explains privacy implications.

**Implementation:** A guided conversation flow in the Query Agent, triggered on first launch (no sources configured). The LLM walks through available sources, asks what the user cares about, and calls `configure_source` to enable them. Store onboarding completion state in the user record. Can be re-triggered via "help me set up" or "add a new source." Each source provides a `privacyDescription` field explaining what data it accesses.

#### Explanation

Explains why items appear in the feed.

- "Why am I seeing this?"
- "This calendar event starts in 15 minutes and you marked it as important"

Builds trust. Useful for debugging.

**Implementation:** Each `FeedEnhancement` already carries `rankingHints`. Extend it with `reasons: Record<string, string>` — a human-readable explanation per item ID for why it was ranked where it is. The fast path assembles reasons from each post-processor: "boosted because you have 10 minutes before this event", "suppressed because you dismissed weather 3 times today." The client can show this on long-press or a "why?" button. No LLM needed for v1 — template strings from each enhancer are sufficient.

---

### How It Feels

These aren't features — they're qualities that run through everything the assistant does. They're implemented as system prompt instructions and post-processor rules, not as separate components.

#### Personality & Voice

A human assistant has a consistent personality. FREYA needs one too.

The voice should be: warm but not bubbly, concise but not robotic, occasionally witty but never trying too hard. It says "I" not "we." It has opinions when asked ("I'd skip the design sync — you've been to the last 8 and nothing changes") but defers on big decisions.

The difference between "Rain expected at 3pm" and "Looks like rain around 3 — grab a jacket before your walk." Every piece of text is an opportunity to feel human. Weather cards shouldn't read like API responses. Calendar cards shouldn't read like calendar entries.

**Implementation:** Defined entirely in the LLM system prompt. Create a personality spec document that's included in every LLM call (both the enhancement harness and the query interface). The spec covers: tone (warm, direct), perspective (first person), humor level (light, situational), formality (casual but competent), and example rewrites for common card types. The personality should be consistent across all outputs — briefings, annotations, query responses, nudges. ~500 tokens in the system prompt. Test by generating the same card with and without the personality spec and comparing.

#### Silence as a Feature

A great assistant knows when to say nothing. If your day is simple — two meetings, nice weather, no disruptions — the feed should be nearly empty.

"Nothing to worry about today" is more valuable than padding the feed with low-value cards to make it look busy.

An empty feed should never feel broken. It should feel like the assistant looked at everything and decided you're good.

**Implementation:** A post-processor that counts the total items after all other processing. If the count is below a threshold (e.g., 3 items) and none are high-urgency, inject a single "all clear" card: "Your afternoon is clear, no disruptions on your commute, weather is holding." If the count is zero, always show this card — an empty feed feels like a bug. The LLM harness generates the "all clear" message contextually. The rule-based layer also applies a minimum quality threshold — items below a certain ranking score are suppressed entirely rather than shown at the bottom. Better to show 3 good cards than 3 good cards and 8 irrelevant ones.

#### Confidence & Uncertainty

The assistant should express when it's unsure.

- "I think your meeting with Sarah is about the Q3 budget, but I'm not certain."
- "This looks like it might be an outdoor venue — you might want to check."
- "Based on your usual pattern, you probably leave around 8:15, but I've only seen 2 weeks of data."

Confidently stating something wrong destroys trust faster than anything else. Hedging appropriately builds it.

**Implementation:** The LLM system prompt includes an instruction: "When you're inferring rather than reading from data, say so. Use phrases like 'I think', 'it looks like', 'based on your pattern'. Never state inferences as facts." For pattern-based suggestions, include the confidence score from `DiscoveredPattern` in the prompt context — if confidence is below 0.6, the LLM should hedge. For web search results, if the search returned ambiguous or conflicting information, the LLM should say so rather than picking one answer.

#### Learning from Corrections

When the user corrects the assistant, it should update permanently — not just for this conversation.

- "No, that meeting is actually about hiring" → updates the event annotation and future prep cards for similar events
- "I don't take the Northern line, I take the Victoria line" → updates commute pattern in memory
- "Sarah's birthday is in March, not April" → corrects the contact data
- "I actually like getting weather in the morning" → overrides the learned dismissal pattern

**Implementation:** After each query conversation, the LLM runs a correction extraction pass (similar to intent extraction for follow-ups): `{ isCorrection: boolean, correctedFact?: string, correctValue?: string, scope?: "permanent" | "this_time" }`. Permanent corrections are written to the memory store with confidence 1.0, overriding any learned pattern. The memory store supports an `overrides` namespace: `override.commute_line = "victoria"` takes precedence over any pattern-discovered commute. Corrections to contact data (birthdays, etc.) update the contacts source if write access is available, otherwise store as a memory override.

#### Decay & Forgetting

Memory should fade, not just accumulate. A human assistant doesn't remember every detail forever.

- Patterns that stop recurring should weaken. If the user stopped going to the gym on Tuesdays 2 months ago, stop suggesting it.
- Preferences that haven't been reinforced in months should decay toward neutral.
- Old conversation context should compress into summaries, not persist verbatim.
- Follow-up commitments older than 30 days should be archived, not actively surfaced.

**Implementation:** Add a `last_reinforced` timestamp and `decay_rate` to memory entries. A nightly background job reduces confidence scores: `confidence = confidence * (1 - decay_rate)`. Default decay rate: 0.01/day (halves in ~70 days). Entries below confidence 0.1 are archived (kept but excluded from the active preference set). Explicit user statements decay slower (rate 0.005). Pattern-discovered entries decay faster (rate 0.02). Corrections (confidence 1.0) don't decay — they're permanent until corrected again. Conversation history: keep last 50 turns verbatim, compress older turns into daily summaries via the daily summary job.

#### Graceful Degradation

The assistant should be useful from day one with a single source connected, and get better as more sources are added.

- Calendar only: "You have a busy morning — 3 meetings before noon."
- Calendar + weather: "Busy morning, and it's going to rain. Bring an umbrella."
- Calendar + weather + location: "Busy morning, rain expected, and your first meeting is 30 minutes away — leave by 8:15."
- Calendar + weather + location + tasks: "Busy morning, rain, leave by 8:15, and don't forget you need to send that proposal before your 10am."

Each source adds a layer. Nothing breaks when a source is missing — the assistant just knows less.

**Implementation:** The LLM harness naturally handles this — if weather data isn't in the context, it simply doesn't mention weather. No special code needed. The rule-based post-processors should also be defensive: `CalendarGroupingEnhancer` works with zero calendar items (produces no groups), `UserAffinityEnhancer` works with no interaction history (uses default weights). The "all clear" card should adapt its message to available sources: "Your calendar is clear" vs "Your calendar is clear, weather is nice, and no transit disruptions" depending on what's connected. The onboarding flow should explain what each source adds: "Connect weather to get umbrella reminders and outdoor activity suggestions."

#### Handoff

Sometimes the assistant can't handle something and should say so clearly.

- "I can't book this restaurant — they don't take online reservations. Here's their phone number, they're open until 9pm."
- "I can't access your work calendar — you'd need to connect it in settings."
- "I'm not sure about this medical question — you should ask your doctor. Your next appointment is in 2 weeks."
- "I can't send emails on your behalf yet — here's a draft you can copy."

**Implementation:** The LLM system prompt includes: "When you can't do something, say so directly and provide the next best action. Never pretend you can do something you can't. If a tool call fails, explain what went wrong and what the user can do instead." For capability boundaries, maintain a list of what each source supports (read-only vs read-write, what actions are available). The LLM sees this list and can accurately say "I can check your calendar but I can't create events yet." Failed tool calls (web search timeout, API error) should produce a graceful message, not a silent failure.

#### Celebration & Positive Reinforcement

A human assistant notices wins, not just problems.

- "You cleared your entire task list today — first time this month."
- "Your presentation went for exactly 30 minutes — right on time."
- "You've had lunch away from your desk every day this week."
- "You made it to the gym 3 times this week — that's a new streak."
- "Zero calendar conflicts this week. That never happens."

Small acknowledgments that make the user feel seen, not just managed.

**Implementation:** Emergent from the harness. The LLM sees the user's current state and memory (daily summaries, patterns) and notices wins. The system prompt says: "Occasionally notice positive things — task list cleared, streak maintained, conflict-free week. Keep it brief and genuine. Don't overdo it." **Infrastructure needed:** celebration cooldown in memory (one per day max) to prevent the LLM from celebrating on every run.

#### Seasonal & Cyclical Awareness

Understands recurring annual patterns and calendar-level events.

- "Clocks go back this weekend — your Monday meetings will feel an hour earlier."
- "It's the last week to use your annual leave — you have 5 days remaining."
- "January is historically your busiest month — this year looks similar."
- "Tax deadline is in 3 weeks. You mentioned needing to gather receipts."
- "It's your and Sarah's anniversary next month — you went to The Ivy last year."

**Implementation:** Two sources of seasonal awareness. General: a static dataset of annual events (clock changes, tax deadlines, bank holidays) per locale, checked daily by a rule-based post-processor. Personal: discovered by the weekly pattern discovery job when it has 6+ months of daily summaries — it can detect annual patterns ("January is always busy", "user takes holiday in August"). The LLM prompt includes the current date's seasonal context. Anniversary/birthday tracking comes from the contacts source and memory store. Tax and leave reminders come from conversation memory ("user mentioned annual leave balance") or could integrate with an HR source later.

---

## Build Order

### Phase 0: Graph Foundation

Expose the source graph to the enhancement layer. Without this, every behavior solves data access independently.

- Create `AgentContext` as a separate object that composes engine output with persistence stores
- `AgentContext` subscribes to the engine and maintains a ring buffer of recent results (last 10 refreshes)
- Add `FeedPostProcessor` interface and `registerPostProcessor()` on the engine
- Add `FeedEnhancement` type and merge logic in `refresh()`
- Remove `priority` from `FeedItem` — ranking is now entirely post-processing
- Add `signals` field to `FeedItem` for source-provided hints (optional urgency, time relevance)
- Create `packages/freya-feed-enhancers` for post-processor implementations
- Add `feed.interact` JSON-RPC method for tap/dismiss/dwell events from client
- Add `memories` table to database schema (user_id, key, value_json, confidence, updated_at, source)
- Add `feed_snapshots` table for routine learning (user_id, items_json, context_json, timestamp)
- Add `daily_summaries` table for compressed feed history (user_id, date, summary_json)

### Phase 1: It Works

The minimum for "this is an AI assistant."

1. **Personality spec** — write the voice/tone document included in all LLM calls. ~500 tokens. This shapes everything that follows.
2. **Rule-based post-processors** — `TimeOfDayEnhancer`, `CalendarGroupingEnhancer`, `DeduplicationEnhancer`, silence/"all clear" card logic in `freya-feed-enhancers`. Pure functions, no external dependencies.
3. **Query Agent** — `query.ask` JSON-RPC method, LLM with tool use, conversation history table. Start with a single model (GPT-4.1 mini or Gemini Flash for cost).
4. **Web Search** — Tavily or Brave Search API wrapper, exposed as an LLM tool. Cache layer with TTL.
5. **Daily Briefing** — `freya.briefing` FeedSource, depends on all content sources, runs in morning/evening time windows.
6. **Graceful degradation** — ensure all post-processors and the LLM harness work with any subset of sources connected.

### Phase 2: It Feels Human

The features that make people say "whoa."

7. **LLM Enhancement slow path** — background timer, serializes feed + context into prompt, returns `FeedEnhancement`, caches result. This enables card rewriting, cross-source synthesis, tone adjustment, and ambient personality. Include confidence/uncertainty instructions in the prompt.
8. **User Affinity model** — `UserAffinityEnhancer` post-processor + `feed.interact` event handling. Writes to `memories` table. No LLM.
9. **Contextual Preparation** — `freya.preparation` FeedSource, depends on calendar + web search tool. Includes anticipatory logistics and anticipating questions. Cache prep cards per event ID.
10. **Tone & Timing + Temporal Empathy** — post-processor that infers user state, adjusts suppression, sets `notify` flags, holds emotionally heavy items for appropriate windows.
11. **Context Switching Buffers** — rule-based detection of activity transitions, LLM-generated transition cards.

### Phase 3: It Knows You

The long-term relationship.

12. **Memory store + decay model** — `memories` table with confidence scores, `last_reinforced` timestamps, nightly decay job. Include in all LLM prompts.
13. **Learning from corrections** — correction extraction as Query Agent side-effect, writes to memory with confidence 1.0.
14. **Gentle Follow-up** — intent extraction as Query Agent side-effect, `commitments` table, `freya.followup` FeedSource.
15. **Routine Learning** — feed snapshot storage, daily summary compression, weekly LLM pattern discovery with dynamic `DiscoveredPattern[]` output.
16. **Social Awareness** — contacts source (CardDAV or Google People API), birthday detection, meeting frequency analysis.

### Phase 4: It's Ahead of You

Background intelligence.

17. **Push notification infrastructure** — Expo push notifications, driven by `notify` flag from Tone & Timing processor.
18. **Ambient Context sources** — extend TfL for planned disruptions, add `freya.packages` (tracking APIs), add `freya.news` (news API filtered by interests).
19. **Energy Awareness + Health Nudges** — rule-based detection (meeting density, sedentary time, late nights), LLM-phrased nudge cards with cooldowns.
20. **Anomaly Detection** — `freya.anomaly` FeedSource, meeting time histogram, overlap detection. Mostly rule-based.
21. **Cross-Source Reasoning** — handled by LLM enhancement layer with explicit cross-source instructions in prompt.
22. **Celebration** — positive pattern detection in LLM harness, comparison against daily summary baselines, one per day max.
23. **Seasonal Awareness** — static annual events dataset per locale + personal annual patterns from 6+ months of summaries.

### Phase 5: It Handles Things

The full PA experience.

24. **Task source** — new `freya.tasks` FeedSource (Todoist API or Apple Reminders). Required for Errand & Logistics.
25. **Decision Support** — conflict detection (rule-based) + comparison card generation (LLM). Structured comparison data for client rendering.
26. **Micro-Moments** — gap detection post-processor + LLM micro-briefing generation for 2-10 minute windows.
27. **Financial Awareness** — financial event extraction from email, `financial_events` table, 48-hour reminder post-processor.
28. **Errand & Logistics** — `freya.errands` FeedSource, depends on tasks + calendar + location. Greedy gap-matching algorithm.
29. **Actions** — extend OAuth scopes for write access, add `actions` field to `FeedItem`, `feed.action` JSON-RPC method, confirmation flow.
30. **Delegation** — extend Query Agent with write tools, `delegation.confirm` notification, confirmation UI on client.

### Deferred

- **Source Configuration** — part of Query Agent tool set, build when there are 5+ sources
- **Onboarding** — guided conversation flow, build when setup is complex
- **Explanation** — template strings from enhancers, add when users ask "why am I seeing this?"
- **Multi-device sync** — track seen items across devices, "I already showed you this on your phone"

---

## Open Questions

- Where does the LLM harness run? Server-side (simpler, but latency to user), edge (faster, but state management), or hybrid?
- Privacy model for feed snapshot storage and pattern discovery? How long to retain? User-deletable?
- User consent: opt-in for specific behaviors (email scanning, pattern learning), or blanket consent with opt-out?
- LLM model selection: one model for everything, or cheap model for enhancement + capable model for queries?
- How far back does "recent items" go in the AgentContext ring buffer?
- Write-back: through `executeAction()` or direct API access for delegation?
- How to handle LLM enhancement staleness? Hash-based cache invalidation, or time-based?
- Pattern discovery prompt engineering: how to prevent the LLM from hallucinating patterns that don't exist?
- Feed snapshot storage cost at scale: compress after N days, or summarize and discard?
- System prompt size: as behaviors accumulate, the prompt grows. When does it need to be split or dynamically composed?
- Personality consistency: how to ensure the voice stays consistent across enhancement runs and query responses?
- Health nudge liability: should FREYA ever comment on health-related patterns, or is that too risky?
- Celebration frequency: how often is encouraging vs. patronizing?
- Emotional weight classification: can the LLM reliably assess how stressful a piece of information is?
- Multi-device: how to sync seen-item state and hold queues across phone, laptop, watch?
- Decay tuning: how to calibrate decay rates so patterns fade at the right speed? User-configurable?
- Financial data sensitivity: what level of financial awareness is useful vs. invasive?
