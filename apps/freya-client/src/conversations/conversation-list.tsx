import { AssistantMessagePayload, UserMessagePayload } from "@freya/core"
import { FlashList } from "@shopify/flash-list"
import { useQuery } from "@tanstack/react-query"
import { View, ViewStyle } from "react-native"
import tw from "twrnc"

import { SansSerifText } from "@/components/ui/sans-serif-text"

import { ConversationEntry } from "./conversations"
import { useListConversationEntriesQuery, useDefaultConversationQuery } from "./queries"

type ConversationListProps = Omit<
	React.ComponentProps<typeof FlashList>,
	"data" | "keyExtractor" | "renderItem" | "maintainVisibleContentPosition"
>

type PositionInGroup = "single" | "first" | "in-between" | "last"

const messageBubbleRadius = 18
const groupedMessageBubbleRadius = 6

export function ConversationList({
	ListFooterComponent,
	ListHeaderComponent,
	onScrollBeginDrag,
}: ConversationListProps) {
	const { data: conversation } = useQuery(useDefaultConversationQuery())
	const { data: entries } = useQuery(useListConversationEntriesQuery(conversation?.id))
	const conversationEntries = entries ?? []

	return (
		<FlashList
			style={tw`size-full`}
			maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
			data={conversationEntries}
			keyExtractor={(item) => item.id}
			renderItem={({ item, index }) => {
				const previousEntryIsSameKind = conversationEntries[index - 1]?.kind === item.kind
				const nextEntryIsSameKind = conversationEntries[index + 1]?.kind === item.kind

				let position: PositionInGroup
				if (!previousEntryIsSameKind && !nextEntryIsSameKind) {
					position = "single"
				} else if (!previousEntryIsSameKind) {
					position = "first"
				} else if (!nextEntryIsSameKind) {
					position = "last"
				} else {
					position = "in-between"
				}

				return <MessageBubble entry={item} position={position} />
			}}
			onScrollBeginDrag={onScrollBeginDrag}
			ListHeaderComponent={ListHeaderComponent}
			ListFooterComponent={ListFooterComponent}
		/>
	)
}

function MessageBubble({
	entry,
	position,
}: {
	entry: typeof ConversationEntry.infer
	position: PositionInGroup
}) {
	if (entry.kind === "user_message") {
		const payload = UserMessagePayload.assert(entry.payload)
		return <UserMessageBubble payload={payload} position={position} />
	}
	if (entry.kind === "assistant_message") {
		const payload = AssistantMessagePayload.assert(entry.payload)
		return <AssistantMessageBubble payload={payload} position={position} />
	}
	return null
}

function UserMessageBubble({
	payload,
	position,
}: {
	payload: UserMessagePayload
	position: PositionInGroup
}) {
	const content = payload.parts.reduce((final, part) => {
		if (part.type === "text") {
			return final + part.text
		}
		return final
	}, "")

	let corners: ViewStyle
	switch (position) {
		case "single":
		case "first":
			corners = {
				borderRadius: messageBubbleRadius,
				borderBottomRightRadius: groupedMessageBubbleRadius,
			}
			break
		case "in-between":
			corners = {
				borderRadius: messageBubbleRadius,
				borderTopRightRadius: groupedMessageBubbleRadius,
				borderBottomRightRadius: groupedMessageBubbleRadius,
			}
			break
		case "last":
			corners = {
				borderRadius: messageBubbleRadius,
				borderTopRightRadius: groupedMessageBubbleRadius,
			}
			break
	}

	return (
		<View style={tw`w-full flex-row justify-end mb-4 pr-4`}>
			<View
				style={tw.style("bg-teal-600 px-3 py-2 overflow-hidden max-w-56", corners, {
					borderCurve: "circular",
				})}
			>
				<SansSerifText style={tw`text-stone-100`}>{content}</SansSerifText>
			</View>
		</View>
	)
}

function AssistantMessageBubble({
	payload,
	position,
}: {
	payload: AssistantMessagePayload
	position: PositionInGroup
}) {
	const content = payload.parts.reduce((final, part) => {
		if (part.type === "text") {
			return final + part.text
		}
		return final
	}, "")

	let corners: ViewStyle
	switch (position) {
		case "single":
		case "first":
			corners = {
				borderRadius: messageBubbleRadius,
				borderBottomLeftRadius: groupedMessageBubbleRadius,
			}
			break
		case "in-between":
			corners = {
				borderRadius: messageBubbleRadius,
				borderTopLeftRadius: groupedMessageBubbleRadius,
				borderBottomLeftRadius: groupedMessageBubbleRadius,
			}
			break
		case "last":
			corners = {
				borderRadius: messageBubbleRadius,
				borderTopLeftRadius: groupedMessageBubbleRadius,
			}
			break
	}

	return (
		<View style={tw`w-full flex-row justify-start mb-4 pl-4`}>
			<View
				style={tw.style(
					"bg-stone-200 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 px-3 py-2 overflow-hidden max-w-56",
					corners,
					{
						borderCurve: "circular",
					},
				)}
			>
				<SansSerifText style={tw`text-stone-950 dark:text-stone-100`}>{content}</SansSerifText>
			</View>
		</View>
	)
}
