export interface UserMessage {
	role: "user"
	message: string
	bubbleLayoutId?: string
}

export interface SystemMessage {
	role: "system"
	message: string
}

export type Message = UserMessage | SystemMessage

function timeOfDay() {
	const now = new Date()
	const hours = now.getHours()
	if (hours >= 6 && hours <= 9) {
		return "evening"
	} else if (hours > 9 || hours <= 4) {
		return "night"
	}
	return "day"
}

export const INITLAL_MESSAGES: Message[] = [
	{
		role: "user",
		message: "Who are you?",
	},
	{
		role: "system",
		message: `Hey! I'm **Aelis** — your personal assistant that brings you the right thing, at the right time, in the right place.

- Jubilee line down? I've already found you an alternative route.
- Dinner reservation at 8? I'll have the restaurant, directions, and the menu ready before you head out.

I learn your routines, anticipate what's next, and surface what matters before you even think to look for it.

I'm not ready yet — [@kennethnym](https://x.com/kennethnym) is still building me. **Drop your email below** and I'll let you know when I'm available.`,
	},
]

export function waitListJoinedMessage(email: string): SystemMessage {
	return {
		role: "system",
		message: `Thanks for joining the waitlist! I've sent you a confirmation email.
I'll send an email to **${email}** when I'm ready.

Have a good ${timeOfDay()}!`,
	}
}

export function duplicateEmailMessage(): SystemMessage {
	return {
		role: "system",
		message: `I appreciate your excitement! You are already on the waitlist. When I am ready, I will reach out again. Have a good ${timeOfDay()} :)`,
	}
}
