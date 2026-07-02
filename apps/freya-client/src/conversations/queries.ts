import { queryOptions, skipToken } from "@tanstack/react-query"
import { type } from "arktype"

import { useApiClient } from "@/api/client"

import { Conversation, ConversationEntry } from "./conversations"

const ListConversationsResponse = type({
	conversations: Conversation.array(),
})

const ConversationEntriesResponse = type({
	entries: ConversationEntry.array(),
})

export function useListConversationsQuery() {
	const api = useApiClient()
	return queryOptions({
		queryKey: ["conversations"],
		queryFn: async () =>
			api
				.request("/conversations", { method: "GET" })
				.then(([, json]) => ListConversationsResponse.assert(json)),
	})
}

export function useDefaultConversationQuery() {
	return queryOptions({
		...useListConversationsQuery(),
		select: (data) => {
			return data.conversations.length === 0 ? null : data.conversations[0]
		},
	})
}

export function useListConversationEntriesQuery(id?: string) {
	const api = useApiClient()
	return queryOptions({
		queryKey: ["conversations", id],
		queryFn: id
			? async () =>
					api
						.request(`/conversations/${id}/entries`, { method: "GET" })
						.then(([, json]) => ConversationEntriesResponse.assert(json).entries)
			: skipToken,
	})
}
