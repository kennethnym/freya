import { describe, expect, test } from "bun:test"

import {
	AttachmentType,
	AttachmentPayload,
	ContextSummaryPayload,
	Conversation,
	ConversationEntry,
	ConversationEntryKind,
	ConversationEntryMetadata,
	ConversationEntryVisibility,
	GenericObjectPayload,
	UserMessagePayload,
} from "./conversation"

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

	test("parses conversation summaries", () => {
		const conversation = Conversation.assert({
			id: "11111111-1111-4111-8111-111111111111",
			createdAt: "2026-06-17T09:30:00.000Z",
			updatedAt: "2026-06-17T09:35:00.000Z",
		})

		expect(conversation.id).toBe("11111111-1111-4111-8111-111111111111")
	})

	test("parses kind-specific conversation entries", () => {
		const userMessageEntry = ConversationEntry.assert({
			id: "22222222-2222-4222-8222-222222222222",
			conversationId: "11111111-1111-4111-8111-111111111111",
			sequence: 1,
			kind: ConversationEntryKind.UserMessage,
			visibility: ConversationEntryVisibility.UserVisible,
			fileId: null,
			payload: {
				role: "user",
				parts: [{ type: "text", text: "hello" }],
			},
			metadata: {},
			createdAt: "2026-06-17T09:30:00.000Z",
		})
		const attachmentEntry = ConversationEntry.assert({
			id: "33333333-3333-4333-8333-333333333333",
			conversationId: "11111111-1111-4111-8111-111111111111",
			sequence: 2,
			kind: ConversationEntryKind.Attachment,
			visibility: ConversationEntryVisibility.UserVisible,
			fileId: "44444444-4444-4444-8444-444444444444",
			payload: {
				role: "user",
				name: "photo.png",
				mimeType: "image/png",
				attachmentType: AttachmentType.Image,
			},
			metadata: {},
			createdAt: "2026-06-17T09:31:00.000Z",
		})

		expect(userMessageEntry.kind).toBe(ConversationEntryKind.UserMessage)
		expect(attachmentEntry.kind).toBe(ConversationEntryKind.Attachment)
	})

	test("rejects conversation entries whose payload does not match the kind", () => {
		expect(() =>
			ConversationEntry.assert({
				id: "22222222-2222-4222-8222-222222222222",
				conversationId: "11111111-1111-4111-8111-111111111111",
				sequence: 1,
				kind: ConversationEntryKind.UserMessage,
				visibility: ConversationEntryVisibility.UserVisible,
				fileId: null,
				payload: {
					role: "assistant",
					parts: [{ type: "text", text: "hello" }],
				},
				metadata: {},
				createdAt: "2026-06-17T09:30:00.000Z",
			}),
		).toThrow()
	})

	test("rejects serialized conversations with extra fields", () => {
		expect(() =>
			Conversation.assert({
				id: "11111111-1111-4111-8111-111111111111",
				createdAt: "2026-06-17T09:30:00.000Z",
				updatedAt: "2026-06-17T09:35:00.000Z",
				title: "not yet part of the schema",
			}),
		).toThrow()
	})

	test("rejects file ids on non-attachment entries", () => {
		expect(() =>
			ConversationEntry.assert({
				id: "22222222-2222-4222-8222-222222222222",
				conversationId: "11111111-1111-4111-8111-111111111111",
				sequence: 1,
				kind: ConversationEntryKind.UserMessage,
				visibility: ConversationEntryVisibility.UserVisible,
				fileId: "44444444-4444-4444-8444-444444444444",
				payload: {
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
				metadata: {},
				createdAt: "2026-06-17T09:30:00.000Z",
			}),
		).toThrow()
	})
})
