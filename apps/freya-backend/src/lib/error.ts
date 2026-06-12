export class UserNotFoundError extends Error {
	constructor(
		public readonly userId: string,
		message?: string,
	) {
		super(message ? `${message}: user not found: ${userId}` : `User not found: ${userId}`)
	}
}
