import type { Dispatch, FormEvent, SetStateAction } from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Save, Trash2, X } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import type { FeedItem } from "@/lib/api"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { executeSourceAction, fetchFeed } from "@/lib/api"

const REMINDER_SOURCE_ID = "freya.reminders"

type ReminderPriority = "low" | "normal" | "high"
type ReminderFrequency = "daily" | "weekly" | "monthly" | "yearly"
type ReminderEditScope = "this-occurrence" | "this-and-future" | "entire-series"

interface ReminderRecurrence {
	frequency: ReminderFrequency
	interval: number
	count?: number
	until?: string
}

interface ReminderFeedData extends Record<string, unknown> {
	reminderId: string
	occurrenceId: string
	title: string
	notes: string | null
	originalDueAt: string
	dueAt: string
	timeZone: string
	recurrence: ReminderRecurrence | null
	priority: ReminderPriority
	completedAt: string | null
}

interface ReminderFormState {
	title: string
	notes: string
	dueAt: string
	priority: ReminderPriority
	scope: ReminderEditScope
	recurs: boolean
	frequency: ReminderFrequency
	interval: string
	count: string
	until: string
}

const emptyForm: ReminderFormState = {
	title: "",
	notes: "",
	dueAt: toLocalInput(new Date()),
	priority: "normal",
	scope: "entire-series",
	recurs: false,
	frequency: "daily",
	interval: "1",
	count: "",
	until: "",
}

