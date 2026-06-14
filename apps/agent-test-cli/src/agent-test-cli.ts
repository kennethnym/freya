type JsonObject = Record<string, unknown>

interface AuthUser {
	id: string
	name: string
	email: string
	image: string | null
}

interface AuthSession {
	user: AuthUser
	session: {
		id: string
		token: string
	}
}

interface QueryResponse {
	message: string
}

interface QueryToolDefinition {
	name: string
	label: string
	description: string
	parameters: unknown
}

interface QueryToolsResponse {
	tools: QueryToolDefinition[]
}

interface ResultResponse {
	result: unknown
}

interface SourceActionsResponse {
	actions: Record<string, { id: string; description?: string }>
}

interface RequestOptions {
	method?: "GET" | "POST"
	body?: unknown
}

class CookieJar {
	private readonly cookies = new Map<string, string>()

	apply(response: Response): void {
		for (const header of readSetCookieHeaders(response.headers)) {
			const cookie = parseCookie(header)
			if (!cookie) continue
			this.cookies.set(cookie.name, cookie.value)
		}
	}

	header(): string | undefined {
		if (this.cookies.size === 0) return undefined
		return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
	}
}

async function main(): Promise<void> {
	if (wantsHelp()) {
		printUsage()
		return
	}

	printIntro()

	const backendUrl = askRequired(
		"Backend URL",
		Bun.env.FREYA_BACKEND_URL ?? "http://localhost:3000",
		normalizeBackendUrl,
	)
	const email = askRequired("Email", Bun.env.FREYA_EMAIL)
	const password = askRequired("Password", Bun.env.FREYA_PASSWORD, undefined, true)

	const cookies = new CookieJar()

	try {
		const session = await signIn(backendUrl, cookies, email, password)
		console.log(`\nSigned in as ${session.user.email}`)
		await runChatLoop(backendUrl, cookies, session)
	} catch (err) {
		console.error(`\n${formatError(err)}`)
	}
}

async function signIn(
	backendUrl: string,
	cookies: CookieJar,
	email: string,
	password: string,
): Promise<AuthSession> {
	await requestJson(backendUrl, cookies, "/api/auth/sign-in/email", {
		method: "POST",
		body: { email, password },
	})

	const data = await requestJson(backendUrl, cookies, "/api/auth/get-session")
	if (!isAuthSession(data)) {
		throw new Error("Sign-in succeeded, but no session was returned")
	}

	return data
}

async function runChatLoop(
	backendUrl: string,
	cookies: CookieJar,
	session: AuthSession,
): Promise<void> {
	printHelp()

	for (;;) {
		const input = askOptional("you> ")?.trim()
		if (!input) continue

		if (input === "/quit" || input === "/exit") {
			console.log("Bye.")
			return
		}

		if (input === "/help") {
			printHelp()
			continue
		}

		if (input === "/session") {
			console.log(`${session.user.name || session.user.email} (${session.user.id})`)
			continue
		}

		if (input === "/tools") {
			await runCliCommand(() => listQueryTools(backendUrl, cookies))
			continue
		}

		if (input.startsWith("/tool ")) {
			await runCliCommand(() => executeQueryTool(backendUrl, cookies, input.slice("/tool ".length)))
			continue
		}

		if (input.startsWith("/actions ")) {
			await runCliCommand(() =>
				listSourceActions(backendUrl, cookies, input.slice("/actions ".length)),
			)
			continue
		}

		if (input.startsWith("/action ")) {
			await runCliCommand(() =>
				executeSourceAction(backendUrl, cookies, input.slice("/action ".length)),
			)
			continue
		}

		try {
			await askAgent(backendUrl, cookies, input)
		} catch (err) {
			console.error(`\n${formatError(err)}\n`)
		}
	}
}

