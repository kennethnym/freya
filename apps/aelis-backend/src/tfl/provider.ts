import { TflSource, type ITflApi, type TflLineId } from "@aelis/source-tfl"
import { type } from "arktype"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

export type TflSourceProviderOptions =
	| { apiKey: string; client?: never }
	| { apiKey?: never; client: ITflApi }

export const tflConfig = type({
	"+": "reject",
	"lines?": "string[]",
})

export class TflSourceProvider implements FeedSourceProvider {
	readonly sourceId = "aelis.tfl"
	readonly configSchema = tflConfig
	private readonly apiKey: string | undefined
	private readonly client: ITflApi | undefined

	constructor(options: TflSourceProviderOptions) {
		this.apiKey = "apiKey" in options ? options.apiKey : undefined
		this.client = "client" in options ? options.client : undefined
	}

	async feedSourceForUser(_userId: string, config: unknown): Promise<TflSource> {
		const parsed = tflConfig(config)
		if (parsed instanceof type.errors) {
			throw new Error(`Invalid TFL config: ${parsed.summary}`)
		}

		return new TflSource({
			apiKey: this.apiKey,
			client: this.client,
			lines: parsed.lines as TflLineId[] | undefined,
		})
	}
}