export function ReminderCrudPanel() {
	const queryClient = useQueryClient()
	const [form, setForm] = useState<ReminderFormState>(emptyForm)
	const [editing, setEditing] = useState<ReminderFeedData | null>(null)
	const [deleteScopes, setDeleteScopes] = useState<Record<string, ReminderEditScope>>({})

	const {
		data: feed,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: ["feed"],
		queryFn: fetchFeed,
	})

	const reminders = useMemo(
		() => (feed?.items ?? []).filter(isReminderItem).map((item) => item.data),
		[feed],
	)

	const actionMutation = useMutation({
		mutationFn: (input: { actionId: string; params: unknown }) =>
			executeSourceAction(REMINDER_SOURCE_ID, input.actionId, input.params),
	})

	const busy = actionMutation.isPending
	const canConfigureRecurrence = !editing || form.scope !== "this-occurrence"

	async function runAction(actionId: string, params: unknown, success: string): Promise<boolean> {
		try {
			await actionMutation.mutateAsync({ actionId, params })
			await queryClient.invalidateQueries({ queryKey: ["feed"] })
			toast.success(success)
			return true
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err))
			return false
		}
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()

		if (editing) {
			const patch = formToPatch(formFromReminder(editing), form)
			if (Object.keys(patch).length === 0) {
				toast.info("No changes to save")
				return
			}

			const saved = await runAction(
				"update-reminder",
				{
					reminderId: editing.reminderId,
					scope: form.scope,
					occurrenceDueAt: editing.originalDueAt,
					patch,
				},
				"Reminder updated",
			)
			if (saved) resetForm()
			return
		} else {
			const created = await runAction(
				"create-reminder",
				formToCreatePayload(form),
				"Reminder created",
			)
			if (created) resetForm()
		}
	}

	function startEdit(reminder: ReminderFeedData) {
		setEditing(reminder)
		setForm(formFromReminder(reminder))
	}

	function resetForm() {
		setEditing(null)
		setForm({ ...emptyForm, dueAt: toLocalInput(new Date()) })
	}

	function getDeleteScope(reminder: ReminderFeedData): ReminderEditScope {
		return (
			deleteScopes[reminderKey(reminder)] ??
			(reminder.recurrence ? "this-occurrence" : "entire-series")
		)
	}

	function setDeleteScope(reminder: ReminderFeedData, scope: ReminderEditScope) {
		setDeleteScopes((prev) => ({ ...prev, [reminderKey(reminder)]: scope }))
	}

	return (
		<Card className="-mx-4">
			<CardHeader className="pb-4">
				<div className="flex items-center justify-between gap-3">
					<CardTitle className="text-sm">Reminders</CardTitle>
					<Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
						{isFetching ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<RefreshCw className="size-3.5" />
						)}
						Refresh
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-5">
				<form className="grid gap-4" onSubmit={handleSubmit}>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-2 sm:col-span-2">
							<Label htmlFor="reminder-title" className="text-xs font-medium">
								Title
							</Label>
							<Input
								id="reminder-title"
								value={form.title}
								onChange={(event) => setFormField(setForm, "title", event.target.value)}
								disabled={busy}
								required
							/>
						</div>

						<div className="space-y-2 sm:col-span-2">
							<Label htmlFor="reminder-notes" className="text-xs font-medium">
								Notes
							</Label>
							<Input
								id="reminder-notes"
								value={form.notes}
								onChange={(event) => setFormField(setForm, "notes", event.target.value)}
								disabled={busy}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="reminder-due-at" className="text-xs font-medium">
								Due
							</Label>
							<Input
								id="reminder-due-at"
								type="datetime-local"
								value={form.dueAt}
								onChange={(event) => setFormField(setForm, "dueAt", event.target.value)}
								disabled={busy}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="reminder-priority" className="text-xs font-medium">
								Priority
							</Label>
							<Select
								value={form.priority}
								onValueChange={(value) =>
									setFormField(setForm, "priority", value as ReminderPriority)
								}
								disabled={busy}
							>
								<SelectTrigger id="reminder-priority">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="low">Low</SelectItem>
									<SelectItem value="normal">Normal</SelectItem>
									<SelectItem value="high">High</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{editing?.recurrence && (
							<div className="space-y-2 sm:col-span-2">
								<Label htmlFor="reminder-edit-scope" className="text-xs font-medium">
									Edit scope
								</Label>
								<Select
									value={form.scope}
									onValueChange={(value) =>
										setFormField(setForm, "scope", value as ReminderEditScope)
									}
									disabled={busy}
								>
									<SelectTrigger id="reminder-edit-scope">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="this-occurrence">This occurrence</SelectItem>
										<SelectItem value="this-and-future">This and future</SelectItem>
										<SelectItem value="entire-series">Entire series</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</div>

					{canConfigureRecurrence && (
						<div className="grid gap-3 rounded-md border p-3 sm:grid-cols-4">
							<div className="flex items-center justify-between gap-3 sm:col-span-4">
								<Label htmlFor="reminder-recurs" className="text-xs font-medium">
									Recurring
								</Label>
								<Switch
									id="reminder-recurs"
									checked={form.recurs}
									onCheckedChange={(checked) => setFormField(setForm, "recurs", checked)}
									disabled={busy}
								/>
							</div>

							{form.recurs && (
								<>
									<div className="space-y-2 sm:col-span-2">
										<Label htmlFor="reminder-frequency" className="text-xs font-medium">
											Frequency
										</Label>
										<Select
											value={form.frequency}
											onValueChange={(value) =>
												setFormField(setForm, "frequency", value as ReminderFrequency)
											}
											disabled={busy}
										>
											<SelectTrigger id="reminder-frequency">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="daily">Daily</SelectItem>
												<SelectItem value="weekly">Weekly</SelectItem>
												<SelectItem value="monthly">Monthly</SelectItem>
												<SelectItem value="yearly">Yearly</SelectItem>
											</SelectContent>
										</Select>
									</div>

									<div className="space-y-2">
										<Label htmlFor="reminder-interval" className="text-xs font-medium">
											Interval
										</Label>
										<Input
											id="reminder-interval"
											type="number"
											min={1}
											value={form.interval}
											onChange={(event) => setFormField(setForm, "interval", event.target.value)}
											disabled={busy}
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="reminder-count" className="text-xs font-medium">
											Count
										</Label>
										<Input
											id="reminder-count"
											type="number"
											min={1}
											value={form.count}
											onChange={(event) => setFormField(setForm, "count", event.target.value)}
											disabled={busy}
										/>
									</div>

									<div className="space-y-2 sm:col-span-4">
										<Label htmlFor="reminder-until" className="text-xs font-medium">
											Until
										</Label>
										<Input
											id="reminder-until"
											type="datetime-local"
											value={form.until}
											onChange={(event) => setFormField(setForm, "until", event.target.value)}
											disabled={busy}
										/>
									</div>
								</>
							)}
						</div>
					)}

					<div className="flex justify-end gap-2">
						{editing && (
							<Button type="button" variant="outline" onClick={resetForm} disabled={busy}>
								<X className="size-3.5" />
								Cancel
							</Button>
						)}
						<Button type="submit" disabled={busy || !form.title || !form.dueAt}>
							{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
							{editing ? "Update" : "Create"}
						</Button>
					</div>
				</form>

				<div className="space-y-2">
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>
							{reminders.length} {reminders.length === 1 ? "occurrence" : "occurrences"}
						</span>
						{!editing && (
							<Button size="sm" variant="ghost" onClick={resetForm} disabled={busy}>
								<Plus className="size-3.5" />
								New
							</Button>
						)}
					</div>

					{reminders.length === 0 && (
						<div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
							No reminders in the current feed.
						</div>
					)}

					{reminders.map((reminder) => {
						const deleteScope = getDeleteScope(reminder)
						return (
							<ReminderRow
								key={reminderKey(reminder)}
								reminder={reminder}
								busy={busy}
								deleteScope={deleteScope}
								onDeleteScopeChange={(scope) => setDeleteScope(reminder, scope)}
								onEdit={() => startEdit(reminder)}
								onComplete={() =>
									runAction(
										reminder.completedAt ? "uncomplete-reminder" : "complete-reminder",
										{
											reminderId: reminder.reminderId,
											occurrenceDueAt: reminder.originalDueAt,
										},
										reminder.completedAt ? "Reminder reopened" : "Reminder completed",
									)
								}
								onDelete={() => {
									if (
										!confirm(
											`Delete ${formatScope(deleteScope).toLowerCase()} for "${reminder.title}"?`,
										)
									) {
										return
									}
									void runAction(
										"delete-reminder",
										{
											reminderId: reminder.reminderId,
											scope: deleteScope,
											occurrenceDueAt: reminder.originalDueAt,
										},
										"Reminder deleted",
									).then((deleted) => {
										if (deleted && editing?.reminderId === reminder.reminderId) resetForm()
									})
								}}
							/>
						)
					})}
				</div>
			</CardContent>
		</Card>
	)
}

function ReminderRow({
	reminder,
	busy,
	deleteScope,
	onDeleteScopeChange,
	onEdit,
	onComplete,
	onDelete,
}: {
	reminder: ReminderFeedData
	busy: boolean
	deleteScope: ReminderEditScope
	onDeleteScopeChange: (scope: ReminderEditScope) => void
	onEdit: () => void
	onComplete: () => void
	onDelete: () => void
}) {
	return (
		<div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
			<div className="min-w-0 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="truncate text-sm font-medium">{reminder.title}</span>
					<Badge variant={reminder.completedAt ? "secondary" : "outline"} className="text-xs">
						{reminder.completedAt ? "Done" : reminder.priority}
					</Badge>
					{reminder.recurrence && (
						<Badge variant="secondary" className="text-xs">
							{formatRecurrence(reminder.recurrence)}
						</Badge>
					)}
				</div>
				<div className="text-xs text-muted-foreground">{formatDate(reminder.dueAt)}</div>
				{reminder.notes && <div className="text-xs text-muted-foreground">{reminder.notes}</div>}
			</div>
			<div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
				{reminder.recurrence && (
					<Select
						value={deleteScope}
						onValueChange={(value) => onDeleteScopeChange(value as ReminderEditScope)}
						disabled={busy}
					>
						<SelectTrigger className="h-8 w-[86px] text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="this-occurrence">This</SelectItem>
							<SelectItem value="this-and-future">Future</SelectItem>
							<SelectItem value="entire-series">All</SelectItem>
						</SelectContent>
					</Select>
				)}
				<Button size="sm" variant="ghost" onClick={onComplete} disabled={busy}>
					{reminder.completedAt ? (
						<RotateCcw className="size-3.5" />
					) : (
						<Check className="size-3.5" />
					)}
				</Button>
				<Button size="sm" variant="ghost" onClick={onEdit} disabled={busy}>
					<Pencil className="size-3.5" />
				</Button>
				<Button size="sm" variant="ghost" onClick={onDelete} disabled={busy}>
					<Trash2 className="size-3.5 text-destructive" />
				</Button>
			</div>
		</div>
	)
}

function formToCreatePayload(form: ReminderFormState): Record<string, unknown> {
	return {
		title: form.title.trim(),
		notes: form.notes.trim() || null,
		dueAt: toIsoString(form.dueAt),
		timeZone: localTimeZone(),
		priority: form.priority,
		recurrence: recurrenceValueFromForm(form),
	}
}

function formToPatch(initial: ReminderFormState, form: ReminderFormState): Record<string, unknown> {
	const patch: Record<string, unknown> = {}
	const title = form.title.trim()
	const notes = form.notes.trim() || null
	const initialNotes = initial.notes.trim() || null

	if (title !== initial.title.trim()) patch.title = title
	if (notes !== initialNotes) patch.notes = notes
	if (form.dueAt !== initial.dueAt) {
		patch.dueAt = toIsoString(form.dueAt)
		patch.timeZone = localTimeZone()
	}
	if (form.priority !== initial.priority) patch.priority = form.priority
	if (form.scope !== "this-occurrence" && recurrenceChanged(initial, form)) {
		patch.recurrence = recurrenceValueFromForm(form)
	}

	return patch
}

function recurrenceValueFromForm(form: ReminderFormState): ReminderRecurrence | null {
	return form.recurs ? recurrenceFromForm(form) : null
}

function recurrenceFromForm(form: ReminderFormState): ReminderRecurrence {
	const recurrence: ReminderRecurrence = {
		frequency: form.frequency,
		interval: Math.max(1, Number(form.interval) || 1),
	}

	const count = Number(form.count)
	if (Number.isInteger(count) && count > 0) recurrence.count = count
	if (form.until) recurrence.until = toIsoString(form.until)

	return recurrence
}

function formFromReminder(reminder: ReminderFeedData): ReminderFormState {
	return {
		title: reminder.title,
		notes: reminder.notes ?? "",
		dueAt: toLocalInput(new Date(reminder.dueAt)),
		priority: reminder.priority,
		scope: reminder.recurrence ? "this-occurrence" : "entire-series",
		recurs: reminder.recurrence !== null,
		frequency: reminder.recurrence?.frequency ?? "daily",
		interval: String(reminder.recurrence?.interval ?? 1),
		count: reminder.recurrence?.count ? String(reminder.recurrence.count) : "",
		until: reminder.recurrence?.until ? toLocalInput(new Date(reminder.recurrence.until)) : "",
	}
}

function setFormField<TKey extends keyof ReminderFormState>(
	setForm: Dispatch<SetStateAction<ReminderFormState>>,
	key: TKey,
	value: ReminderFormState[TKey],
) {
	setForm((prev) => ({ ...prev, [key]: value }))
}

function recurrenceChanged(initial: ReminderFormState, form: ReminderFormState): boolean {
	return (
		JSON.stringify(recurrenceValueFromForm(initial)) !==
		JSON.stringify(recurrenceValueFromForm(form))
	)
}

function reminderKey(reminder: ReminderFeedData): string {
	return `${reminder.reminderId}:${reminder.occurrenceId}`
}

function isReminderItem(item: FeedItem): item is FeedItem & { data: ReminderFeedData } {
	return (
		item.sourceId === REMINDER_SOURCE_ID &&
		typeof item.data.reminderId === "string" &&
		typeof item.data.occurrenceId === "string" &&
		typeof item.data.title === "string" &&
		typeof item.data.originalDueAt === "string" &&
		typeof item.data.dueAt === "string"
	)
}

function toLocalInput(date: Date): string {
	const offsetMs = date.getTimezoneOffset() * 60 * 1000
	return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function toIsoString(value: string): string {
	return new Date(value).toISOString()
}

function localTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function formatDate(value: string): string {
	return new Date(value).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})
}

function formatRecurrence(recurrence: ReminderRecurrence): string {
	return recurrence.interval === 1
		? recurrence.frequency
		: `${recurrence.frequency} / ${recurrence.interval}`
}

function formatScope(scope: ReminderEditScope): string {
	switch (scope) {
		case "this-occurrence":
			return "this occurrence"
		case "this-and-future":
			return "this and future"
		case "entire-series":
			return "entire series"
	}
}
