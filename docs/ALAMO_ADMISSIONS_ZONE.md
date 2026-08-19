# Alamo Pipeline Boundary

Pipeline is the standalone transactional referral application at
`https://alamo-pipeline.com`. Alamo Platform provides an aggregate
`/admissions` overview using governed census and community context, then links
here for the full workflow.

## Runtime boundary

- Alamo owns the aggregate Pipeline overview, governed census, community
  context, clinical source-of-truth APIs, and entry navigation.
- Pipeline owns referral transactions, PostgreSQL records, uploads, OCR,
  extraction review, documents, assessments, decisions, presence, and
  optimistic concurrency.
- Pipeline calls the narrow Alamo clinical API server to server. The browser
  never connects to ElderMark or Databricks.
- Pipeline returns to Alamo through `NEXT_PUBLIC_ALAMO_PLATFORM_URL`; it does
  not assume it is mounted below the Alamo browser origin.

## Required production settings

```text
NEXT_PUBLIC_ALAMO_PLATFORM_URL=https://www.alamoplatform.com
NEXT_PUBLIC_PIPELINE_BASE_PATH=
NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=true
PIPELINE_AUTH_MODE=entra_jwt
PIPELINE_ALLOWED_MUTATION_ORIGINS=https://alamoplatform.com,https://www.alamoplatform.com
```

Use the same browser Entra application, tenant, delegated API scope, API
audience, and API scope as Alamo Platform for the corresponding
`NEXT_PUBLIC_ENTRA_*`, `NEXT_PUBLIC_PIPELINE_API_SCOPE`, and
`PIPELINE_ENTRA_*` settings. Keep `PIPELINE_ENTRA_SESSION_SECRET` server-only.

Pipeline recognizes these Alamo app roles:

- `Alamo.Admissions.Assessor`
- `Alamo.Admissions.Supervisor`
- `Alamo.Admissions.Admin`

## Release checks

1. Verify `https://alamo-pipeline.com/api/health/live`.
2. Verify the Pipeline sign-in callback is `https://alamo-pipeline.com/sign-in`.
3. Exercise referral, packet upload, OCR, preview, assessment, and save flows.
4. Verify Home and Analytics links return to `www.alamoplatform.com`.

Base-path helpers remain covered for compatibility, but `/admissions` is not
the production mount point. Run `npm run check:admissions-zone` before release.
