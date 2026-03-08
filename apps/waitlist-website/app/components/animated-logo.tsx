import Lottie, { type LottieRef } from "lottie-react"
import { useEffect, useRef, useState } from "react"

import { useColorScheme } from "~/hooks/use-color-scheme"
import clickedAnimationDark from "~/lottie/clicked-dark.json"
import clickedAnimationLight from "~/lottie/clicked-light.json"
import loadingAnimationDark from "~/lottie/loading-dark.json"
import loadingAnimationLight from "~/lottie/loading-light.json"
import startLoadingAnimationDark from "~/lottie/start-loading-dark.json"
import startLoadingAnimationLight from "~/lottie/start-loading-light.json"

export const AnimatedLogoState = {
	Idle: "idle",
	Loading: "loading",
} as const
export type AnimatedLogoState = (typeof AnimatedLogoState)[keyof typeof AnimatedLogoState]

interface AnimatedLogoProps {
	state: AnimatedLogoState
	className?: string
}

interface Animation {
	loop: boolean
	reverse: boolean
	sticky: boolean
	data: unknown
}

export function AnimatedLogo({ state, className }: AnimatedLogoProps) {
	const colorScheme = useColorScheme()
	const [animationQueue, setAnimationQueue] = useState<Animation[]>([])
	const lottieRef: LottieRef = useRef(null)

	let currentAnimation: Animation
	let isIdle = false
	if (animationQueue.length === 0) {
		isIdle = true
		currentAnimation = {
			loop: false,
			reverse: false,
			sticky: false,
			data: colorScheme === "dark" ? startLoadingAnimationDark : startLoadingAnimationLight,
		}
	} else {
		isIdle = false
		currentAnimation = animationQueue[0]
	}

	useEffect(() => {
		if (state === AnimatedLogoState.Loading) {
			setAnimationQueue((queue) => [
				...queue,
				{
					loop: false,
					reverse: false,
					sticky: false,
					data: colorScheme === "dark" ? startLoadingAnimationDark : startLoadingAnimationLight,
				},
				{
					loop: true,
					reverse: false,
					sticky: false,
					data: colorScheme === "dark" ? loadingAnimationDark : loadingAnimationLight,
				},
			])
		} else if (state === AnimatedLogoState.Idle) {
			setAnimationQueue((queue) => {
				const last = queue.at(-1)
				if (!last) {
					return []
				}
				if (
					last.loop &&
					(last.data === loadingAnimationDark || last.data === loadingAnimationLight)
				) {
					return [
						...queue,
						{
							loop: false,
							sticky: false,
							reverse: false,
							data: colorScheme === "dark" ? loadingAnimationDark : loadingAnimationLight,
						},
						{
							loop: false,
							sticky: false,
							reverse: true,
							data: colorScheme === "dark" ? startLoadingAnimationDark : startLoadingAnimationLight,
						},
					]
				}
				return []
			})
		}
	}, [state])

	useEffect(() => {
		if (!lottieRef.current) {
			return
		}
		if (currentAnimation.reverse) {
			const frames = lottieRef.current.getDuration(true)
			if (frames) {
				lottieRef.current.setDirection(-1)
				lottieRef.current.goToAndPlay(frames - 1, true)
			}
		} else if (!isIdle) {
			lottieRef.current.setDirection(1)
			lottieRef.current.play()
		}
	}, [currentAnimation])

	function onComplete() {
		if (animationQueue.length > 0 && !animationQueue[0].sticky) {
			setAnimationQueue((queue) => queue.slice(1))
		}
	}

	function onLoopComplete() {
		const current = animationQueue[0]
		const next = animationQueue[1]
		if (current && next && current.data === next.data && current.loop && !next.loop) {
			setAnimationQueue((queue) => queue.slice(2))
		}
	}

	function onMouseDown() {
		if (state === AnimatedLogoState.Idle) {
			setAnimationQueue([
				{
					loop: false,
					sticky: true,
					reverse: false,
					data: colorScheme === "dark" ? clickedAnimationDark : clickedAnimationLight,
				},
			])
		}
	}

	function onMouseUp() {
		if (state === AnimatedLogoState.Idle) {
			setAnimationQueue((queue) => [
				{
					loop: false,
					sticky: false,
					reverse: true,
					data: colorScheme === "dark" ? clickedAnimationDark : clickedAnimationLight,
				},
			])
		}
	}

	return (
		<Lottie
			lottieRef={lottieRef}
			autoplay={false}
			loop={currentAnimation.loop}
			className={className}
			animationData={currentAnimation.data}
			onComplete={onComplete}
			onLoopComplete={onLoopComplete}
			onMouseDown={onMouseDown}
			onMouseUp={onMouseUp}
		/>
	)
}
