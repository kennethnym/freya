import {
	AssistantMessagePayload,
	AttachmentPayload,
	ConversationEntryKind,
	ContextSummaryPayload,
	GenericObjectPayload,
	UserMessagePayload,
	type ConversationEntry,
} from "@freya/core"

import type { ConversationEntryRow } from "./storage.ts"

export function conversationEntryFromRow(row: ConversationEntryRow): ConversationEntry {
	const base = {
		id: row.id,
		conversationId: row.conversationId,
		sequence: row.sequence,
		visibility: row.visibility,
		metadata: row.metadata,
		createdAt: row.createdAt.toISOString(),
	}

	switch (row.kind) {
		case ConversationEntryKind.UserMessage:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: UserMessagePayload.assert(row.payload),
			}
		case ConversationEntryKind.AssistantMessage:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: AssistantMessagePayload.assert(row.payload),
			}
		case ConversationEntryKind.Attachment:
			return {
				...base,
				kind: row.kind,
				fileId: requireFileId(row),
				payload: AttachmentPayload.assert(row.payload),
			}
		case ConversationEntryKind.ToolCall:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: GenericObjectPayload.assert(row.payload),
			}
		case ConversationEntryKind.ToolResult:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: GenericObjectPayload.assert(row.payload),
			}
		case ConversationEntryKind.ContextSummary:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: ContextSummaryPayload.assert(row.payload),
			}
		case ConversationEntryKind.SystemNote:
			return {
				...base,
				kind: row.kind,
				fileId: nullFileId(row),
				payload: GenericObjectPayload.assert(row.payload),
			}
	}
}

function requireFileId(row: ConversationEntryRow): string {
	if (!row.fileId) {
		throw new Error(`Conversation attachment entry "${row.id}" is missing a file id`)
	}

	return row.fileId
}

function nullFileId(row: ConversationEntryRow): null {
	if (row.fileId !== null) {
		throw new Error(`Conversation entry "${row.id}" unexpectedly references a file`)
	}

	return null
}
