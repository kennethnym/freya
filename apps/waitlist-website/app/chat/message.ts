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

export const INITLAL_MESSAGES: Message[] = [
	{
		role: "user",
		message: "Who are you?",
	},
	{
		role: "system",
		message: `Hey! I'm **Aelis** — your personal assistant that brings you the right thing, at the right time, in the right place.

Jubilee line down? I've already found you an alternative route. Flying tomorrow? Your boarding pass and gate info are ready before you even check. I learn your routines, anticipate what's next, and surface what matters before you even think to look for it.

I'm not ready yet — [@kennethnym](https://x.com/kennethnym) is still building me. Drop your email below and I'll let you know when I'm available.`,
	},
]

export function waitListJoinedMessage(email: string): SystemMessage {
	return {
		role: "system",
		message: `Thanks for joining the waitlist! I've sent you a confirmation email.
I'll send an email to **${email}** when I'm ready.

Have a good day!`,
	}
}
