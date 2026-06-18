# AGENTS.md

## Project

FREYA is an AI-powered personal assistant that aggregates data from various sources into a contextual feed. Monorepo with `packages/` (shared libraries) and `apps/` (applications).

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

## Nix

Use the Nix dev shell for project commands by default.

- Run repo tooling through `nix develop -c`, e.g. `nix develop -c bun test`.
- Use Bun exclusively inside the Nix shell.
- Do not use host `bun`, `node`, `tsc`, or package binaries for project tasks unless explicitly checking host behavior.
- Simple inspection commands like `rg`, `sed`, `ls`, and `git status` may run outside Nix.
- While `flake.nix` is untracked, use `nix develop path:. -c <command>`.