async function askAgent(backendUrl: string, cookies: CookieJar, message: string): Promise<void> {
	const data = await requestJson(backendUrl, cookies, "/api/agent", {
		method: "POST",
		body: { message },
	})

	if (!isQueryResponse(data)) {
		throw new Error("Query returned an unexpected response shape")
	}

	console.log(`\nagent> ${data.message || "(no message)"}`)
	console.log("")
}

async function runCliCommand(command: () => Promise<void>): Promise<void> {
	try {
		await command()
	} catch (err) {
		console.error(`\n${formatError(err)}\n`)
	}
}

async function listQueryTools(backendUrl: string, cookies: CookieJar): Promise<void> {
	const data = await requestJson(backendUrl, cookies, "/api/agent/tools")
	if (!isQueryToolsResponse(data)) {
		throw new Error("Agent tools returned an unexpected response shape")
	}

	console.log("")
	for (const tool of data.tools) {
		console.log(`${tool.name} - ${tool.label}`)
		console.log(`  ${tool.description}`)
		console.log(`  params=${formatJson(tool.parameters)}`)
	}
	console.log("")
}

async function executeQueryTool(
	backendUrl: string,
	cookies: CookieJar,
	command: string,
): Promise<void> {
	const parsed = splitFirst(command.trim())
	if (!parsed) {
		throw new Error("Usage: /tool <name> <json-params>; example: /tool freya_list_context {}")
	}

	const params = parseJsonArgument(parsed.rest, {})
	const data = await requestJson(backendUrl, cookies, `/api/agent/tools/${urlPart(parsed.head)}`, {
		method: "POST",
		body: params,
	})
	if (!isResultResponse(data)) {
		throw new Error("Tool execution returned an unexpected response shape")
	}

	console.log(`\ntool ${parsed.head}>`)
	console.log(formatJson(data.result))
	console.log("")
}

async function listSourceActions(
	backendUrl: string,
	cookies: CookieJar,
	command: string,
): Promise<void> {
	const sourceId = command.trim()
	if (!sourceId) {
		throw new Error("Usage: /actions <source-id>")
	}

	const data = await requestJson(backendUrl, cookies, `/api/sources/${urlPart(sourceId)}/actions`)
	if (!isSourceActionsResponse(data)) {
		throw new Error("Source actions returned an unexpected response shape")
	}

	const actions = Object.entries(data.actions)
	console.log("")
	if (actions.length === 0) {
		console.log(`No actions for ${sourceId}.`)
	} else {
		for (const [key, action] of actions) {
			console.log(`${sourceId}/${key}`)
			console.log(`  id=${action.id}`)
			if (action.description) console.log(`  ${action.description}`)
		}
	}
	console.log("")
}

async function executeSourceAction(
	backendUrl: string,
	cookies: CookieJar,
	command: string,
): Promise<void> {
	const source = splitFirst(command.trim())
	if (!source) {
		throw new Error(
			'Usage: /action <source-id> <action-id> <json-params>; example: /action freya.location update-location {"lat":51.5,"lng":-0.1}',
		)
	}

	const action = splitFirst(source.rest)
	if (!action) {
		throw new Error(
			'Usage: /action <source-id> <action-id> <json-params>; example: /action freya.location update-location {"lat":51.5,"lng":-0.1}',
		)
	}

	const params = parseJsonArgument(action.rest, {})
	const data = await requestJson(
		backendUrl,
		cookies,
		`/api/sources/${urlPart(source.head)}/actions/${urlPart(action.head)}`,
		{
			method: "POST",
			body: params,
		},
	)
	if (!isResultResponse(data)) {
		throw new Error("Source action returned an unexpected response shape")
	}

	console.log(`\naction ${source.head}/${action.head}>`)
	console.log(formatJson(data.result))
	console.log("")
}

