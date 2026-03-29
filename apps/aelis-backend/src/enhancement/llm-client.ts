import { OpenRouter } from "@openrouter/sdk"

import type { EnhancementResult } from "./schema.ts"

import { enhancementResultJsonSchema, parseEnhancementResult } from "./schema.ts"

const DEFAULT_MODEL = "z-ai/glm-4.7-flash"
const DEFAULT_TIMEOUT_MS = 30_000

export interface LlmClientConfig {
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

/**
 * Creates a reusable LLM client backed by OpenRouter.
 * The OpenRouter SDK instance is created once and reused across calls.
 */
export function createLlmClient(config: LlmClientConfig): LlmClient {
	const client = new OpenRouter({
		apiKey: config.apiKey,
		timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	})
	const model = config.model ?? DEFAULT_MODEL

	return {
		async enhance(request) {
			const response = await client.chat.send({
				chatGenerationParams: {
					model,
					messages: [
						{ role: "system" as const, content: request.systemPrompt },
						{ role: "user" as const, content: request.userMessage },
					],
					responseFormat: {
						type: "json_schema" as const,
						jsonSchema: {
							name: "enhancement_result",
							strict: false,
							schema: enhancementResultJsonSchema,
						},
					},
					reasoning: { effort: "none" },
					stream: false,
				},
			})

			const message = response.choices?.[0]?.message
			const content = message?.content ?? message?.reasoning
			if (typeof content !== "string") {
				console.warn("[enhancement] LLM returned no content in response")
				return null
			}

			const result = parseEnhancementResult(content)
			if (!result) {
				console.warn("[enhancement] Failed to parse LLM response:", content)
			}

			return result
		},
	}
}
