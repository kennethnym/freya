import { queryOptions } from "@tanstack/react-query"

import { useApiClient } from "@/api/client"

import { FeedItem } from "./types"

export function useFeedQuery() {
	const api = useApiClient()
	return queryOptions({
		queryKey: ["feed"],
		queryFn: async () => api.request<{ items: FeedItem[] }>("/feed?render=json-render"),
	})
}
