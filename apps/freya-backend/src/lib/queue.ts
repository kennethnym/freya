interface Item<T> {
	value: T
	next: Item<T> | null
}

export class Queue<T> {
	private front: Item<T> | null = null
	private back: Item<T> | null = null
	private waiters: Array<(value: T) => void> = []

	enqueue(value: T): void {
		const waiter = this.waiters.shift()
		if (waiter) {
			waiter(value)
			return
		}

		const newItem: Item<T> = { value, next: null }
		if (this.back) {
			this.back.next = newItem
		} else {
			this.front = newItem
		}
		this.back = newItem
	}

	dequeue(): T | null {
		if (!this.front) return null
		const value = this.front.value
		this.front = this.front.next
		if (!this.front) this.back = null
		return value
	}

	next(signal?: AbortSignal): Promise<T | null> {
		const value = this.dequeue()
		if (value !== null) return Promise.resolve(value)

		return new Promise((resolve) => {
			if (signal) {
				if (signal.aborted) {
					resolve(null)
				} else {
					let _resolve: (v: T) => void

					const onAbort = () => {
						this.waiters = this.waiters.filter((w) => w !== _resolve)
						resolve(null)
					}

					signal.addEventListener(
						"abort",
						onAbort,
						{ once: true },
					)

					_resolve = (v: T) => {
						signal.removeEventListener("abort", onAbort)
						resolve(v)
					}

					this.waiters.push(_resolve)
				}
			} else {
				this.waiters.push(resolve)
			}
		})
	}
}
