# Ally organizational reader — local candidate, November 24

The owner authorized organization-wide reading for approved signed-in Ally
executives. GET `/api/integrations/platform/ally` reads Pipeline through its
existing local/PostgreSQL owners. It does not change assessment workflows,
source records, ordinary browser permissions, email or admission rules.

Platform authenticates the executive and checks its current organizational source
grant before calling. Pipeline independently requires a dedicated
`PIPELINE_ALLY_SOURCE_SECRET`, exact `PIPELINE_ALLY_SOURCE_TENANT_ID`, and the
represented `x-ally-subject` in `PIPELINE_ALLY_SOURCE_SUBJECT_IDS` (comma-separated
Entra object IDs). The request must also carry `x-ally-tenant`. Summary, client
briefing and worker credentials cannot authenticate this reader. Configuration
is checked again before returning data. The existing Platform source audit binds
the executive, run, query and returned revision; Pipeline records the canonical
route and request ID without logging query contents.

The `input` query parameter is a JSON object. `view=catalog` describes the named
reads and limitations. `directory` searches active, historical and archived
workspaces across assessors. `referralId` opens workflow, assessments, notes,
contacts, file metadata, packet extraction, retained imported ALLO content or
recent activity. `assessment` also requires the exact `assessmentId` and verifies
its referral binding. Question definitions and provenance come from the same
assessment-context owner used by the application.

Native lists return 20 records and their next cursor. Directory continuation also
requires its first page's source revision and unchanged filters; a concurrent
change returns 409. Platform reads long text through revision-bound offsets. It
excludes transport read times from content identity and never treats a capped
page as a population total. Separate owner reads are not one atomic snapshot.

Known ceilings: this reader does not return original file bytes or full OCR,
deleted workspaces, or complete event history. The activity owner retains at most
100 events. Packet fields retain candidates/review state, not the whole document.
The catalog exposes these gaps. Responses over 4 MiB fail without dropping
evidence. If real questions need original documents or larger histories, extend
the canonical document/history reader and pagination first; do not invent an
answer from file metadata or raise limits silently.

Focused evidence: `node --test scripts/ally-source.test.mjs
scripts/assessment-context.test.mjs scripts/referral-context.test.mjs
scripts/platform-client-briefing.test.mjs`, `npx tsc --noEmit`, and
`node scripts/api-route-policy-audit.mjs`. These protocol/behavior checks use
isolated fixtures. Real cross-app questions, package validation and deployment
remain pending. This change activates no credential or production grant.

The production package check is `node scripts/check-ally-source-package.mjs`
after `npm run build`. It starts an isolated loopback server and reads only the
catalog. It caught the existing Proxy routing all Platform feeds through the
summary credential; the new route now uses its dedicated authorization at both
Proxy and handler. Browser auth and the older feed credentials are unchanged.

The initial build reported pre-existing Next 16.4.3 security advisories. This
candidate pins Next and its ESLint package to 16.4.6; the overridden glob caller
is byte-identical and its existing behavior tests pass with the reviewed pin.
The build and packaged HTTP check pass. The production dependency audit has
zero high/critical findings and no remaining Next advisory; existing unrelated
Azure identity/UUID and XML-parser moderate/low findings remain recorded in the
private audit output. See the [Next patch release](https://github.com/vercel/next.js/releases/tag/v16.4.6)
and [response-forwarding advisory](https://github.com/vercel/next.js/security/advisories/GHSA-pc58-hwjq-p385).
