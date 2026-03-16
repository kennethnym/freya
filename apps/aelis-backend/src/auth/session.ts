import type { Auth } from "./index.ts"

export type AuthUser = Auth["$Infer"]["Session"]["user"]
export type AuthSession = Auth["$Infer"]["Session"]["session"]
