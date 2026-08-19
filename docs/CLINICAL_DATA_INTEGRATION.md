# Clinical Data Integration

Pipeline consumes clinical data only through the Alamo Platform. It never
connects to ElderMark, Databricks, Azure snapshot storage, or eMAR sources.

```text
ElderMark API
  -> Alamo ingestion and normalization
  -> Databricks Silver/Gold and governed QA
  -> atomic last-known-good Azure snapshot
  -> Alamo Pipeline clinical API
  -> Pipeline server-only adapter
  -> authenticated Pipeline API/UI
```

## API Boundaries

The Pipeline server adapter calls only these Alamo endpoints:

```text
GET /api/integrations/pipeline/clinical/health
GET /api/integrations/pipeline/clinical/census
GET /api/integrations/pipeline/clinical/roster?q=&community=&limit=&cursor=
GET /api/integrations/pipeline/clinical/residents/{residentId}
GET /api/integrations/pipeline/clinical/clients?q=&community=&limit=&cursor=
GET /api/integrations/pipeline/clinical/clients/{canonicalClientId}
GET /api/integrations/pipeline/clinical/medications/summary
```

Pipeline exposes the corresponding authenticated server routes at
`/api/clinical/*`. It does not request `/api/platform/bootstrap`, reconstruct
the clinical contract from internal Alamo tables, or put upstream credentials
in a browser bundle.

All successful responses preserve Alamo provenance:

```json
{
  "source": "alamo_platform",
  "snapshot_id": "fixture-2026-08-07T12:00:00.000Z",
  "generated_at": "2026-08-07T12:00:00.000Z",
  "data_as_of": "2026-08-07",
  "retrieved_at": "2026-08-07T13:00:00.000Z",
  "freshness": {
    "status": "fresh",
    "age_hours": 1,
    "max_age_hours": 24,
    "warning": null
  }
}
```

Missing values remain `null`; they are never guessed or converted to zero.
Roster sorting and cursor pagination are owned by Alamo, capped at 200 rows,
and bound to one snapshot. Pipeline validates every upstream response before
returning it.

Resident IDs are only unique when paired with a community. A bare identifier
that matches multiple residents returns `409` plus the matching
community-qualified keys. A missing identifier returns `404`.

The roster and resident contracts expose nullable `canonical_client_id` and
`resident_number`. Alamo separately exposes a protected, bounded client
directory at `/api/integrations/pipeline/clinical/clients` and client detail at
`/api/integrations/pipeline/clinical/clients/{canonicalClientId}`. Pipeline
proxies only the bounded directory projection at `/api/clinical/clients`; it
never sends the 141-field database in bulk. The authenticated unified profile
requests one canonical client detail server-to-server and returns only that
client's enrichment, current profile, and episode history.

Alamo loads the static object referenced by `clientDatabase.path` once per
pointer identity, indexes it by `canonical_client_id`, and joins it to governed
resident profile and episode history on that key only. Client search supports
name, canonical ID, and resident number; client detail returns the complete
published enrichment record plus current profiles and episode history.

Pipeline assessments attach `canonical_client_id` only after the server resolves
a reviewed existing-client identity through Alamo. Assessment history preserves
every dated record, including the August 18 baseline, and prefers canonical ID
while retaining resident-number/key lookups for compatibility. Neither system
silently links by name.

Medication output is summary-only: compliance, refusals, and combined
held/not-given counts by community and portfolio. The Pipeline schema rejects
medication names, resident-level MAR records, notes, and administration detail.

## One-Time Local Demo Snapshot

For a controlled local demonstration, Pipeline can import a governed Alamo
roster CSV plus its community reconciliation CSV. This does not change the
production architecture: `demo_snapshot` is blocked whenever `NODE_ENV` or
`PIPELINE_DEPLOYMENT_ENV` is production-like, and production still requires `alamo_api`.

```bash
npm run clinical:demo:import -- \
  --roster /private/path/current-roster.csv \
  --reconciliation /private/path/census-check.csv
```

The importer validates required columns, ISO dates, active status, governed
`resident_number`, community-qualified keys, unique keys, one `data_as_of`
date, and exact community reconciliation. It writes
`.data/demo-clinical-snapshot.json` atomically with owner-only `0600`
permissions. `.data/` is ignored by Git. Import output contains aggregate
counts only; it never prints resident values or clinical fields.

Enable the local adapter with server-only variables:

```env
PIPELINE_CLINICAL_DATA_MODE=demo_snapshot
PIPELINE_CLINICAL_DEMO_SNAPSHOT_PATH=.data/demo-clinical-snapshot.json
```

The local adapter retains authenticated Pipeline routes, strict contracts,
private/no-store responses, 200-row pagination, snapshot-bound cursors,
community-qualified resident lookup, and bounded file reads. It labels every
response as a one-time snapshot that does not refresh automatically. Census and
roster are available; medication summary remains unavailable and fails closed.
Replacing the snapshot requires another validated import and an application
refresh. No runtime fallback to sanitized fixtures exists.

## One-Time Longitudinal Client History

The current Alamo census remains the authority for who is admitted now. A
separate master client datasheet can enrich those governed profiles with prior
episodes, placement setting, referral source, diagnosis, conservatorship,
substance-use context, and discharge history. Pipeline never replaces a newer
census with this older longitudinal extract.

Pipeline referral intake does not call or wait for census reconciliation. The
referral keeps its own episode routing, documents, assessment work, and
requirements. Once per day, `GET /api/internal/clinical/reconcile` reads one
fresh, atomic Alamo roster snapshot and compares it with Pipeline client
identities. It creates review candidates only; it never confirms an uncertain
identity and never copies the resident's current census community into the
historical referral record. Confirmed links let the unified profile read current
resident and community data from Alamo while joining Pipeline-owned backlog at
request time.

