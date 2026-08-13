# Azure input handoff

Use this sheet to give Codex the non-secret facts needed to prepare the actual
Azure deployment. Do not send secrets, tokens, passwords, packet files, client
names, or other PHI in chat.

The initial handoff has now been completed. Current verified values and the
remaining deployment gates are recorded in
[`AZURE_DEPLOYMENT_STATE.md`](./AZURE_DEPLOYMENT_STATE.md). Keep the template
below for future environment changes and disaster recovery.

## Find the values

1. Azure portal -> `Subscriptions` -> open the intended subscription. Copy its
   **Subscription ID**, displayed **name**, and confirm who can approve resource
   creation and role assignments.
2. Open the existing Alamo production resource group and one existing resource.
   Copy its **Location**. Choose `pilot` for a single-zone database or
   `production_ha` only when the standby and longer backups are approved.
3. Azure portal -> `Microsoft Entra ID` -> `Overview`. Copy **Tenant ID**.
4. Entra -> `App registrations` -> search `Alamo Pipeline`. Copy its
   **Application (client) ID**, or write `not created`.
5. Entra -> `Groups`. List the group names that should map to Admin, Assessment
   Coordinator, Reviewer, and Viewer. Use work email addresses only for a small
   pilot when groups do not exist yet.
6. Open the approved Azure Databricks workspace. Copy its browser origin, the
   numeric extraction **job ID**, and the dedicated Pipeline service
   principal's client ID. Write `not created` for anything missing. Do not copy
   its OAuth secret.
7. Entra -> `App registrations` -> open the Alamo clinical API. Copy the
   **Application ID URI**. Open Pipeline's service application and copy its
   client ID, or write `not created`. Do not copy its client secret.
8. Decide the production hostname and identify the portal that controls its DNS
   records. From Azure Monitor -> `Alerts` -> `Action groups`, copy any action
   group resource IDs that should receive Pipeline alerts.
9. Name the people who approve data retention/deletion and confirm the relevant
   Microsoft agreement/BAA and shared-responsibility controls.

## Paste this completed template

```text
Azure subscription ID:
Azure subscription name:
Azure region:
Azure resource group: rg-pipeline-prod
Capacity: pilot | production_ha
Production hostname:
DNS provider:
Entra tenant ID:
Pipeline human-login app client ID: not created | <client ID>
Role groups: Admin=<name>; Coordinator=<name>; Reviewer=<name>; Viewer=<name>
Databricks workspace origin:
Databricks extraction job ID: not created | <job ID>
Databricks Pipeline service-principal client ID: not created | <client ID>
Alamo clinical API application ID URI: not created | <URI>
Pipeline-to-Alamo service client ID: not created | <client ID>
Azure Monitor action-group resource IDs: none | <resource IDs>
Retention/deletion approver:
Microsoft agreement/BAA confirmer:
GitHub repository: 3wilsoneric/pipeline-app
```

## Keep these local

The PostgreSQL bootstrap password, Databricks OAuth secret, Alamo client secret,
and generated application secrets are entered only into the repository scripts'
hidden prompts. The scripts send them directly to Azure Key Vault. GitHub uses
Azure OIDC and receives no Azure deployment secret. Browser variables contain
only public Entra identifiers and scopes.