async function requestJson(
	backendUrl: string,
	cookies: CookieJar,
	path: string,
	options: RequestOptions = {},
): Promise<unknown> {
	const headers = new Headers()
	headers.set("Accept", "application/json")

	const cookieHeader = cookies.header()
	if (cookieHeader) headers.set("Cookie", cookieHeader)

	let body: string | undefined
	if (options.body !== undefined) {
		headers.set("Content-Type", "application/json")
		body = JSON.stringify(options.body)
	}

	const response = await fetch(`${backendUrl}${path}`, {
		method: options.method ?? "GET",
		headers,
		body,
	})

	cookies.apply(response)

	if (!response.ok) {
		throw new Error(await readResponseError(response, path))
	}

	return response.json()
}

function printIntro(): void {
	console.log("FREYA agent test CLI")
	console.log("Connect to a backend, sign in, then send test messages to /api/agent.\n")
}

function printUsage(): void {
	console.log("FREYA agent test CLI")
	console.log("")
	console.log("Usage:")
	console.log("  bun run agent-test-cli")
	console.log(
		"  FREYA_BACKEND_URL=http://localhost:3000 FREYA_EMAIL=user@example.com FREYA_PASSWORD=secret bun run agent-test-cli",
	)
	console.log("")
	printHelp()
}

function printHelp(): void {
	console.log("\nCommands:")
	console.log("  /tools       List agent debug tools")
	console.log("  /tool        Execute an agent debug tool with JSON params")
	console.log("  /actions     List source actions: /actions <source-id>")
	console.log("  /action      Execute source action: /action <source-id> <action-id> <json-params>")
	console.log("  /session     Show the signed-in user")
	console.log("  /help        Show commands")
	console.log("  /quit        Exit\n")
}

function askRequired(
	label: string,
	defaultValue?: string,
	transform?: (value: string) => string,
	hidden = false,
): string {
	if (hidden && defaultValue) {
		const value = defaultValue.trim()
		if (value) return transform ? transform(value) : value
	}

	const canRetry = canRunStty()

	for (;;) {
		const answer = hidden
			? askHidden(label, defaultValue)
			: askOptional(formatPromptLabel(label, defaultValue))
		const value = (answer || defaultValue || "").trim()
		if (!value) {
			if (!canRetry) {
				throw new Error(`${label} is required`)
			}
			console.log(`${label} is required.`)
			continue
		}
		return transform ? transform(value) : value
	}
}

function askOptional(label: string): string | null {
	return prompt(label)
}

