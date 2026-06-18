import { type } from "arktype"

/** Entry kinds supported by the persisted conversation timeline. */
export const ConversationEntryKind = {
	UserMessage: "user_message",
	AssistantMessage: "assistant_message",
	Attachment: "attachment",
	ToolCall: "tool_call",
	ToolResult: "tool_result",
	ContextSummary: "context_summary",
	SystemNote: "system_note",
} as const

/** Discriminator for the payload shape and handling of a conversation entry. */
export type ConversationEntryKind =
	(typeof ConversationEntryKind)[keyof typeof ConversationEntryKind]

/** Visibility scopes supported by stored conversation entries. */
export const ConversationEntryVisibility = {
	UserVisible: "user_visible",
	Internal: "internal",
} as const

/** Indicates whether a conversation entry should be exposed to the user. */
export type ConversationEntryVisibility =
	(typeof ConversationEntryVisibility)[keyof typeof ConversationEntryVisibility]

/** Attachment media categories accepted by conversation entries. */
export const AttachmentType = {
	Image: "image",
	Audio: "audio",
	Video: "video",
	Document: "document",
	Other: "other",
} as const

/** File or media category associated with an attachment payload. */
export type AttachmentType = (typeof AttachmentType)[keyof typeof AttachmentType]

/** Plain text content part for a message. */
export const TextMessagePart = type({
	"+": "reject",
	type: "'text'",
	text: "string",
})

/** Structured JSON content part for a message. */
export const JsonMessagePart = type({
	"+": "reject",
	type: "'json'",
	value: "unknown",
})

/** Content part variants supported by user and assistant messages. */
export const MessagePart = type.or(TextMessagePart, JsonMessagePart)

/** A structured content part inside a user or assistant message payload. */
export type MessagePart = typeof MessagePart.infer

/** User-authored message entry payload. */
export const UserMessagePayload = type({
	"+": "reject",
	role: "'user'",
	parts: MessagePart.array().atLeastLength(1),
})

/** Payload stored for a conversation entry containing a user message. */
export type UserMessagePayload = typeof UserMessagePayload.infer

/** Assistant-authored message entry payload. */
export const AssistantMessagePayload = type({
	"+": "reject",
	role: "'assistant'",
	parts: MessagePart.array().atLeastLength(1),
})

/** Payload stored for a conversation entry containing an assistant message. */
export type AssistantMessagePayload = typeof AssistantMessagePayload.infer

/** Attachment entry payload. */
export const AttachmentPayload = type({
	"+": "reject",
	role: type.enumerated("user", "assistant"),
	name: "string",
	mimeType: "string",
	attachmentType: type.enumerated(...Object.values(AttachmentType)),
	"caption?": "string",
})

/** Payload stored for a conversation entry that references an uploaded file. */
export type AttachmentPayload = typeof AttachmentPayload.infer

/** Durable facts extracted from compacted conversation history. */
export const ContextSummary = type({
	"+": "reject",
	"userIntent?": "string",
	durableFacts: type.string.array(),
	preferences: type.string.array(),
	decisions: type.string.array(),
	openTasks: type.string.array(),
	importantDetails: type.string.array(),
})

/** Durable facts and follow-ups retained from compacted conversation history. */
export type ContextSummary = typeof ContextSummary.infer

/** Context-summary conversation entry payload. */
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

/** Payload describing a compaction summary and the sequence range it covers. */
export type ContextSummaryPayload = typeof ContextSummaryPayload.infer

/** Model invocation metadata recorded on generated entries. */
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

/** Metadata describing the model run that produced a conversation entry. */
export type ModelRunMetadata = typeof ModelRunMetadata.infer

/** Arbitrary metadata stored alongside conversation entries. */
export const ConversationEntryMetadata = type({
	"modelRun?": ModelRunMetadata,
	"[string]": "unknown",
})

/** Metadata bag attached to a conversation entry. */
export type ConversationEntryMetadata = typeof ConversationEntryMetadata.infer

/** Generic object payload used by operational entries. */
export const GenericObjectPayload = type("Record<string, unknown>")

/** Fallback payload shape for tool calls, tool results, and system notes. */
export type GenericObjectPayload = typeof GenericObjectPayload.infer

/** Union of payload shapes that can be stored on a conversation entry. */
export type ConversationEntryPayload =
	| UserMessagePayload
	| AssistantMessagePayload
	| AttachmentPayload
	| ContextSummaryPayload
	| GenericObjectPayload
