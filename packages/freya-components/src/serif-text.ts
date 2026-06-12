import type { JrxNode } from "@nym.sh/jrx"

import { jsx } from "@nym.sh/jrx/jsx-runtime"

export type SerifTextProps = {
	content?: string
	style?: string
	children?: JrxNode | JrxNode[]
}

export function SerifText(props: SerifTextProps): JrxNode {
	return jsx("SerifText", props)
}
