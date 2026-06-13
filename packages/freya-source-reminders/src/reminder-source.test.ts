import { Context, TimeRelevance } from "@freya/core"
import { describe, expect, mock, test } from "bun:test"

import type {
	CreateReminderInput,
	Reminder,
	ReminderListParams,
	ReminderOccurrenceOverride,
	ReminderOccurrenceOverrideInput,
	ReminderOccurrenceOverrideListParams,
	ReminderPatch,
	ReminderStorage,
} from "./types.ts"

import { ReminderSource } from "./reminder-source.ts"
import {
	ReminderAction,
	ReminderEditScope,
	ReminderPriority,
	ReminderRecurrenceFrequency,
	ReminderUpdateResultType,
	ReminderWeekday,
} from "./types.ts"

class InMemoryReminderStorage implements ReminderStorage {
	readonly reminders = new Map<string, Reminder>()
	readonly overrides = new Map<string, ReminderOccurrenceOverride>()
	private nextId = 1
	private readonly listeners = new Set<() => void>()

	constructor(reminders: Reminder[] = []) {
		for (const reminder of reminders) {
			this.reminders.set(reminder.id, reminder)
		}
	}

	async listReminders(_params: ReminderListParams): Promise<Reminder[]> {
		return Array.from(this.reminders.values())
	}

	async getReminder(id: string): Promise<Reminder | null> {
		return this.reminders.get(id) ?? null
	}

	async createReminder(input: CreateReminderInput): Promise<Reminder> {
		const now = new Date("2026-06-01T00:00:00Z")
		const reminder: Reminder = {
			id: `reminder-${this.nextId++}`,
			title: input.title,
			notes: input.notes ?? null,
			dueAt: input.dueAt,
			timeZone: input.timeZone ?? "UTC",
			recurrence: input.recurrence ?? null,
			priority: input.priority ?? ReminderPriority.Normal,
			createdAt: now,
			updatedAt: now,
		}

		this.reminders.set(reminder.id, reminder)
		this.notify()
		return reminder
	}

	async updateReminder(id: string, patch: ReminderPatch): Promise<Reminder> {
		const existing = this.reminders.get(id)
		if (!existing) {
			throw new Error(`Reminder not found: ${id}`)
		}

		const updated: Reminder = {
			...existing,
			updatedAt: new Date("2026-06-01T00:01:00Z"),
		}
		if (hasOwn(patch, "title")) updated.title = patch.title
		if (hasOwn(patch, "notes")) updated.notes = patch.notes ?? null
		if (hasOwn(patch, "dueAt")) updated.dueAt = patch.dueAt
		if (hasOwn(patch, "timeZone")) updated.timeZone = patch.timeZone
		if (hasOwn(patch, "recurrence")) updated.recurrence = patch.recurrence ?? null
		if (hasOwn(patch, "priority")) updated.priority = patch.priority

		this.reminders.set(id, updated)
		this.notify()
		return updated
	}

	async deleteReminder(id: string): Promise<void> {
		this.reminders.delete(id)
		this.notify()
	}

	async listOccurrenceOverrides(
		params: ReminderOccurrenceOverrideListParams,
	): Promise<ReminderOccurrenceOverride[]> {
		const reminderIds = new Set(params.reminderIds)
		return Array.from(this.overrides.values()).filter(function matches(override) {
			if (!reminderIds.has(override.reminderId)) return false
			const dueAt = override.patch?.dueAt ?? override.originalDueAt
			return (
				isWithin(override.originalDueAt, params.from, params.to) ||
				isWithin(dueAt, params.from, params.to)
			)
		})
	}

	async getOccurrenceOverride(
		reminderId: string,
		occurrenceId: string,
	): Promise<ReminderOccurrenceOverride | null> {
		return this.overrides.get(overrideKey(reminderId, occurrenceId)) ?? null
	}

