import { AnimatePresence, motion } from "motion/react"
import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Link, useFetcher } from "react-router"
import { Resend } from "resend"
import { Streamdown } from "streamdown"

import { ChatBox } from "~/chat/chat-box"
import {
	duplicateEmailMessage,
	INITIAL_MESSAGES,
	troubleMessage,
	waitListJoinedMessage,
	type Message,
	type SystemMessage,
	type UserMessage,
} from "~/chat/message"
import { useFakeStreaming } from "~/chat/use-fake-streaming"
import {
	AnimatedLogo,
	AnimatedLogoState,
	AnimatedLogoState as TAnimatedLogoState,
} from "~/components/animated-logo"
import { ProgressiveBlur } from "~/components/progressive-blur"

import type { Route } from "./+types/home"

const PAGE_TITLE = "Aelis - Next Generation AI Assistant"
const PAGE_DESCRIPTION =
	"Meet Aelis, a personal assistant that stays one step ahead of your day. Join the waitlist now."

export function meta({}: Route.MetaArgs) {
	return [
		{ title: PAGE_TITLE },
		{
			name: "description",
			content: PAGE_DESCRIPTION,
		},
		{ property: "og:title", content: PAGE_TITLE },
		{ property: "og:description", content: PAGE_DESCRIPTION },
		{ property: "og:image", content: "https://ael.is/social-media-preview.png" },
		{ property: "og:url", content: "https://ael.is" },
		{ property: "og:type", content: "website" },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:title", content: PAGE_TITLE },
		{ name: "twitter:description", content: PAGE_DESCRIPTION },
		{ name: "twitter:image", content: "https://ael.is/social-media-preview.png" },
	]
}

const FormError = {
	Duplicate: "duplicate",
	Resend: "resend",
} as const

export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData()
	const email = formData.get("email")

	if (typeof email !== "string" || !isValidEmail(email)) {
		return { error: "Invalid email" }
	}

	const resend = new Resend(process.env.RESEND_API_KEY)

	const segmentId = "b80fb036-74a1-4f7d-bca5-2c035b696071"

	const dup = await resend.contacts.get({
		email,
	})
	if (dup.data) {
		return { error: FormError.Duplicate }
	}

	const res = await resend.contacts.create({
		email,
		segments: [{ id: segmentId }],
	})

	if (res.error) {
		console.log("Error adding contact to Resend:", res.error)
		return { error: FormError.Resend, message: res.error.message }
	}

	const emailRes = await resend.emails.send({
		from: "Aelis <no-reply@ael.is>",
		to: email,
		template: {
			id: "waitlist-confirmation",
		},
	})

	if (emailRes.error) {
		// swallow the error since the user is already added to the waitlist, but log it for debugging
		console.log("Error sending confirmation email:", emailRes.error)
	}

	return { email }
}

