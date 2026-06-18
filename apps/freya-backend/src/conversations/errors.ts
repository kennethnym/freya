export class ConversationNotFoundError extends Error {
	readonly conversationId: string
	readonly userId: string

	constructor(conversationId: string, userId: string) {
		super(`Conversation "${conversationId}" not found for user "${userId}"`)
		this.name = "ConversationNotFoundError"
		this.conversationId = conversationId
		this.userId = userId
	}
}
