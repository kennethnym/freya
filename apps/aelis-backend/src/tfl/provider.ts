import { TflSource, type ITflApi, type TflLineId } from "@aelis/source-tfl"
import { type } from "arktype"

import type { Database } from "../db/index.ts"
import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

import { SourceDisabledError } from "../sources/errors.ts"
import { sources } from "../sources/user-sources.ts"

export type TflSourceProviderOptions =
	| { db: Database; apiKey: string; client?: never }
	| { db: Database; apiKey?: never; client: ITflApi }

const tflConfig = type({
	"lines?": "string[]",
})

export class TflSourceProvider implements FeedSourceProvider {
	private readonly db: Database
	private readonly apiKey: string | undefined
	private readonly client: ITflApi | undefined

	constructor(options: TflSourceProviderOptions) {
		this.db = options.db
		this.apiKey = "apiKey" in options ? options.apiKey : undefined
		this.client = "client" in options ? options.client : undefined
	}

	async feedSourceForUser(userId: string): Promise<TflSource> {
		const row = await sources(this.db, userId).find("aelis.tfl")

		if (!row || !row.enabled) {
			throw new SourceDisabledError("aelis.tfl", userId)
		}

		const parsed = tflConfig(row.config ?? {})
		if (parsed instanceof type.errors) {
			throw new Error(`Invalid TFL config for user ${userId}: ${parsed.summary}`)
		}

		return new TflSource({
			apiKey: this.apiKey,
			client: this.client,
			lines: parsed.lines as TflLineId[] | undefined,
		})
	}
}
