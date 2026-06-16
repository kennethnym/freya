import { SessionManager } from "@earendil-works/pi-coding-agent"
import { tmpdir } from "node:os"

import type { ConversationStorageEntry } from "./conversation-recording-query-agent.ts"

import {
	AssistantMessagePayload,
	ContextSummaryPayload,
	ConversationEntryKind,
	UserMessagePayload,
} from "../conversations/types.ts"

type PiMessage = Parameters<SessionManager["appendMessage"]>[0]
type PiAssistantMessage = Extract<PiMessage, { role: "assistant" }>

export interface CreateSessionManagerInput {
	cwd?: string
	entries: ConversationStorageEntry[]
	modelProvider: string
	modelId: string
	onMessageEntryAppended?: (piEntryId: string, entry: ConversationStorageEntry) => void
}

export function createSessionManager(input: CreateSessionManagerInput): SessionManager {
	const sessionManager = SessionManager.inMemory(input.cwd ?? tmpdir())
	const context = buildContextFromEntries(input.entries)

	if (context.summary) {
		sessionManager.appendCompaction(
			context.summary.text,
			"freya-db-context-start",
			0,
			{
				conversationEntryId: context.summary.entry.id,
				covers: context.summary.covers,
			},
			true,
		)
	}

	for (const entry of context.entries) {
		const message = messageForEntry(entry, input.modelProvider, input.modelId)
		if (message) {
			const piEntryId = sessionManager.appendMessage(message)
			input.onMessageEntryAppended?.(piEntryId, entry)
		}
	}

	return sessionManager
}

function buildContextFromEntries(entries: ConversationStorageEntry[]): {
	summary?: { entry: ConversationStorageEntry; text: string; covers: unknown }
	entries: ConversationStorageEntry[]
} {
	const orderedEntries = [...entries].sort((left, right) => left.sequence - right.sequence)
	const summaryEntry = latestContextSummaryEntry(orderedEntries)
	if (!summaryEntry || summaryEntry.kind !== ConversationEntryKind.ContextSummary) {
		return { entries: orderedEntries }
	}

	const payload = ContextSummaryPayload.assert(summaryEntry.payload)
	const text = contextSummaryText(payload.summary)
	const rawStartSequence = payload.covers.endSequence + 1

	return {
		summary: {
			entry: summaryEntry,
			text,
			covers: payload.covers,
		},
		entries: orderedEntries.filter((entry) => entry.sequence >= rawStartSequence),
	}
}

function latestContextSummaryEntry(
	entries: ConversationStorageEntry[],
): ConversationStorageEntry | undefined {
	let latest: ConversationStorageEntry | undefined

	for (const entry of entries) {
		if (entry.kind !== ConversationEntryKind.ContextSummary) continue
		if (!latest || entry.sequence > latest.sequence) {
			latest = entry
		}
	}

	return latest
}

function messageForEntry(
	entry: ConversationStorageEntry,
	modelProvider: string,
	modelId: string,
): PiMessage | null {
	switch (entry.kind) {
		case ConversationEntryKind.UserMessage: {
			const payload = UserMessagePayload.assert(entry.payload)
			return {
				role: "user",
				content: messagePartsText(payload.parts),
				timestamp: entry.createdAt.getTime(),
			}
		}
		case ConversationEntryKind.AssistantMessage: {
			const payload = AssistantMessagePayload.assert(entry.payload)
			return {
				role: "assistant",
				content: [{ type: "text", text: messagePartsText(payload.parts) }],
				api: "anthropic-messages",
				provider: entry.metadata.modelRun?.provider ?? modelProvider,
				model: entry.metadata.modelRun?.model ?? modelId,
				usage: zeroUsage(),
				stopReason: "stop",
				timestamp: entry.createdAt.getTime(),
			} satisfies PiAssistantMessage
		}
		case ConversationEntryKind.Attachment:
		case ConversationEntryKind.ContextSummary:
		case ConversationEntryKind.SystemNote:
		case ConversationEntryKind.ToolCall:
		case ConversationEntryKind.ToolResult:
			return null
	}
}

function messagePartsText(
	parts: Array<{ type: "text"; text: string } | { type: "json"; value: unknown }>,
): string {
	return parts.map(messagePartText).join("\n")
}

function messagePartText(
	part: { type: "text"; text: string } | { type: "json"; value: unknown },
): string {
	switch (part.type) {
		case "text":
			return part.text
		case "json":
			return stringifyJson(part.value)
	}
}

function contextSummaryText(summary: {
	userIntent?: string
	durableFacts: string[]
	preferences: string[]
	decisions: string[]
	openTasks: string[]
	importantDetails: string[]
}): string {
	const sections: string[] = []
	pushSection(sections, "User intent", summary.userIntent ? [summary.userIntent] : [])
	pushSection(sections, "Durable facts", summary.durableFacts)
	pushSection(sections, "Preferences", summary.preferences)
	pushSection(sections, "Decisions", summary.decisions)
	pushSection(sections, "Open tasks", summary.openTasks)
	pushSection(sections, "Important details", summary.importantDetails)
	return sections.join("\n\n")
}

function pushSection(sections: string[], title: string, values: string[]): void {
	const trimmedValues = values.map((value) => value.trim()).filter(Boolean)
	if (trimmedValues.length === 0) return

	sections.push(`${title}:\n${trimmedValues.map((value) => `- ${value}`).join("\n")}`)
}

function stringifyJson(value: unknown): string {
	return JSON.stringify(value, null, 2) ?? String(value)
}

function zeroUsage(): PiAssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	}
}
