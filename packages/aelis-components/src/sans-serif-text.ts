import type { JrxNode } from "@nym.sh/jrx"

import { jsx } from "@nym.sh/jrx/jsx-runtime"

export type SansSerifTextProps = {
	content?: string
	style?: string
	children?: JrxNode | JrxNode[]
}

export function SansSerifText(props: SansSerifTextProps): JrxNode {
	return jsx("SansSerifText", props)
}
