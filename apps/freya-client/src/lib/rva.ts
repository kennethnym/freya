import type { StyleProp, ViewStyle } from "react-native"

type RvaNoInfer<TValue> = [TValue][TValue extends unknown ? 0 : never]
type VariantValue = string | number | boolean | null | undefined
type VariantOptionKey<TOptions> = Extract<keyof TOptions, string>
type BooleanVariantInput<TOptions> =
	Extract<VariantOptionKey<TOptions>, "true" | "false"> extends never ? never : boolean
type StringVariantInput<TOptions> = Exclude<VariantOptionKey<TOptions>, "true" | "false">
type VariantInput<TOptions> =
	| StringVariantInput<TOptions>
	| BooleanVariantInput<TOptions>
	| null
	| undefined
type CompoundCondition<TVariants extends RvaVariants<unknown>> = {
	name: keyof TVariants
	value: string
}
type NormalizedCompoundVariant<TStyle, TVariants extends RvaVariants<TStyle>> = {
	conditions: CompoundCondition<TVariants>[]
	style: StyleProp<TStyle>
}

export type RvaVariants<TStyle = unknown> = {
	readonly [name: string]: {
		readonly [value: string]: StyleProp<TStyle>
	}
}

export type RvaVariantProps<TVariants extends RvaVariants<unknown>> = {
	readonly [TName in keyof TVariants]?: VariantInput<TVariants[TName]>
}
type MutableRvaVariantProps<TVariants extends RvaVariants<unknown>> = {
	-readonly [TName in keyof TVariants]?: VariantInput<TVariants[TName]>
}

export type RvaCompoundVariant<
	TStyle,
	TVariants extends RvaVariants<TStyle>,
> = RvaVariantProps<TVariants> & {
	readonly style: StyleProp<TStyle>
}

export type RvaConfig<TStyle, TVariants extends RvaVariants<TStyle>> = {
	readonly variants?: TVariants
	readonly defaultVariants?: RvaVariantProps<TVariants>
	readonly compoundVariants?: readonly RvaCompoundVariant<TStyle, TVariants>[]
}

export type RvaResolver<TStyle, TVariants extends RvaVariants<TStyle>> = (
	props?: RvaVariantProps<TVariants>,
) => StyleProp<TStyle>

export type RvaProps<TResolver> = TResolver extends (props?: infer TProps) => unknown
	? NonNullable<TProps>
	: never

export function rva<TStyle = ViewStyle>(): <
	const TVariants extends RvaVariants<TStyle> = RvaVariants<TStyle>,
>(
	base: StyleProp<RvaNoInfer<TStyle>>,
	config?: RvaConfig<RvaNoInfer<TStyle>, TVariants>,
) => RvaResolver<TStyle, TVariants>
export function rva<
	TStyle = ViewStyle,
	const TVariants extends RvaVariants<TStyle> = RvaVariants<TStyle>,
>(
	base: StyleProp<RvaNoInfer<TStyle>>,
	config?: RvaConfig<RvaNoInfer<TStyle>, TVariants>,
): RvaResolver<TStyle, TVariants>
export function rva<
	TStyle = ViewStyle,
	const TVariants extends RvaVariants<TStyle> = RvaVariants<TStyle>,
>(
	base?: StyleProp<TStyle>,
	config?: RvaConfig<TStyle, TVariants>,
):
	| RvaResolver<TStyle, TVariants>
	| (<const TTypedVariants extends RvaVariants<TStyle> = RvaVariants<TStyle>>(
			base: StyleProp<TStyle>,
			config?: RvaConfig<TStyle, TTypedVariants>,
	  ) => RvaResolver<TStyle, TTypedVariants>) {
	if (base === undefined && config === undefined) {
		return function createTypedRva<
			const TTypedVariants extends RvaVariants<TStyle> = RvaVariants<TStyle>,
		>(typedBase: StyleProp<TStyle>, typedConfig: RvaConfig<TStyle, TTypedVariants> = {}) {
			return createRva(typedBase, typedConfig)
		}
	}

	return createRva(base, config ?? {})
}

function createRva<TStyle, const TVariants extends RvaVariants<TStyle> = RvaVariants<TStyle>>(
	base: StyleProp<TStyle>,
	config: RvaConfig<TStyle, TVariants>,
): RvaResolver<TStyle, TVariants> {
	const compoundVariants = normalizeCompoundVariants(config.compoundVariants)

	return function resolveRva(props: RvaVariantProps<TVariants> = {}) {
		const merged = mergeVariantProps(config.defaultVariants, props)
		const styles: StyleProp<TStyle>[] = [base]
		const variants = config.variants

		if (variants !== undefined) {
			for (const name in variants) {
				const value = normalizeVariantValue(merged[name])

				if (value === undefined) {
					continue
				}

				const style = variants[name]?.[value]

				if (style !== undefined) {
					styles.push(style)
				}
			}
		}

		for (const compound of compoundVariants) {
			if (compoundMatches(compound, merged)) {
				styles.push(compound.style)
			}
		}

		return styles
	}
}

function mergeVariantProps<TVariants extends RvaVariants<unknown>>(
	defaultVariants: RvaVariantProps<TVariants> | undefined,
	props: RvaVariantProps<TVariants>,
): RvaVariantProps<TVariants> {
	const merged: MutableRvaVariantProps<TVariants> = {}

	if (defaultVariants !== undefined) {
		for (const name of Object.keys(defaultVariants) as (keyof TVariants)[]) {
			const value = defaultVariants[name]

			if (value !== undefined) {
				merged[name] = value
			}
		}
	}

	for (const name of Object.keys(props) as (keyof TVariants)[]) {
		const value = props[name]

		if (value !== undefined) {
			merged[name] = value
		}
	}

	return merged
}

function normalizeCompoundVariants<TStyle, TVariants extends RvaVariants<TStyle>>(
	compoundVariants: readonly RvaCompoundVariant<TStyle, TVariants>[] | undefined,
) {
	const normalized: NormalizedCompoundVariant<TStyle, TVariants>[] = []

	if (compoundVariants === undefined) {
		return normalized
	}

	for (const compound of compoundVariants) {
		const conditions: CompoundCondition<TVariants>[] = []

		for (const name in compound) {
			if (name === "style") {
				continue
			}

			const variantName = name as keyof TVariants
			const value = normalizeVariantValue(compound[variantName])

			if (value !== undefined) {
				conditions.push({ name: variantName, value })
			}
		}

		normalized.push({ conditions, style: compound.style })
	}

	return normalized
}

function compoundMatches<TStyle, TVariants extends RvaVariants<TStyle>>(
	compound: NormalizedCompoundVariant<TStyle, TVariants>,
	props: RvaVariantProps<TVariants>,
) {
	for (const condition of compound.conditions) {
		if (normalizeVariantValue(props[condition.name]) !== condition.value) {
			return false
		}
	}

	return true
}

function normalizeVariantValue(value: VariantValue) {
	if (value === null || value === undefined) {
		return undefined
	}

	if (value === true) {
		return "true"
	}

	if (value === false) {
		return "false"
	}

	return String(value)
}
