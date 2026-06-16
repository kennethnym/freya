import { describe, expect, test } from "bun:test"

import {
	AttachmentType,
	AttachmentPayload,
	ContextSummaryPayload,
	ConversationEntryMetadata,
	GenericObjectPayload,
	UserMessagePayload,
} from "./types.ts"

describe("conversation entry schemas", () => {
	test("parses valid user message payloads", () => {
		const payload = UserMessagePayload.assert({
			role: "user",
			parts: [{ type: "text", text: "hello" }],
		})

		expect(payload).toEqual({
			role: "user",
			parts: [{ type: "text", text: "hello" }],
		})
	})

	test("rejects user message payloads with the wrong role", () => {
		expect(() =>
			UserMessagePayload.assert({
				role: "assistant",
				parts: [{ type: "text", text: "hello" }],
			}),
		).toThrow()
	})

	test("rejects user message payloads with no parts", () => {
		expect(() =>
			UserMessagePayload.assert({
				role: "user",
				parts: [],
			}),
		).toThrow()
	})

	test("parses valid attachment payloads", () => {
		const payload = AttachmentPayload.assert({
			role: "user",
			name: "whiteboard.png",
			mimeType: "image/png",
			attachmentType: AttachmentType.Image,
			caption: "whiteboard sketch",
		})

		expect(payload).toEqual({
			role: "user",
			name: "whiteboard.png",
			mimeType: "image/png",
			attachmentType: AttachmentType.Image,
			caption: "whiteboard sketch",
		})
	})

	test("rejects extra fields on structured payloads", () => {
		expect(() =>
			AttachmentPayload.assert({
				role: "user",
				name: "whiteboard.png",
				mimeType: "image/png",
				attachmentType: AttachmentType.Image,
				fileId: "file-1",
			}),
		).toThrow()
	})

	test("parses context summary payloads", () => {
		const payload = ContextSummaryPayload.assert({
			covers: {
				startSequence: 1,
				endSequence: 12,
			},
			summary: {
				userIntent: "Design message storage.",
				durableFacts: [],
				preferences: ["Keep the schema simple."],
				decisions: ["Use conversation_entries as the timeline."],
				openTasks: [],
				importantDetails: [],
			},
			promptVersion: "conversation-summary-v1",
			sourceEntryIds: ["entry-1", "entry-2"],
		})

		expect(payload).toMatchObject({
			covers: {
				startSequence: 1,
				endSequence: 12,
			},
			promptVersion: "conversation-summary-v1",
		})
	})

	test("allows generic object payloads for tool entries", () => {
		const payload = GenericObjectPayload.assert({
			toolCallId: "call-1",
			toolName: "calendar.search",
			input: { date: "2026-06-15" },
		})

		expect(payload).toEqual({
			toolCallId: "call-1",
			toolName: "calendar.search",
			input: { date: "2026-06-15" },
		})
	})

	test("rejects non-object generic payloads", () => {
		expect(() => GenericObjectPayload.assert("done")).toThrow()
	})

	test("parses model run metadata and allows extra top-level metadata", () => {
		const metadata = ConversationEntryMetadata.assert({
			modelRun: {
				route: "default-chat",
				provider: "pi",
				model: "pi-model",
				inputTokens: 120,
				outputTokens: 24,
			},
			traceId: "trace-1",
		})

		expect(metadata.modelRun?.model).toBe("pi-model")
		expect(metadata.traceId).toBe("trace-1")
	})

	test("rejects invalid model run metadata", () => {
		expect(() =>
			ConversationEntryMetadata.assert({
				modelRun: {
					route: "default-chat",
					provider: "pi",
					model: "pi-model",
					inputTokens: -1,
				},
			}),
		).toThrow()
	})
})
