import { useEffect, useMemo, useState } from "react"

export function useFakeStreaming(fullContent: string) {
	const [currentContent, setCurrentContent] = useState("")
	const [isStreaming, setIsStreaming] = useState(true)

	useEffect(() => {
		const words = fullContent.split(" ")

		let i = 0
		const id = setInterval(() => {
			if (i > words.length) {
				setIsStreaming(false)
				clearInterval(id)
			} else {
				setCurrentContent(words.slice(0, i).join(" ") + " ")
				i++
			}
		}, 20)
	}, [fullContent])

	return useMemo(() => ({ currentContent, isStreaming }), [currentContent, isStreaming])
}
