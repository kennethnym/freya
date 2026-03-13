import type { JrxNode } from "@nym.sh/jrx"

import { jsx } from "@nym.sh/jrx/jsx-runtime"

export type MonospaceTextProps = {
	content?: string
	style?: string
	children?: JrxNode | JrxNode[]
}

export function MonospaceText(props: MonospaceTextProps): JrxNode {
	return jsx("MonospaceText", props)
}