The internal job is protected by `PIPELINE_WORKER_SHARED_SECRET`, returns
aggregate counts only, fails closed for stale or changing snapshots, honors
rejected candidates, and is scheduled by Azure Container Apps Jobs once daily.
An exact, reviewed ElderMark `resident_number` is preferred. Otherwise,
exact DOB plus one unique compatible name can create a candidate for human
review; name alone never creates a link.

```bash
npm run client-history:import -- \
  --input /private/path/Master\ Client\ Datasheet.csv \
  --confirm IMPORT-USER-SUPPLIED-REAL-CLIENT-HISTORY
```

The importer derives one `data_as_of` date from every current episode, validates
episode durations and structured list fields, preserves duplicate episode keys
as visible source conflicts, archives the original under an opaque SHA-256 path,
and writes `.data/master-client-history.json` with owner-only `0600`
permissions. Import output and audit events contain aggregate counts only.

Local profile enrichment joins exclusively on exact governed
`resident_number`. A DOB disagreement withholds all history and returns an
explicit identity-conflict state. Names are never used as join keys. The
authenticated profile response strips source filenames and the repeated source
identity fields before data reaches the browser.

```env
PIPELINE_CLIENT_HISTORY_MODE=local_snapshot
PIPELINE_CLIENT_HISTORY_SNAPSHOT_PATH=.data/master-client-history.json
```

`local_snapshot` is development-only. Production ignores it and must receive
longitudinal history from the governed Alamo API boundary.

## Entra Setup

Recommended production mode is OAuth 2.0 client credentials:

For the requested `client_credentials` deployment, the exact Entra grant is an
**application permission**. Configure the Alamo API app registration with the
`Pipeline.Clinical.Read.All` application role, assign that role to Pipeline's
service-principal app registration, and grant tenant admin consent. Pipeline's
token request must use the Alamo API resource scope
`api://<ALAMO_API_APP_ID>/.default`. The delegated `Pipeline.Clinical.Read`
scope is only for the optional delegated mode and is not sufficient for the
production service-to-service configuration.

1. On the Alamo API app registration, expose delegated scope
   `Pipeline.Clinical.Read` and application role
   `Pipeline.Clinical.Read.All`.
2. Assign the Pipeline service app registration the
   `Pipeline.Clinical.Read.All` application role and grant tenant admin consent.
3. Set Pipeline's resource scope to `api://<ALAMO_API_APP_ID>/.default`.
4. Configure the Alamo API audience, tenant, scope, and role in the Alamo
   deployment.
5. Store Pipeline's service client secret in Azure Key Vault and configure the
   non-secret audience, tenant, client ID, and scope on the Container App.

Alamo deployment variables:

```env
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
ENTRA_API_AUDIENCE=api://<ALAMO_API_APP_ID>
PIPELINE_CLINICAL_API_SCOPE=Pipeline.Clinical.Read
PIPELINE_CLINICAL_API_ROLE=Pipeline.Clinical.Read.All
PIPELINE_CLINICAL_SNAPSHOT_MAX_AGE_HOURS=24
PIPELINE_CLINICAL_API_MAX_RESPONSE_BYTES=2097152
```

Pipeline deployment variables:

```env
PIPELINE_CLINICAL_DATA_MODE=alamo_api
PIPELINE_ALAMO_API_BASE_URL=https://www.alamoplatform.com
PIPELINE_ALAMO_AUTH_MODE=client_credentials
PIPELINE_ALAMO_TENANT_ID=<tenant-id>
PIPELINE_ALAMO_CLIENT_ID=<pipeline-service-app-id>
PIPELINE_ALAMO_CLIENT_SECRET=<server-only-secret>
PIPELINE_ALAMO_API_SCOPE=api://<ALAMO_API_APP_ID>/.default
PIPELINE_CLINICAL_TIMEOUT_MS=10000
PIPELINE_CLINICAL_MAX_RESPONSE_BYTES=2097152
PIPELINE_CLIENT_INCREMENTAL_UPDATES_ENABLED=false
PIPELINE_CLIENT_INCREMENTAL_UPDATES_APPROVAL=
```

`PIPELINE_ALAMO_AUTH_MODE=delegated` forwards a request bearer token intended
for the Alamo API. `bearer` mode and `PIPELINE_ALAMO_API_TOKEN` are available
for short-lived local verification only and are rejected in production.

No variable above is browser-prefixed. ElderMark credentials must exist only
in Alamo's governed ingestion environment and must never be copied to Pipeline.
The two incremental-update variables are intentionally disabled. They prepare
an approval gate only; no Databricks write worker is active.

## Readiness And Failure Behavior

`GET /api/clinical/health` is an authenticated Pipeline readiness endpoint.
It returns `200` only when Alamo reports a fresh, QA-approved snapshot with
census, roster, and medication summary coverage. It returns `503` when source
configuration is missing, the snapshot is stale or unavailable, or required
governed slices are incomplete.

Alamo preserves its atomic last-known-good snapshot. Data endpoints continue
to return that snapshot when stale, with `freshness.status: stale` and a
warning. They do not quietly claim it is live. Contract errors use clear
`401`, `403`, `404`, `409`, `502`, and `503` responses. Pipeline logs route,
request ID, status, and duration only; it never logs query strings, names,
diagnoses, medication data, DOBs, or upstream response bodies.

## Local Verification

The fixture at
`scripts/fixtures/alamo-pipeline-clinical.sanitized.json` contains fictional,
sanitized data and is used only by contract tests. Runtime code never falls
back to it.

```bash
npm run check:clinical
npm run lint
npm run build
```

Until the production base URL, Entra role assignment, and server credential are
configured, the adapter correctly reports `clinical_data_not_configured`; this
is not a live ElderMark connection.
