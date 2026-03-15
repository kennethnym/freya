import type { FeedItemRenderer } from "@aelis/core"

import { renderCalDavFeedItem } from "@aelis/source-caldav"

export const CALDAV_SOURCE_ID = "aelis.caldav"

export const calDavRenderer: FeedItemRenderer = renderCalDavFeedItem as FeedItemRenderer
