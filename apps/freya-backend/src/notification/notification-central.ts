import type { AgentEvent } from "@freya/agent-protocol"

export interface AgentNotification {
	kind: "agent"
	payload: AgentEvent
}

export type NotificationPayload = AgentNotification
export type NotificationListener = (notification: NotificationPayload) => Promise<void>

export class NotificationCentral {
	private listeners: Map<string, Set<NotificationListener>> = new Map()

	registerListenerForUser(userId: string, listener: NotificationListener): () => void {
		let listeners = this.listeners.get(userId)
		if (!listeners) {
			listeners = new Set()
			this.listeners.set(userId, listeners)
		}

		listeners.add(listener)
		return () => {
			listeners.delete(listener)
			if (listeners.size === 0) {
				this.listeners.delete(userId)
			}
		}
	}

	async notifyUser(userId: string, notification: NotificationPayload): Promise<void> {
		const listeners = this.listeners.get(userId)
		if (!listeners) return

		await Promise.allSettled(Array.from(listeners).map((listener) => listener(notification)))
	}
}