export default function Home() {
	const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES)
	const [emailSent, setEmailSent] = useState("")
	const [isAnimatingSend, setIsAnimatingSend] = useState(false)
	const [logoState, setLogoState] = useState<TAnimatedLogoState>(AnimatedLogoState.Idle)
	const chatBoxRef = useRef<HTMLDivElement>(null)
	const fetcher = useFetcher()

	useEffect(() => {
		if (fetcher.data?.email && !isAnimatingSend) {
			setMessages((messages) => [...messages, waitListJoinedMessage(fetcher.data.email)])
		} else if (fetcher.data?.error) {
			if (!isAnimatingSend) {
				let errorMessage: SystemMessage
				switch (fetcher.data.error) {
					case FormError.Duplicate:
						errorMessage = duplicateEmailMessage()
						break
					default: {
						console.error(fetcher.data.error)
						errorMessage = troubleMessage()
						break
					}
				}
				setMessages((messages) => [...messages, errorMessage])
			}
		}
	}, [fetcher.data?.email, fetcher.data?.error, isAnimatingSend])

	const insertEmailMessage = (email: string) => {
		setEmailSent(email)
		setIsAnimatingSend(true)
		setLogoState(AnimatedLogoState.Loading)
		setMessages((messages) => [
			...messages,
			{
				role: "user",
				message: email,
				bubbleLayoutId: "test",
			},
		])

		fetcher.submit({ email }, { method: "post" })
	}

	let chatBox: React.ReactNode
	if (emailSent && isAnimatingSend) {
		const chatBoxRect = chatBoxRef.current?.getBoundingClientRect()
		const mainRect = chatBoxRef.current?.offsetParent?.getBoundingClientRect()
		chatBox = (
			<MorphingChatBox
				chatBoxWidth={chatBoxRef.current?.offsetWidth ?? 0}
				chatBoxHeight={chatBoxRef.current?.offsetHeight ?? 0}
				chatBoxLeft={(chatBoxRect?.left ?? 0) - (mainRect?.left ?? 0)}
				chatBoxTop={(chatBoxRect?.top ?? 0) - (mainRect?.top ?? 0)}
				onAnimationEnd={() => {
					setIsAnimatingSend(false)
				}}
			>
				{emailSent}
			</MorphingChatBox>
		)
	} else if (!emailSent) {
		chatBox = (
			<AnimatePresence>
				{logoState === AnimatedLogoState.Idle && !emailSent && (
					<motion.div
						ref={chatBoxRef}
						key="test"
						className="w-full max-w-2xl absolute bottom-12 px-6 md:px-0 flex justify-center z-20"
						initial={{ y: 100, opacity: 0 }}
						animate={{ y: 0, opacity: 1 }}
						transition={{ type: "spring", stiffness: 300, damping: 30, mass: 1.5 }}
					>
						<ChatBox
							className="w-full max-w-2xl"
							validate={isValidEmail}
							disabled={fetcher.state === "submitting" || fetcher.state === "loading"}
							onSubmit={insertEmailMessage}
						/>
					</motion.div>
				)}
			</AnimatePresence>
		)
	} else {
		chatBox = null
	}

	return (
		<main className="relative w-full h-full flex flex-col items-center justify-start gap-4 overflow-hidden">
			<ProgressiveBlur className="absolute top-0 left-0 right-0 h-24 z-10" />
			<AnimatedLogo
				className="absolute top-4 md:top-8 size-10 z-20 cursor-pointer"
				state={logoState}
			/>
			<MessageList
				messages={messages}
				showLastMessage={!isAnimatingSend}
				onMessageStreamStart={() => {
					setLogoState(AnimatedLogoState.Loading)
				}}
				onMessageStreamEnd={() => {
					setLogoState(AnimatedLogoState.Idle)
				}}
			/>
			{chatBox}
			<ProgressiveBlur
				direction="up"
				className="absolute bottom-0 left-0 right-0 h-24 z-10 pointer-events-none"
			/>
			<footer className="absolute bottom-4 z-20">
				<Link to="/privacy" className="text-xs opacity-50 underline">
					Privacy policy
				</Link>
			</footer>
		</main>
	)
}

