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
The configured SPA redirects are `http://localhost:3000/sign-in` and
`https://alamo-pipeline.com/sign-in`. No wildcard redirect or browser secret is
configured.

The public `.com` registry confirms `alamo-pipeline.com` was registered through
GoDaddy on 12 August 2026. The authoritative nameservers are
`ns41.domaincontrol.com` and `ns42.domaincontrol.com`. The final Azure `A` and
`asuid` ownership TXT values remain pending until the Container App runtime has
a default hostname.

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

## Remaining gates

1. Push the reviewed release and run the Azure deployment workflow with manual
   extraction, disconnected clinical data, and initial database bootstrap.
2. Run the one-time PostgreSQL bootstrap and immediately finalize/revoke the
   administrator credential.
3. Generate the clinical client credential only at the local hidden prompt and
   store it directly in Key Vault.
4. Configure role groups or the final pilot user list. Do not leave the app open
   to the tenant.
5. Add the generated GoDaddy DNS records, then bind the managed certificate.
6. Create the dedicated Databricks extraction principal and production worker
   before switching packet processing to `azure_databricks`.
7. Add an Azure Monitor action group after alert recipients are approved.
8. Confirm Microsoft agreement/BAA coverage and name the retention/deletion
   approver before real PHI is uploaded.