	async upsertOccurrenceOverride(
		input: ReminderOccurrenceOverrideInput,
	): Promise<ReminderOccurrenceOverride> {
		const existing = this.overrides.get(overrideKey(input.reminderId, input.occurrenceId))
		const now = new Date("2026-06-01T00:02:00Z")
		const override: ReminderOccurrenceOverride = {
			...existing,
			...input,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		}

		this.overrides.set(overrideKey(input.reminderId, input.occurrenceId), override)
		this.notify()
		return override
	}

	async deleteOccurrenceOverride(reminderId: string, occurrenceId: string): Promise<void> {
		this.overrides.delete(overrideKey(reminderId, occurrenceId))
		this.notify()
	}

	subscribe(callback: () => void): () => void {
		this.listeners.add(callback)
		return () => {
			this.listeners.delete(callback)
		}
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener()
		}
	}
}

function reminder(overrides: Partial<Reminder> = {}): Reminder {
	const now = new Date("2026-06-01T00:00:00Z")
	return {
		id: "r1",
		title: "Take vitamins",
		notes: null,
		dueAt: new Date("2026-06-12T09:00:00Z"),
		timeZone: "UTC",
		recurrence: null,
		priority: ReminderPriority.Normal,
		createdAt: now,
		updatedAt: now,
		...overrides,
	}
}

function context(time: string): Context {
	return new Context(new Date(time))
}

function overrideKey(reminderId: string, occurrenceId: string): string {
	return `${reminderId}:${occurrenceId}`
}

function isWithin(date: Date, from: Date, to: Date): boolean {
	return date >= from && date <= to
}

function hasOwn<TObject extends object, TKey extends keyof TObject>(
	object: TObject,
	key: TKey,
): object is TObject & Required<Pick<TObject, TKey>> {
	return Object.prototype.hasOwnProperty.call(object, key)
}

