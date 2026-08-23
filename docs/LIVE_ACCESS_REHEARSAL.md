# Pipeline live access rehearsal

This is the final read-only Entra authorization check after a deployment. It
requires four temporary users or test principals assigned to the production app
roles. The script never prints tokens, people, record IDs, or response bodies.

## Prepare

1. Assign one temporary principal to each application role:
   `Alamo.Admissions.Viewer`, `Alamo.Admissions.Assessor`,
   `Alamo.Admissions.Supervisor`, and `Alamo.Admissions.Admin`.
2. Create a non-PHI rehearsal workspace assigned to the assessor. Do not use a
   production client for access testing.
3. Sign in as each temporary principal and obtain a short-lived access token for
   Pipeline's delegated API scope. Store each token in a mode-`0600` file. Do
   not paste tokens into shell history, tickets, chat, or CI variables.
4. Export only the file paths and clean application origin:

```bash
export PIPELINE_ACCESS_SMOKE_BASE_URL=https://alamo-pipeline.com
export PIPELINE_ACCESS_SMOKE_VIEWER_TOKEN_FILE=/secure/path/viewer.token
export PIPELINE_ACCESS_SMOKE_ASSESSOR_TOKEN_FILE=/secure/path/assessor.token
export PIPELINE_ACCESS_SMOKE_SUPERVISOR_TOKEN_FILE=/secure/path/supervisor.token
export PIPELINE_ACCESS_SMOKE_ADMIN_TOKEN_FILE=/secure/path/admin.token
npm run check:access:live
```

Expected behavior: every role can read the workspace directory; only supervisor
and admin can read the supervisor queue; anonymous and malformed tokens receive
`401`. The script performs no mutations.

## Close

1. Delete the token files securely.
2. Remove the four temporary assignments unless those principals are approved
   permanent members.
3. Delete the non-PHI rehearsal workspace through the normal trash workflow.
4. Record only pass/fail counts and the release revision in the acceptance
   record.
