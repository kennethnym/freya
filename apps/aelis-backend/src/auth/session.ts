import type { auth } from "./index.ts"

export type AuthUser = typeof auth.$Infer.Session.user
export type AuthSession = typeof auth.$Infer.Session.session
