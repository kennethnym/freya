import { useEffect, useState } from "react"

export const ColorScheme = {
	Light: "light",
	Dark: "dark",
} as const
export type ColorScheme = (typeof ColorScheme)[keyof typeof ColorScheme]

export function useColorScheme(): ColorScheme {
	const [scheme, setScheme] = useState<ColorScheme>(() => {
		if (typeof window === "undefined") return ColorScheme.Light
		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? ColorScheme.Dark
			: ColorScheme.Light
	})

	useEffect(() => {
		const mql = window.matchMedia("(prefers-color-scheme: dark)")
		const handler = (e: MediaQueryListEvent) => {
			setScheme(e.matches ? ColorScheme.Dark : ColorScheme.Light)
		}
		mql.addEventListener("change", handler)
		return () => mql.removeEventListener("change", handler)
	}, [])

	return scheme
}
