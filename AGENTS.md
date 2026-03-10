# AGENTS.md

## Project

AELIS is an AI-powered personal assistant that aggregates data from various sources into a contextual feed. Monorepo with `packages/` (shared libraries) and `apps/` (applications).

## Commands

- Install: `bun install`
- Test: `bun test` (run in the specific package directory)
- Lint: `bun run lint`
- Format: `bun run format`
- Type check: `bun tsc --noEmit`

Use Bun exclusively. Do not use npm or yarn.

## Code Style

- File names: kebab-case (`data-source.ts`)
- Prefer function declarations over arrow functions
- Never use `any` - use `unknown` and narrow types
- Enums: use const objects with corresponding types:
  ```typescript
  const Priority = {
  	Low: "Low",
  	High: "High",
  } as const
  type Priority = (typeof Priority)[keyof typeof Priority]
  ```
- File organization: types first, then primary functions, then helpers

## Before Committing

1. Format: `bun run format`
2. Test the modified package: `cd packages/<package> && bun test`
3. Fix all type errors related to your changes

## Git

- Branch: `feat/<task>`, `fix/<task>`, `ci/<task>`, etc.
- Commits: conventional commit format, title <= 50 chars
- Signing: If `GPG_PRIVATE_KEY_PASSPHRASE` env var is available, use it to sign commits with `git commit -S`
