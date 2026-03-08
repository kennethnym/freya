import clsx from "clsx"
import { ArrowUpIcon, FileIcon, ImageIcon, PlusIcon, XIcon } from "lucide-react"
import { motion, useAnimate } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components"

export function ChatBox({
	className,
	validate,
	onSubmit,
}: {
	className?: string
	validate?: (value: string) => boolean
	onSubmit: (email: string) => void
	disabled?: boolean
}) {
	const [scope, animate] = useAnimate()
	const [shouldShowInvalid, setShouldShowInvalid] = useState(false)
	const clearInvalidStateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(
		() => () => {
			if (clearInvalidStateTimeout.current) {
				clearTimeout(clearInvalidStateTimeout.current)
			}
		},
		[],
	)

	function showInvalidState() {
		animate(scope.current, { x: [0, -6, 6, -4, 4, -2, 2, 0] }, { duration: 0.4, ease: "easeOut" })
		if (clearInvalidStateTimeout.current) {
			clearTimeout(clearInvalidStateTimeout.current)
		}
		setShouldShowInvalid(true)
		clearInvalidStateTimeout.current = setTimeout(() => {
			setShouldShowInvalid(false)
		}, 500)
	}

	const onFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		const formData = new FormData(e.currentTarget)
		const email = formData.get("liame")
		if (typeof email === "string") {
			const trimmed = email.trim()
			if (trimmed.length === 0) {
				showInvalidState()
			} else if (validate && !validate(trimmed)) {
				showInvalidState()
			} else {
				onSubmit(trimmed)
				e.currentTarget.reset()
			}
		}
	}

	return (
		<motion.form
			ref={scope}
			onSubmit={onFormSubmit}
			className={`min-h-20 px-3 pt-2 pb-1.5 flex flex-col justify-between rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 ${className ?? ""} shadow-xs hover:shadow-sm`}
		>
			<input
				name="liame"
				className="w-full bg-transparent outline-none focus:outline-none ring-0 focus:ring-0"
			/>
			<div className="w-full flex justify-between">
				<MenuTrigger>
					<Button className="bg-transparent hover:bg-stone-200 dark:hover:bg-stone-700 active:bg-stone-300 dark:active:bg-stone-600 data-[pressed]:bg-stone-200 dark:data-[pressed]:bg-stone-700 rounded-full flex items-center justify-center p-1 -ml-1.5 active:inset-shadow-sm outline-none transition-transform duration-200 data-[pressed]:rotate-45">
						<PlusIcon size={16} />
					</Button>
					<Popover
						offset={4}
						className="origin-bottom-left rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 shadow-lg p-1 min-w-40 outline-none data-[entering]:animate-[popover-in_150ms_ease-out] data-[exiting]:animate-[popover-out_100ms_ease-in]"
						placement="top start"
					>
						<AttachmentMenu />
					</Popover>
				</MenuTrigger>
				<button
					type="submit"
					disabled={shouldShowInvalid}
					className={clsx(
						"transition-all rounded-full flex items-center justify-center p-1 -mr-1.5 active:scale-95",
						shouldShowInvalid
							? "bg-red-400 hover:bg-red-300 text-stone-200 dark:text-stone-700"
							: "bg-teal-600 hover:bg-teal-500 active:bg-teal-600 text-stone-200",
					)}
				>
					{shouldShowInvalid ? <XIcon size={16} /> : <ArrowUpIcon size={16} />}
				</button>
			</div>
		</motion.form>
	)
}

function AttachmentMenu() {
	return (
		<Menu className="outline-none">
			<MenuItem
				className="flex items-center gap-2 px-2 py-1 rounded-md cursor-default outline-none hover:bg-stone-200 dark:hover:bg-stone-700 focus:bg-stone-200 dark:focus:bg-stone-700"
				onAction={() => {}}
			>
				<ImageIcon size={14} />
				Photos
			</MenuItem>
			<MenuItem
				className="flex items-center gap-2 px-2 py-1 rounded-md cursor-default outline-none hover:bg-stone-200 dark:hover:bg-stone-700 focus:bg-stone-200 dark:focus:bg-stone-700"
				onAction={() => {}}
			>
				<FileIcon size={14} />
				Files
			</MenuItem>
		</Menu>
	)
}