function askHidden(label: string, defaultValue?: string): string | null {
	const shouldHide = !defaultValue && canRunStty()
	if (!shouldHide) return askOptional(formatPromptLabel(label, defaultValue))

	try {
		Bun.spawnSync(["stty", "-echo"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
		return askOptional(`${label}: `)
	} finally {
		Bun.spawnSync(["stty", "echo"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
		console.log("")
	}
}

function wantsHelp(): boolean {
	return Bun.argv.some((arg) => arg === "--help" || arg === "-h")
}

function normalizeBackendUrl(value: string): string {
	const withProtocol = /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`

	try {
		const url = new URL(withProtocol)
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("Backend URL must use http or https")
		}
		return url.toString().replace(/\/+$/, "")
	} catch {
		throw new Error(`Invalid backend URL: ${value}`)
	}
}

function formatPromptLabel(label: string, defaultValue?: string): string {
	return defaultValue ? `${label} (${defaultValue}): ` : `${label}: `
}

function splitFirst(value: string): { head: string; rest: string } | null {
	const trimmed = value.trim()
	if (!trimmed) return null

	const match = /\s/.exec(trimmed)
	if (!match) {
		return { head: trimmed, rest: "" }
	}

	const head = trimmed.slice(0, match.index)
	const rest = trimmed.slice(match.index).trim()
	return { head, rest }
}

function parseJsonArgument(value: string, fallback: unknown): unknown {
	if (!value.trim()) return fallback

	try {
		return JSON.parse(value)
	} catch (err) {
		throw new Error(`Invalid JSON params: ${formatError(err)}`)
	}
}

function formatJson(value: unknown): string {
	const serialized = JSON.stringify(value, null, 2)
	return serialized ?? "undefined"
}

function urlPart(value: string): string {
	return encodeURIComponent(value)
}

function canRunStty(): boolean {
	const result = Bun.spawnSync(["stty", "-g"], { stdin: "inherit", stdout: "pipe", stderr: "pipe" })
	return result.exitCode === 0
}

function readSetCookieHeaders(headers: Headers): string[] {
	const setCookies = headers.getSetCookie()
	if (setCookies && setCookies.length > 0) return setCookies

	const header = headers.get("set-cookie")
	if (!header) return []

	return splitSetCookieHeader(header)
}

function parseCookie(header: string): { name: string; value: string } | null {
	const [cookiePair] = header.split(";")
	if (!cookiePair) return null

	const index = cookiePair.indexOf("=")
	if (index <= 0) return null

	return {
		name: cookiePair.slice(0, index).trim(),
		value: cookiePair.slice(index + 1).trim(),
	}
}

function splitSetCookieHeader(header: string): string[] {
	const parts: string[] = []
	let start = 0
	let inExpires = false

	for (let index = 0; index < header.length; index += 1) {
		const char = header[index]
		const remainder = header.slice(index).toLowerCase()

		if (remainder.startsWith("expires=")) {
			inExpires = true
			continue
		}

		if (inExpires && char === ";") {
			inExpires = false
			continue
		}

		if (char === "," && !inExpires) {
			parts.push(header.slice(start, index).trim())
			start = index + 1
		}
	}

	parts.push(header.slice(start).trim())
	return parts.filter(Boolean)
}

async function readResponseError(response: Response, path: string): Promise<string> {
	const text = await response.text()
	if (response.status === 404 && path === "/api/agent") {
		return "Backend does not expose /api/agent. Restart the WIP backend on port 3000 or check FREYA_BACKEND_URL."
	}
	if (!text) return `Request failed: ${response.status} ${response.statusText}`

	try {
		const data: unknown = JSON.parse(text)
		if (isJsonObject(data)) {
			const message = readString(data, "message") ?? readString(data, "error")
			if (message) return message
		}
	} catch {
		return `Request failed: ${response.status} ${response.statusText}: ${text}`
	}

	return `Request failed: ${response.status} ${response.statusText}: ${text}`
}

function isAuthSession(value: unknown): value is AuthSession {
	if (!isJsonObject(value)) return false
	const user = value.user
	const session = value.session

	return (
		isJsonObject(user) &&
		isJsonObject(session) &&
		typeof user.id === "string" &&
		typeof user.name === "string" &&
		typeof user.email === "string" &&
		(user.image === null || typeof user.image === "string") &&
		typeof session.id === "string" &&
		typeof session.token === "string"
	)
}

function isQueryResponse(value: unknown): value is QueryResponse {
	if (!isJsonObject(value)) return false
	return typeof value.message === "string"
}

function isQueryToolsResponse(value: unknown): value is QueryToolsResponse {
	if (!isJsonObject(value) || !Array.isArray(value.tools)) return false
	return value.tools.every(isQueryToolDefinition)
}

function isQueryToolDefinition(value: unknown): value is QueryToolDefinition {
	return (
		isJsonObject(value) &&
		typeof value.name === "string" &&
		typeof value.label === "string" &&
		typeof value.description === "string" &&
		"parameters" in value
	)
}

function isResultResponse(value: unknown): value is ResultResponse {
	return isJsonObject(value) && "result" in value
}

function isSourceActionsResponse(value: unknown): value is SourceActionsResponse {
	if (!isJsonObject(value) || !isJsonObject(value.actions)) return false
	return Object.values(value.actions).every(isSourceActionDefinition)
}

function isSourceActionDefinition(value: unknown): value is { id: string; description?: string } {
	return (
		isJsonObject(value) &&
		typeof value.id === "string" &&
		(value.description === undefined || typeof value.description === "string")
	)
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(object: JsonObject, key: string): string | undefined {
	const value = object[key]
	return typeof value === "string" ? value : undefined
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

await main()
