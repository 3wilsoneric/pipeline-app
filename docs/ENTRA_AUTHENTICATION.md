# Pipeline Microsoft Entra Authentication

Pipeline has two independent trust boundaries:

1. Human users sign in to Pipeline with Microsoft Entra ID using the browser SPA registration and Authorization Code + PKCE.
2. Pipeline's server-only clinical adapter calls the Alamo clinical API with its own client credentials.

The human access token is never forwarded to Alamo, and the browser never receives Alamo client credentials.

## Environment contract

### Browser-safe variables

These are public application identifiers and may be embedded in the browser bundle:

```text
NEXT_PUBLIC_ENTRA_TENANT_ID=<tenant id>
NEXT_PUBLIC_ENTRA_CLIENT_ID=<Alamo Pipeline app registration client id>
NEXT_PUBLIC_PIPELINE_API_SCOPE=api://<same app id>/access_as_user
NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=true
```

### Server-only variables

```text
PIPELINE_AUTH_MODE=entra_jwt
PIPELINE_ENTRA_TENANT_ID=<tenant id>
# v2 access-token aud claim: the plain application client ID GUID
PIPELINE_ENTRA_API_AUDIENCE=<same app id>
PIPELINE_ENTRA_API_SCOPE=access_as_user
PIPELINE_ENTRA_SESSION_SECRET=<random value, at least 32 characters>
PIPELINE_ALLOWED_MUTATION_ORIGINS=https://<pipeline-production-domain>
```

Production Entra JWT authentication does not maintain a second local user
allowlist. The tenant-scoped delegated token and the enterprise application's
**Assignment required** setting govern admission. `PIPELINE_ALLOWED_*` variables
exist only for explicitly enabled legacy trusted-gateway header mode.

The browser requests `api://<app id>/access_as_user`, but the server validates
the v2 access token against `<app id>`. Microsoft emits the API client ID GUID
as `aud` for v2 access tokens; the scope URI is not the token audience.

`PIPELINE_ALAMO_*` variables remain server-only and belong to the separate clinical API adapter. Do not add any clinical secret or token to a `NEXT_PUBLIC_*` variable.

Local mock mode is explicit and allowed only for loopback Playwright smoke tests. A deployed environment must use `PIPELINE_AUTH_MODE=entra_jwt`, `NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=true`, and `PIPELINE_ALLOW_PRODUCTION_MOCK_AUTH=false`.

## Entra app registration

Use one tenant app registration named `Alamo Pipeline` for the Pipeline user
experience and API. The same application registration supplies the SPA client
ID and the exposed API application ID URI:

1. Add a Single-page application redirect URI for `http://localhost:3000/sign-in`.
2. Add the exact production redirect URI `https://<pipeline-production-domain>/sign-in`.
3. Temporarily add the exact generated Azure Container Apps `/sign-in` redirect used for pre-domain testing. Remove it after custom-domain cutover. Wildcard redirects are not allowed.
4. Add the exact production logout redirect URI `https://<pipeline-production-domain>/sign-in`. For local testing, register `http://localhost:3000/sign-in` as both redirect and logout URI.
5. Under **Expose an API**, define `access_as_user` with the application ID URI represented by `api://<same app id>`.
6. Grant the SPA delegated permission to that `access_as_user` scope and grant admin consent.
7. Set **Assignment required** on the enterprise application and assign every authorized user or group.
8. If role-based access is needed, define `Pipeline.Admin`, `Pipeline.AssessmentCoordinator`, `Pipeline.Reviewer`, and `Pipeline.Viewer` app roles as allowed member types for users/groups, then assign them to the authorized users or groups.

No client secret is needed for the browser SPA registration. The server session secret is generated locally and stored in Azure Key Vault.

## Request behavior

- `proxy.ts` validates protected page and API requests before they reach the app.
- Server routes validate issuer, audience, signature, and delegated scope.
- Browser mutations use an explicit exact-origin list so Azure's reverse proxy
  cannot make a valid custom-domain request appear cross-origin.
- Entra enterprise-app assignment is the single admission boundary. App roles
  constrain privileged actions; local identity lists are used only by legacy
  trusted-gateway header mode.
- MSAL v4 stores encrypted authentication artifacts in `localStorage` so the
  account and token cache is shared across Pipeline tabs. Temporary redirect
  state remains in MSAL's default non-persistent storage.
- The encrypted, HttpOnly Pipeline cookie is the durable same-origin app
  session. API calls use a fresh bearer when available, fall back to the cookie
  when the MSAL tab cache is unavailable, and renew the cookie silently while
  Pipeline is open.
- Interactive sign-in requests `select_account` so a browser with another active
  Microsoft session cannot silently choose the wrong Pipeline identity.
- The short-lived HttpOnly Pipeline session cookie is created only after JWT
  validation and is only a continuity mechanism; it is not a replacement for
  Entra issuer, audience, scope, role, and assignment validation.
- Errors are generic and logs never include tokens, query strings, names, diagnoses, medication data, resident IDs, secrets, or upstream response bodies.

## Deployment order

1. Create/configure the Entra app registration and exact redirect/logout URIs.
2. Expose `access_as_user`, assign permissions, and grant tenant-wide admin
   consent. `scripts/configure-entra-identities.sh` fails closed if the
   resulting delegated permission grant cannot be verified.
3. Bake the browser-safe identifiers into the immutable container image and map server-only secrets from Azure Key Vault through the runtime managed identity.
4. Add the existing `PIPELINE_ALAMO_*` clinical adapter variables separately when the Alamo API is ready.
5. Deploy, open `/sign-in`, complete a real sign-in, and verify a protected API request returns the signed-in Pipeline user.
6. Test sign-out, deep links, unauthorized users, and expired sessions before enabling the clinical UI.

GitHub authenticates to Azure separately through an OIDC federated credential
bound to the exact repository and `main` branch. That deployment identity is
not a human-login mechanism, is not the Pipeline SPA, and has no reusable client
secret.

Until the tenant ID, application IDs, redirect URIs, assignments, consent, and deployment variables are provided, the implementation is prepared but not live-connected to Entra.

## Installed PWA and MSIX behavior

The installable Pipeline build remains a hosted web application. Microsoft Edge,
Windows, and an MSIX generated from the hosted PWA all load the production HTTPS
origin, so they use the same SPA registration, authorization-code-with-PKCE flow,
API scope, and exact `/sign-in` redirect URI as the browser deployment. Do not add
a mobile/desktop public-client redirect and do not create a desktop client secret
for this distribution model.

Deep links such as `https://<pipeline-production-domain>/?view=referrals&referral=123`
remain HTTPS links. The post-login path validator accepts same-origin paths only,
rejects protocol-relative and control-character paths, and resumes the requested
Pipeline destination after authentication.

If Pipeline is later rebuilt as an Electron or native Windows executable, that is
a different authentication architecture and requires a separate Entra review. It
must not reuse this PWA/MSIX assumption without configuring and validating the
appropriate public-client redirect.
