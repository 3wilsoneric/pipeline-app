# Production operational alert deployment

On 2026-09-10, deployment `pipeline-alerts-20260910` applied the existing PHI-safe alert module to `rg-pipeline-prod` in West US 2. Azure what-if reported nine creates, seven updates, and no deletes before deployment.

The post-deployment strict, read-only audit passed with:

- 13 of 13 declared scheduled-query alerts present and enabled.
- All three declared capacity metric alerts present and enabled.
- Two pre-existing runtime metric alerts retained, for five enabled metric alerts in total.
- One action group with two configured notification receivers.
- No missing query or metric alerts.

Verification command:

```bash
PIPELINE_AZURE_RESOURCE_GROUP=rg-pipeline-prod npm run check:alerts:azure -- --strict
```

The evidence is limited to names, counts, resource state, and delivery configuration. It contains no referral, client, document, clinical, credential, or notification-address data.
