## Coding Style Rules
- TypeScript strict mode
- App Router structure under `app/`
- Path alias `@/*`
- Tailwind v4 via `app/globals.css`

## Safety Rules
- Do not rewrite working logic for doc-only tasks
- Prefer minimal scoped edits
- Keep docs aligned with code, not intent only
- Validate with `npm run lint` when code changes

## Repo-Specific Constraints
- Next 16 rule: read local Next docs before framework changes
- `reactCompiler: true` in `next.config.ts`
- Current data layer is mostly local mock state
- Supabase server/auth setup: unknown
