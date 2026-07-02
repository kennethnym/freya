import {
	ConversationEntryKind,
	ConversationEntryPayload,
	ConversationEntryVisibility,
} from "@freya/core"
import { type } from "arktype"

export const Conversation = type({
	id: "string.uuid",
	createdAt: "string.date.iso",
	updatedAt: "string.date.iso",
})

export const ConversationEntry = type({
	id: "string.uuid",
	sequence: "number",
	kind: type.enumerated(...Object.values(ConversationEntryKind)),
	visibility: type.enumerated(...Object.values(ConversationEntryVisibility)),
	fileId: "string | null",
	payload: ConversationEntryPayload,
})
