import { useQuery } from "@tanstack/react-query"
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react"
import { useState } from "react"

import type { FeedItem } from "@/lib/api"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchFeed } from "@/lib/api"

export function FeedPanel() {
	const {
		data: feed,
		error: feedError,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: ["feed"],
		queryFn: fetchFeed,
		enabled: false,
	})

	const error = feedError?.message ?? null

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<div className="flex items-center justify-between gap-4">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold tracking-tight">Feed</h2>
					<p className="text-sm text-muted-foreground">Query the feed as the current user.</p>
				</div>
				<Button onClick={() => refetch()} disabled={isFetching} size="sm">
					{isFetching ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<RefreshCw className="size-3.5" />
					)}
					{feed ? "Refresh" : "Fetch"}
				</Button>
			</div>

			{error && (
				<Card className="-mx-4 border-destructive">
					<CardContent className="flex items-center gap-2 text-sm text-destructive">
						<TriangleAlert className="size-4 shrink-0" />
						{error}
					</CardContent>
				</Card>
			)}

			{feed && feed.errors.length > 0 && (
				<Card className="-mx-4">
					<CardHeader className="pb-3">
						<CardTitle className="text-sm">Source Errors</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{feed.errors.map((e) => (
							<div key={e.sourceId} className="flex items-start gap-2 text-sm">
								<Badge variant="outline" className="shrink-0 font-mono text-xs">
									{e.sourceId}
								</Badge>
								<span className="select-text text-muted-foreground">{e.error}</span>
							</div>
						))}
					</CardContent>
				</Card>
			)}

			{feed && (
				<div className="space-y-3">
					<p className="text-xs text-muted-foreground">
						{feed.items.length} {feed.items.length === 1 ? "item" : "items"}
					</p>
					{feed.items.length === 0 && (
						<p className="text-sm text-muted-foreground">No items in feed.</p>
					)}
					{feed.items.map((item) => (
						<FeedItemCard key={item.id} item={item} />
					))}
				</div>
			)}
		</div>
	)
}

function FeedItemCard({ item }: { item: FeedItem }) {
	const [expanded, setExpanded] = useState(false)

	return (
		<Card className="-mx-4">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<CardTitle className="text-sm">{item.type}</CardTitle>
						<Badge variant="secondary" className="font-mono text-xs">
							{item.sourceId}
						</Badge>
					</div>
					<div className="flex items-center gap-2">
						{item.signals?.timeRelevance && (
							<Badge variant="outline" className="text-xs">
								{item.signals.timeRelevance}
							</Badge>
						)}
						{item.signals?.urgency !== undefined && (
							<Badge variant="outline" className="text-xs">
								urgency: {item.signals.urgency}
							</Badge>
						)}
					</div>
				</div>
				<p className="select-text font-mono text-xs text-muted-foreground">{item.id}</p>
			</CardHeader>
			<CardContent className="space-y-3">
				{item.slots && Object.keys(item.slots).length > 0 && (
					<div className="space-y-1.5">
						{Object.entries(item.slots).map(([name, slot]) => (
							<div key={name} className="text-sm">
								<span className="font-medium">{name}: </span>
								<span className="select-text text-muted-foreground">
									{slot.content ?? <span className="italic">pending</span>}
								</span>
							</div>
						))}
					</div>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="h-auto px-0 text-xs text-muted-foreground"
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? "Hide" : "Show"} raw data
				</Button>
				{expanded && (
					<pre className="select-text overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
						{JSON.stringify(item.data, null, 2)}
					</pre>
				)}
			</CardContent>
		</Card>
	)
}
