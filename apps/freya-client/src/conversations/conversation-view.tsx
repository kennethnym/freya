import { FlashList } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";

import {
  useListConversationEntriesQuery,
  useDefaultConversationQuery,
  useListConversationsQuery,
} from "./queries";

export function ConversationView() {
  const { data: conversation } = useQuery(useDefaultConversationQuery());
  const { data: entries } = useQuery(
    useListConversationEntriesQuery(conversation?.id),
  );

  return (
    <FlashList
      data={entries ?? []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <div key={item.id}>{item.kind}</div>}
    />
  );
}