describe("ReminderSource", () => {
	describe("FeedSource interface", () => {
		test("has correct id and actions", async () => {
			const source = new ReminderSource({ storage: new InMemoryReminderStorage() })

			expect(source.id).toBe("freya.reminders")
			const actions = await source.listActions()

			expect(actions[ReminderAction.CreateReminder]?.id).toBe(ReminderAction.CreateReminder)
			expect(actions[ReminderAction.UpdateReminder]?.id).toBe(ReminderAction.UpdateReminder)
			expect(actions[ReminderAction.DeleteReminder]?.id).toBe(ReminderAction.DeleteReminder)
			expect(actions[ReminderAction.CompleteReminder]?.id).toBe(ReminderAction.CompleteReminder)
			expect(actions[ReminderAction.UncompleteReminder]?.id).toBe(ReminderAction.UncompleteReminder)
		})

		test("fetchContext returns null", async () => {
			const source = new ReminderSource({ storage: new InMemoryReminderStorage() })

			await expect(source.fetchContext(context("2026-06-12T09:00:00Z"))).resolves.toBeNull()
		})

		test("notifies item listeners after source actions", async () => {
			const storage = new InMemoryReminderStorage()
			const source = new ReminderSource({ storage })
			const listener = mock()
			source.onItemsUpdate(listener)

			await source.createReminder({
				title: "Buy milk",
				dueAt: new Date("2026-06-12T18:00:00Z"),
			})

			expect(listener).toHaveBeenCalled()
		})
	})

	describe("fetchItems", () => {
		test("returns a one-off reminder occurrence", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					id: "buy-milk",
					title: "Buy milk",
					dueAt: new Date("2026-06-12T18:00:00Z"),
				}),
			])
			const source = new ReminderSource({ storage, lookBackMs: 0 })

			const items = await source.fetchItems(context("2026-06-12T12:00:00Z"))

			expect(items).toHaveLength(1)
			expect(items[0]!.data.title).toBe("Buy milk")
			expect(items[0]!.data.reminderId).toBe("buy-milk")
			expect(items[0]!.signals?.timeRelevance).toBe(TimeRelevance.Upcoming)
		})

		test("expands daily recurrence inside the feed window", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-10T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Daily,
						interval: 1,
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 48 * 60 * 60 * 1000,
			})

			const items = await source.fetchItems(context("2026-06-12T00:00:00Z"))

			expect(
				items.map(function dueAt(item) {
					return item.data.dueAt.toISOString()
				}),
			).toEqual(["2026-06-12T09:00:00.000Z", "2026-06-13T09:00:00.000Z"])
		})

		test("expands weekly recurrence on selected weekdays", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-08T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Weekly,
						interval: 1,
						weekdays: [ReminderWeekday.Monday, ReminderWeekday.Wednesday, ReminderWeekday.Friday],
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 6 * 24 * 60 * 60 * 1000,
			})

			const items = await source.fetchItems(context("2026-06-08T00:00:00Z"))

			expect(
				items.map(function dueAt(item) {
					return item.data.dueAt.toISOString()
				}),
			).toEqual([
				"2026-06-08T09:00:00.000Z",
				"2026-06-10T09:00:00.000Z",
				"2026-06-12T09:00:00.000Z",
			])
		})

		test("deduplicates weekly weekdays before applying recurrence count", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-08T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Weekly,
						interval: 1,
						weekdays: [ReminderWeekday.Monday, ReminderWeekday.Monday, ReminderWeekday.Wednesday],
						count: 3,
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 14 * 24 * 60 * 60 * 1000,
			})

			const items = await source.fetchItems(context("2026-06-08T00:00:00Z"))

			expect(
				items.map(function dueAt(item) {
					return item.data.dueAt.toISOString()
				}),
			).toEqual([
				"2026-06-08T09:00:00.000Z",
				"2026-06-10T09:00:00.000Z",
				"2026-06-15T09:00:00.000Z",
			])
		})

		test("omits completed occurrences by default", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-12T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Daily,
						interval: 1,
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 48 * 60 * 60 * 1000,
			})

			await source.completeReminder({
				reminderId: "r1",
				occurrenceDueAt: new Date("2026-06-12T09:00:00Z"),
				completedAt: new Date("2026-06-12T09:05:00Z"),
			})

			const items = await source.fetchItems(context("2026-06-12T00:00:00Z"))

			expect(
				items.map(function dueAt(item) {
					return item.data.dueAt.toISOString()
				}),
			).toEqual(["2026-06-13T09:00:00.000Z"])
		})
	})

	describe("updates", () => {
		test("updates one recurring occurrence through an override", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-12T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Daily,
						interval: 1,
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 48 * 60 * 60 * 1000,
			})

			const result = await source.updateReminder({
				reminderId: "r1",
				scope: ReminderEditScope.ThisOccurrence,
				occurrenceDueAt: new Date("2026-06-12T09:00:00Z"),
				patch: {
					title: "Take vitamins with breakfast",
					dueAt: new Date("2026-06-12T10:00:00Z"),
				},
			})

			expect(result.type).toBe(ReminderUpdateResultType.UpdatedOccurrence)
			expect(storage.reminders.get("r1")?.title).toBe("Take vitamins")

			const items = await source.fetchItems(context("2026-06-12T00:00:00Z"))
			expect(items[0]!.data.title).toBe("Take vitamins with breakfast")
			expect(items[0]!.data.dueAt.toISOString()).toBe("2026-06-12T10:00:00.000Z")
			expect(items[1]!.data.title).toBe("Take vitamins")
		})

		test("updates an entire recurring reminder", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-12T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Daily,
						interval: 1,
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 48 * 60 * 60 * 1000,
			})

			await source.updateReminder({
				reminderId: "r1",
				scope: ReminderEditScope.EntireSeries,
				patch: { title: "Take medication" },
			})

			const items = await source.fetchItems(context("2026-06-12T00:00:00Z"))
			expect(
				items.map(function title(item) {
					return item.data.title
				}),
			).toEqual(["Take medication", "Take medication"])
		})

		test("splits a recurring reminder for this-and-future updates", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-10T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Daily,
						interval: 1,
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 48 * 60 * 60 * 1000,
			})

			const result = await source.updateReminder({
				reminderId: "r1",
				scope: ReminderEditScope.ThisAndFuture,
				occurrenceDueAt: new Date("2026-06-12T09:00:00Z"),
				patch: {
					title: "Take vitamins later",
					dueAt: new Date("2026-06-12T10:00:00Z"),
				},
			})

			expect(result.type).toBe(ReminderUpdateResultType.SplitReminder)
			expect(storage.reminders.size).toBe(2)
			expect(storage.reminders.get("r1")?.recurrence?.count).toBe(2)

			const items = await source.fetchItems(context("2026-06-12T00:00:00Z"))
			expect(
				items.map(function itemLabel(item) {
					return `${item.data.title}:${item.data.dueAt.toISOString()}`
				}),
			).toEqual([
				"Take vitamins later:2026-06-12T10:00:00.000Z",
				"Take vitamins later:2026-06-13T10:00:00.000Z",
			])
		})

		test("updates weekly weekdays when a this-and-future split moves weekday", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-08T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Weekly,
						interval: 1,
						weekdays: [ReminderWeekday.Monday],
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 14 * 24 * 60 * 60 * 1000,
			})

			const result = await source.updateReminder({
				reminderId: "r1",
				scope: ReminderEditScope.ThisAndFuture,
				occurrenceDueAt: new Date("2026-06-15T09:00:00Z"),
				patch: {
					dueAt: new Date("2026-06-16T09:00:00Z"),
				},
			})

			expect(result.type).toBe(ReminderUpdateResultType.SplitReminder)
			expect(
				result.type === ReminderUpdateResultType.SplitReminder
					? result.newReminder.recurrence?.weekdays
					: null,
			).toEqual([ReminderWeekday.Tuesday])

			const items = await source.fetchItems(context("2026-06-15T00:00:00Z"))
			expect(
				items.map(function dueAt(item) {
					return item.data.dueAt.toISOString()
				}),
			).toEqual(["2026-06-16T09:00:00.000Z", "2026-06-23T09:00:00.000Z"])
		})

		test("collapses single-occurrence updates on one-off reminders to the reminder", async () => {
			const storage = new InMemoryReminderStorage([reminder()])
			const source = new ReminderSource({ storage, lookBackMs: 0 })

			await source.updateReminder({
				reminderId: "r1",
				scope: ReminderEditScope.ThisOccurrence,
				occurrenceDueAt: new Date("2026-06-12T09:00:00Z"),
				patch: { title: "Take supplements" },
			})

			expect(storage.reminders.get("r1")?.title).toBe("Take supplements")
			expect(storage.overrides.size).toBe(0)
		})

		test("rejects one-off scoped updates with a mismatched occurrence", async () => {
			const storage = new InMemoryReminderStorage([reminder()])
			const source = new ReminderSource({ storage, lookBackMs: 0 })
			const staleDueAt = new Date("2026-06-13T09:00:00Z")

			for (const scope of [ReminderEditScope.ThisOccurrence, ReminderEditScope.ThisAndFuture]) {
				await expect(
					source.updateReminder({
						reminderId: "r1",
						scope,
						occurrenceDueAt: staleDueAt,
						patch: { title: "Should not apply" },
					}),
				).rejects.toThrow("occurrenceDueAt does not match this reminder")
			}

			expect(storage.reminders.get("r1")?.title).toBe("Take vitamins")
			expect(storage.overrides.size).toBe(0)
		})
	})

	describe("deletes", () => {
		test("collapses single-occurrence deletes on one-off reminders to the reminder", async () => {
			const storage = new InMemoryReminderStorage([reminder()])
			const source = new ReminderSource({ storage, lookBackMs: 0 })

			await source.deleteReminder({
				reminderId: "r1",
				scope: ReminderEditScope.ThisOccurrence,
				occurrenceDueAt: new Date("2026-06-12T09:00:00Z"),
			})

			expect(storage.reminders.has("r1")).toBe(false)
			expect(storage.overrides.size).toBe(0)
		})

		test("rejects one-off scoped deletes with a mismatched occurrence", async () => {
			const storage = new InMemoryReminderStorage([reminder()])
			const source = new ReminderSource({ storage, lookBackMs: 0 })
			const staleDueAt = new Date("2026-06-13T09:00:00Z")

			for (const scope of [ReminderEditScope.ThisOccurrence, ReminderEditScope.ThisAndFuture]) {
				await expect(
					source.deleteReminder({
						reminderId: "r1",
						scope,
						occurrenceDueAt: staleDueAt,
					}),
				).rejects.toThrow("occurrenceDueAt does not match this reminder")
			}

			expect(storage.reminders.has("r1")).toBe(true)
			expect(storage.overrides.size).toBe(0)
		})

		test("deletes one recurring occurrence through an override", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-12T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Daily,
						interval: 1,
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 48 * 60 * 60 * 1000,
			})

			await source.deleteReminder({
				reminderId: "r1",
				scope: ReminderEditScope.ThisOccurrence,
				occurrenceDueAt: new Date("2026-06-12T09:00:00Z"),
			})

			const items = await source.fetchItems(context("2026-06-12T00:00:00Z"))
			expect(
				items.map(function dueAt(item) {
					return item.data.dueAt.toISOString()
				}),
			).toEqual(["2026-06-13T09:00:00.000Z"])
		})

		test("deduplicates weekly weekdays before ending this and future", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-08T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Weekly,
						interval: 1,
						weekdays: [ReminderWeekday.Monday, ReminderWeekday.Monday, ReminderWeekday.Wednesday],
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 14 * 24 * 60 * 60 * 1000,
			})

			await source.deleteReminder({
				reminderId: "r1",
				scope: ReminderEditScope.ThisAndFuture,
				occurrenceDueAt: new Date("2026-06-10T09:00:00Z"),
			})

			expect(storage.reminders.get("r1")?.recurrence?.count).toBe(1)

			const items = await source.fetchItems(context("2026-06-08T00:00:00Z"))
			expect(
				items.map(function dueAt(item) {
					return item.data.dueAt.toISOString()
				}),
			).toEqual(["2026-06-08T09:00:00.000Z"])
		})

		test("ignores stale future overrides after deleting this and future", async () => {
			const storage = new InMemoryReminderStorage([
				reminder({
					dueAt: new Date("2026-06-10T09:00:00Z"),
					recurrence: {
						frequency: ReminderRecurrenceFrequency.Daily,
						interval: 1,
					},
				}),
			])
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 48 * 60 * 60 * 1000,
			})

			await source.updateReminder({
				reminderId: "r1",
				scope: ReminderEditScope.ThisOccurrence,
				occurrenceDueAt: new Date("2026-06-12T09:00:00Z"),
				patch: {
					title: "Take vitamins later",
					dueAt: new Date("2026-06-12T10:00:00Z"),
				},
			})
			expect(storage.overrides.size).toBe(1)

			await source.deleteReminder({
				reminderId: "r1",
				scope: ReminderEditScope.ThisAndFuture,
				occurrenceDueAt: new Date("2026-06-12T09:00:00Z"),
			})

			const items = await source.fetchItems(context("2026-06-12T00:00:00Z"))

			expect(items).toEqual([])
		})
	})

	describe("actions", () => {
		test("executeAction creates reminders from ISO date input", async () => {
			const storage = new InMemoryReminderStorage()
			const source = new ReminderSource({
				storage,
				lookBackMs: 0,
				lookAheadMs: 48 * 60 * 60 * 1000,
			})

			const created = await source.executeAction(ReminderAction.CreateReminder, {
				title: "Review notes",
				dueAt: "2026-06-12T15:00:00Z",
				recurrence: {
					frequency: "daily",
					interval: 1,
					count: 2,
				},
			})

			expect((created as Reminder).id).toBe("reminder-1")
			const items = await source.fetchItems(context("2026-06-12T12:00:00Z"))
			expect(items).toHaveLength(2)
		})

		test("executeAction rejects unknown actions", async () => {
			const source = new ReminderSource({ storage: new InMemoryReminderStorage() })

			await expect(source.executeAction("missing", {})).rejects.toThrow("Unknown action")
		})
	})
})
