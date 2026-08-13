# Azure deployment state

Last verified: 12 August 2026

This document contains identifiers and configuration state only. It must never
contain passwords, client secrets, tokens, connection strings, packet content,
resident identifiers, or other PHI.

## Confirmed target

| Setting | Value |
| --- | --- |
| Azure subscription | `Azure subscription 1` |
| Subscription ID | `84d40648-8488-4226-9e74-6b9458d0d73f` |
| Entra tenant ID | `d72d9036-cff8-4f5f-a6fa-d698f621d420` |
| Region | `westus2` |
| Pipeline resource group | `rg-pipeline-prod` |
| Capacity profile | `pilot` |
| GitHub repository | `3wilsoneric/pipeline-app` |
| Production branch | `main` |
| Intended production hostname | `alamo-pipeline.com` |
| DNS provider | `GoDaddy` |

The billable pilot foundation is deployed. Release automation reads its
nonsecret resource identifiers from the output-only
`pipeline-foundation-state` deployment.

## Entra applications

| Purpose | Name | Client ID | State |
| --- | --- | --- | --- |
| Human sign-in and Pipeline API | `Alamo Pipeline` | `86859156-57b6-467e-b8a5-edcb01a606da` | Created |
| Pipeline-to-Alamo service client | `Alamo Pipeline Clinical Client` | `03b55a3d-e6e1-4210-a07b-16e98c45ab20` | Created; no client secret created |
| Governed Alamo clinical API | `Alamo-Health-Data-Platform` | `40283155-592b-4565-bd3c-c730a34feaaa` | Existing |

The human application exposes `access_as_user` and the roles
`Pipeline.Admin`, `Pipeline.AssessmentCoordinator`, `Pipeline.Reviewer`, and
`Pipeline.Viewer`. User assignment is required. The initial operator is assigned
`Pipeline.Admin` for the pilot.

The Alamo API exposes the application role `Pipeline.Clinical.Read.All`. That
role is assigned to the dedicated clinical client. The required token scope is:

```text
api://40283155-592b-4565-bd3c-c730a34feaaa/.default
```

No browser secret exists. No service secret has been generated or stored yet.
The configured SPA redirects are the localhost sign-in route and the exact
sign-in routes for the generated Azure hostname, `alamo-pipeline.com`, and
`www.alamo-pipeline.com`. No wildcard redirect or browser secret is configured.

The public `.com` registry confirms `alamo-pipeline.com` was registered through
GoDaddy on 12 August 2026. The authoritative nameservers are
`ns41.domaincontrol.com` and `ns42.domaincontrol.com`. These records are active:

```text
A    @      48.192.77.119
TXT  asuid  FA03E93FC8735330D0F4ED514A466A01A12F9EA27D0D8D43C62DD7AB240C55AE
CNAME www    alamo-pipeline.com
TXT  asuid.www  FA03E93FC8735330D0F4ED514A466A01A12F9EA27D0D8D43C62DD7AB240C55AE
```

Keep both `asuid` TXT records after validation for ownership checks and
certificate renewal.

## Existing Alamo resources

Pipeline will reuse only the approved existing Databricks workspace:

```text
https://adb-7405608024417459.19.azuredatabricks.net
```

The foundation deliberately does not reuse the existing `alamodatalake`,
`alamo-docreader`, or `alamo-databricks-access` resources. Their current public
network and local/shared-key settings cannot be tightened for Pipeline without
risking the Alamo platform. Pipeline therefore uses dedicated storage,
Document Intelligence, managed identities, and a Databricks access connector
inside `rg-pipeline-prod`.

The existing Databricks workspace does not yet contain a Pipeline extraction
job or dedicated Pipeline extraction service principal. Pipeline must not be
given access to ElderMark, clinical tables, or unrelated Alamo storage.

## GitHub boundary

The repository is private. Actions permissions are restricted to GitHub-owned
actions plus the selected Azure Login and Docker build actions. Workflow tokens
are read-only and cannot approve pull requests.

GitHub Free does not provide the desired private-repository branch or
environment protection rules. The deployment therefore uses two independent
controls that do not require a paid GitHub plan:

1. the workflow runs only from `refs/heads/main`;
2. Azure OIDC accepts only
   `repo:3wilsoneric/pipeline-app:ref:refs/heads/main`.

No Azure deployment secret or application secret is stored in GitHub.

## Deployed foundation

The operator explicitly approved `DEPLOY`. The private pilot foundation now
includes:

- private PostgreSQL Flexible Server, `Standard_D2ds_v5`, 128 GB, no standby;
- Standard Azure Container Registry;
- Consumption Container Apps environment;
- dedicated ZRS ADLS Gen2 storage with shared keys disabled;
- dedicated S0 Document Intelligence with local keys disabled;
- Key Vault, managed identities, private networking, logs, Application
  Insights, and seven PHI-safe alert rules.

At 12 August 2026 West US 2 retail rates, the fixed foundation estimate is
approximately USD 166 per month before usage: about USD 130 PostgreSQL compute,
USD 15 PostgreSQL storage, USD 20 Container Registry, and about USD 1 for 50 GB
of hot ZRS packet storage. Logs, requests, backups beyond allowance, document
pages, Databricks job compute, and the application runtime are usage-based.
The Container App runtime is deployed separately. An always-present 1 vCPU/2
GiB Container App is approximately USD 32 per month while idle before free
grants and costs more while actively serving requests.
Azure invoices and the Pricing Calculator remain authoritative.

The initial PostgreSQL URLs, Entra session key, pilot allowlist, and internal
worker key are stored in Key Vault. GitHub contains only nonsecret Azure and
Entra identifiers. The first release uses `manual` packet processing: uploads
are persisted to private Blob storage and chart data can be entered manually,
but the app does not claim that OCR or extraction ran.

## Deployed runtime

GitHub Actions run `31667023980` deployed commit `54f2ed4` successfully. The
healthy revision is `pipeline-prod-web--54f2ed480e70dc4b`; it receives 100% of
traffic and scales from one to three replicas.

```text
https://pipeline-prod-web.delightfulfield-ea30179b.westus2.azurecontainerapps.io
https://alamo-pipeline.com
https://www.alamo-pipeline.com
```

Both `/api/health/live` and `/api/health` return `200`. PostgreSQL, referral,
assessment, resident-link, authentication, durable upload, and user-workspace
state checks are ready and multi-instance safe where applicable. The sign-in
page and exact custom-domain Entra redirect are active. Azure validated the
hostnames and issued managed certificates
`mc-pipeline-prod--alamo-pipeline-c-7484` and
`mc-pipeline-prod--www-alamo-pipeli-3834`, currently valid through 13 February
2027. Blob CORS allows only the generated Azure origin and the two production
custom-domain origins.

The one-time PostgreSQL bootstrap succeeded, invalidated its administrator
credential, and was finalized. The administrator URL and bootstrap job were
removed. Routine releases use only the checksum-guarded migrator.

Clinical access is explicitly disconnected and optional for this pilot release.
Clinical routes continue to fail closed; the app does not claim live census or
EHR data. Packet processing is `manual`, so private uploads and manual charting
work, while automatic OCR/extraction remains disabled.

## Remaining gates

1. Generate the clinical client credential only at the local hidden prompt and
   store it directly in Key Vault.
2. Configure role groups or the final pilot user list. Do not leave the app open
   to the tenant.
3. Create the dedicated Databricks extraction principal and production worker
   before switching packet processing to `azure_databricks`.
4. Add an Azure Monitor action group after alert recipients are approved.
5. Confirm Microsoft agreement/BAA coverage and name the retention/deletion
   approver before real PHI is uploaded.
