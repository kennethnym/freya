import { type } from "arktype"

export const ConversationEntryKind = {
	UserMessage: "user_message",
	AssistantMessage: "assistant_message",
	Attachment: "attachment",
	ToolCall: "tool_call",
	ToolResult: "tool_result",
	ContextSummary: "context_summary",
	SystemNote: "system_note",
} as const

export type ConversationEntryKind =
	(typeof ConversationEntryKind)[keyof typeof ConversationEntryKind]

export const ConversationEntryVisibility = {
	UserVisible: "user_visible",
	Internal: "internal",
} as const

export type ConversationEntryVisibility =
	(typeof ConversationEntryVisibility)[keyof typeof ConversationEntryVisibility]

export const AttachmentType = {
	Image: "image",
	Audio: "audio",
	Video: "video",
	Document: "document",
	Other: "other",
} as const

export type AttachmentType = (typeof AttachmentType)[keyof typeof AttachmentType]

export const ConversationEntryKindInput = type.enumerated(...Object.values(ConversationEntryKind))
export const ConversationEntryVisibilityInput = type.enumerated(
	...Object.values(ConversationEntryVisibility),
)
export const AttachmentTypeInput = type.enumerated(...Object.values(AttachmentType))

const TextMessagePart = type({
	"+": "reject",
	type: "'text'",
	text: "string",
})

const JsonMessagePart = type({
	"+": "reject",
	type: "'json'",
	value: "unknown",
})

export const MessagePart = type.or(TextMessagePart, JsonMessagePart)
export type MessagePart = typeof MessagePart.infer

export const UserMessagePayload = type({
	"+": "reject",
	role: "'user'",
	parts: MessagePart.array().atLeastLength(1),
})

export type UserMessagePayload = typeof UserMessagePayload.infer

export const AssistantMessagePayload = type({
	"+": "reject",
	role: "'assistant'",
	parts: MessagePart.array().atLeastLength(1),
})

export type AssistantMessagePayload = typeof AssistantMessagePayload.infer

export const AttachmentPayload = type({
	"+": "reject",
	role: type.enumerated("user", "assistant"),
	name: "string",
	mimeType: "string",
	attachmentType: AttachmentTypeInput,
	"caption?": "string",
})

export type AttachmentPayload = typeof AttachmentPayload.infer

const ContextSummary = type({
	"+": "reject",
	"userIntent?": "string",
	durableFacts: type.string.array(),
	preferences: type.string.array(),
	decisions: type.string.array(),
	openTasks: type.string.array(),
	importantDetails: type.string.array(),
})

export const ContextSummaryPayload = type({
	"+": "reject",
	covers: type({
		"+": "reject",
		startSequence: "number.integer >= 1",
		endSequence: "number.integer >= 1",
	}),
	summary: ContextSummary,
	promptVersion: "string",
	"sourceEntryIds?": type.string.array(),
})

export type ContextSummaryPayload = typeof ContextSummaryPayload.infer

export const ModelRunMetadata = type({
	"+": "reject",
	route: "string",
	provider: "string",
	model: "string",
	"contextSummaryEntryId?": "string",
	"rawEntriesStartSequence?": "number.integer >= 1",
	"rawEntriesEndSequence?": "number.integer >= 1",
	"inputTokens?": "number.integer >= 0",
	"outputTokens?": "number.integer >= 0",
	"providerRequestId?": "string",
})

export type ModelRunMetadata = typeof ModelRunMetadata.infer

export const ConversationEntryMetadata = type({
	"modelRun?": ModelRunMetadata,
	"[string]": "unknown",
})

export type ConversationEntryMetadata = typeof ConversationEntryMetadata.infer

export const GenericObjectPayload = type("Record<string, unknown>")
export type GenericObjectPayload = typeof GenericObjectPayload.infer

export type ConversationEntryPayload =
	| UserMessagePayload
	| AssistantMessagePayload
	| AttachmentPayload
	| ContextSummaryPayload
	| GenericObjectPayload
