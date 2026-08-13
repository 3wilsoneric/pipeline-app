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
- Local JSON adapters are development-only and single-instance. Production
  referral, assessment, workflow, resident-link, document, and collaboration
  state uses Azure Database for PostgreSQL through server-only adapters.
- Original packet bytes and generated derivatives use private Azure Blob
  containers. Browser code receives only short-lived, resource-scoped access.
- User authentication uses Microsoft Entra. Governed clinical context comes
  from Alamo through the narrow server-only clinical adapter; Pipeline never
  calls ElderMark directly.
- Do not add a second browser-side database client or expose storage,
  PostgreSQL, Databricks, Alamo service, or extraction credentials through
  `NEXT_PUBLIC_*` variables.
