# @freya/source-caldav

A FeedSource that fetches calendar events from any CalDAV server.

## Usage

```ts
import { CalDavSource } from "@freya/source-caldav"

// Basic auth (Nextcloud, Radicale, Baikal, iCloud, etc.)
const source = new CalDavSource({
	serverUrl: "https://caldav.example.com",
	authMethod: "basic",
	username: "user",
	password: "pass",
	lookAheadDays: 7, // optional, default: 0 (today only)
	timeZone: "America/New_York", // optional, default: UTC
})

// OAuth
const source = new CalDavSource({
	serverUrl: "https://caldav.provider.com",
	authMethod: "oauth",
	accessToken: "...",
	refreshToken: "...",
	tokenUrl: "https://provider.com/oauth/token",
})
```

### iCloud

Use your Apple ID email as the username and an [app-specific password](https://support.apple.com/en-us/102654):

```ts
const source = new CalDavSource({
	serverUrl: "https://caldav.icloud.com",
	authMethod: "basic",
	username: "you@icloud.com",
	password: "<app-specific-password>",
})
```

## Testing

```bash
bun test
```

### Live test

`bun run test:live` connects to a real CalDAV server and prints all events to the console. It prompts for:

- **CalDAV server URL** — e.g. `https://caldav.icloud.com`
- **Username** — your account email
- **Password** — your password (or app-specific password for iCloud)
- **Look-ahead days** — how many days beyond today to fetch (default: 0)

The script runs both `fetchContext` and `fetchItems`, printing the calendar context (in-progress events, next event, today's count) followed by each event with its title, time, location, signals, and attendees.
