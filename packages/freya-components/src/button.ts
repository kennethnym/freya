import type { JrxNode } from "@nym.sh/jrx"

import { jsx } from "@nym.sh/jrx/jsx-runtime"

export type ButtonProps = {
	label: string
	leadingIcon?: string
	trailingIcon?: string
	style?: string
	children?: JrxNode | JrxNode[]
}

export function Button(props: ButtonProps): JrxNode {
	return jsx("Button", props)
}
