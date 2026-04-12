import { type } from "arktype"

import type { EnhancementResult } from "./schema.ts"

import { enhancementResultJsonSchema, parseEnhancementResult } from "./schema.ts"

const DEFAULT_MODEL = "@cf/zai-org/glm-4.7-flash"
const DEFAULT_TIMEOUT_MS = 30_000

export interface LlmClientConfig {
	accountId: string
	apiKey: string
	model?: string
	timeoutMs?: number
}

export interface LlmClientRequest {
	systemPrompt: string
	userMessage: string
}

export interface LlmClient {
	enhance(request: LlmClientRequest): Promise<EnhancementResult | null>
}

const CloudflareApiResponse = type({
	result: {
		choices: type({
			message: {
				content: "string",
				"role?": "string",
			},
		}).array(),
	},
	success: "boolean",
	"errors?": type({ message: "string" }).array(),
})

/**
 * Creates a reusable LLM client backed by Cloudflare Workers AI.
 * Uses the REST API with structured JSON output.
 */
export function createLlmClient(config: LlmClientConfig): LlmClient {
	const model = config.model ?? DEFAULT_MODEL
	const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${model}`

	return {
		async enhance(request) {
			try {
				const res = await fetch(baseUrl, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${config.apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						messages: [
							{ role: "system", content: request.systemPrompt },
							{ role: "user", content: request.userMessage },
						],
						response_format: {
							type: "json_schema",
							json_schema: {
								name: "enhancement_result",
								strict: false,
								schema: enhancementResultJsonSchema,
							},
						},
						stream: false,
					}),
					// @ts-expect-error — bun-types AbortSignal conflicts with ESNext lib in tsc; works at runtime and in VSCode
					signal: AbortSignal.timeout(timeoutMs),
				})

				if (!res.ok) {
					const body = await res.text()
					console.warn(`[enhancement] Cloudflare API error ${res.status}: ${body}`)
					return null
				}

				const json: unknown = await res.json()
				const parsed = CloudflareApiResponse(json)
				if (parsed instanceof type.errors) {
					console.warn("[enhancement] Unexpected API response shape:", parsed.summary)
					return null
				}

				if (!parsed.success) {
					console.warn("[enhancement] Cloudflare API errors:", parsed.errors)
					return null
				}

				const content = parsed.result.choices[0]?.message.content
				if (content === undefined) {
					console.warn("[enhancement] LLM returned no choices in response")
					return null
				}

				const result = parseEnhancementResult(content)
				if (!result) {
					console.warn("[enhancement] Failed to parse LLM response:", content)
				}

				return result
			} catch (error) {
				if (error instanceof DOMException && error.name === "TimeoutError") {
					console.warn("[enhancement] LLM request timed out")
				} else {
					console.warn("[enhancement] LLM request failed:", error)
				}
				return null
			}
		},
	}
}
