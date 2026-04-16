## System Overview
- Next.js 16 App Router app
- Shared Pipeline shell wraps app routes
- Mock-data-first UI with Supabase client stub

## Core Modules
- `app/layout.tsx`
- `app/(pipeline)/layout.tsx`
- `components/pipeline/*`
- `lib/supabase/client.ts`
- `docs/*` and `wiki/INDEX.md`

## Data Flow
- Header search state -> shell context -> route page -> page component
- Sidebar -> new intake modal -> local form state
- Page components -> local mock state -> rendered workflow UI
- Supabase usage: TODO

## Agent Loop
- Architect: sync `docs/ARCHITECTURE.md`, `docs/FILE_MAP.md`
- Planner: sync `docs/CURRENT_TASK.md`, `docs/BUILD_BACKLOG.md`
- Builder: implement scoped code changes
- Critic: run `npm run lint` and check doc sync
- Doc Sync: update docs after structural changes