function MorphingChatBox({
	chatBoxWidth,
	chatBoxHeight,
	chatBoxLeft,
	chatBoxTop,
	onAnimationEnd,
	children,
}: React.PropsWithChildren<{
	chatBoxWidth: number
	chatBoxHeight: number
	chatBoxLeft: number
	chatBoxTop: number
	onAnimationEnd: () => void
}>) {
	const [targetWidth, setTargetWidth] = useState(-1)
	const [targetHeight, setTargetHeight] = useState(-1)
	const [targetCoords, setTargetCoords] = useState([0, 0])

	useLayoutEffect(() => {
		const bubble = document.getElementById("test")
		if (bubble) {
			const mainRect = bubble.closest("main")?.getBoundingClientRect()
			const rect = bubble.getBoundingClientRect()
			setTargetWidth(bubble.offsetWidth)
			setTargetHeight(bubble.offsetHeight)
			setTargetCoords([rect.left - (mainRect?.left ?? 0), rect.top - (mainRect?.top ?? 0)])
		}
	}, [])

	if (targetWidth < 0 || targetHeight < 0) {
		return null
	}

	return (
		<motion.div
			className="absolute rounded-lg bg-stone-100 dark:bg-stone-800 px-4 py-2 border border-stone-200 dark:border-stone-700"
			initial={{
				width: chatBoxWidth,
				height: chatBoxHeight,
				borderRadius: 8,
				left: chatBoxLeft,
				top: chatBoxTop,
			}}
			animate={{
				width: targetWidth,
				height: targetHeight,
				borderTopLeftRadius: 100,
				borderTopRightRadius: 100,
				borderBottomRightRadius: 24,
				borderBottomLeftRadius: 100,
				left: targetCoords[0],
				top: targetCoords[1],
			}}
			transition={{
				left: { duration: 0.45, ease: [0.05, 0.8, 0.3, 1] },
				top: { duration: 0.45, ease: [0.3, 0, 0.2, 1] },
				width: { duration: 0.45, ease: [0.05, 0.8, 0.3, 1] },
				height: { duration: 0.45, ease: [0.05, 0.8, 0.3, 1] },
			}}
			onAnimationComplete={onAnimationEnd}
		>
			{children}
		</motion.div>
	)
}

function MessageList({
	messages,
	showLastMessage,
	onMessageStreamStart,
	onMessageStreamEnd,
}: {
	messages: Message[]
	showLastMessage: boolean
	onMessageStreamStart: () => void
	onMessageStreamEnd: () => void
}) {
	return (
		<ul className="w-full flex flex-col gap-8 overflow-auto px-6 pt-20 md:px-0 md:pt-24 pb-34">
			{messages.map((message, index) => (
				<li
					key={index}
					className={`flex justify-center ${index === messages.length - 1 && !showLastMessage ? "invisible" : ""}`}
				>
					<MessageContent
						message={message}
						onMessageStreamStart={onMessageStreamStart}
						onMessageStreamEnd={onMessageStreamEnd}
					/>
				</li>
			))}
		</ul>
	)
}

function MessageContent({
	message,
	onMessageStreamStart,
	onMessageStreamEnd,
}: {
	message: Message
	onMessageStreamStart: () => void
	onMessageStreamEnd: () => void
}) {
	switch (message.role) {
		case "user":
			return <UserMessageBubble message={message} />
		case "system":
			return (
				<SystemMessageBubble
					message={message}
					onStreamStart={onMessageStreamStart}
					onStreamEnd={onMessageStreamEnd}
				/>
			)
	}
}

function UserMessageBubble({ message }: { message: UserMessage }) {
	return (
		<div className="w-full max-w-2xl flex justify-end">
			<div
				id={message.bubbleLayoutId}
				className="rounded-[100px_100px_24px_100px] bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 px-4 py-2"
			>
				{message.message}
			</div>
		</div>
	)
}

function SystemMessageBubble({
	message,
	onStreamStart,
	onStreamEnd,
}: {
	message: SystemMessage
	onStreamStart: () => void
	onStreamEnd: () => void
}) {
	const { currentContent, isStreaming } = useFakeStreaming(message.message)
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		ref.current?.scrollIntoView({ behavior: "smooth", block: "end" })
	}, [currentContent])

	useEffect(() => {
		if (isStreaming) {
			onStreamStart()
		} else {
			onStreamEnd()
		}
	}, [isStreaming])

	return (
		<div ref={ref} className="w-full max-w-2xl flex justify-start font-serif text-lg scroll-mb-34">
			<Streamdown
				animated={{ animation: "slideUp" }}
				isAnimating={isStreaming}
				linkSafety={{ enabled: false }}
				components={{
					// @ts-expect-error
					a: ({ className, ...props }) => <a className={`underline ${className}`} {...props} />,
				}}
			>
				{currentContent}
			</Streamdown>
		</div>
	)
}

function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
