import type { JrxNode } from "@nym.sh/jrx"

import { jsx } from "@nym.sh/jrx/jsx-runtime"

export type FeedCardProps = {
	style?: string
	children?: JrxNode | JrxNode[]
}

export function FeedCard(props: FeedCardProps): JrxNode {
	return jsx("FeedCard", props)
}
