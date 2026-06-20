import { queryOptions, skipToken } from "@tanstack/react-query"
import { type } from "arktype"

import { useApiClient } from "@/api/client"

import { ConversationEntry } from "./conversations"

const ConversationQueryResponse = type({
	entries: ConversationEntry.array(),
})

export function useListConversationsQuery() {
	const api = useApiClient()
	return queryOptions({
		queryKey: ["conversations"],
		queryFn: async () =>
			api
				.request("/conversations", { method: "GET" })
				.then(([, json]) => ConversationQueryResponse.assert(json)),
	})
}

export function useDefaultConversationQuery() {
	return queryOptions({
		...useListConversationsQuery(),
		select: (data) => (data.entries.length === 0 ? null : data.entries[0]),
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
						.then(([, json]) => ConversationQueryResponse.assert(json).entries)
			: skipToken,
	})
}
