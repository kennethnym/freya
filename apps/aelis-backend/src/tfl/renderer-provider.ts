import type { FeedItemRenderer } from "@aelis/core"

import { renderTflAlert } from "@aelis/source-tfl"

export const TFL_SOURCE_ID = "aelis.tfl"

export const tflRenderer: FeedItemRenderer = renderTflAlert as FeedItemRenderer
