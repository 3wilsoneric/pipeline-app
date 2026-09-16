# Hosted Assessor's Workshop

The Learning Center workshop opens the presentation, then the synthetic referral
workspace with Assessor/Supervisor switching. Tooltip guides remain separate in
Learning Center. The hosted workshop is a separate Azure Container App; the live
Pipeline service never enables persona mode or synthetic production writes.

## Request and data boundaries

Azure Container Apps EasyAuth requires the existing Pipeline Microsoft Entra
application on every public request. The gateway also requires its authenticated
principal and tenant headers. Azure strips external attempts to supply those
headers. The existing application's user assignments apply to workshop access.
The login requests Pipeline's existing `access_as_user` scope alongside OpenID
profile/email claims, reusing its organization-approved consent grant.
The native authentication redirect/origin allowlist contains only the workshop's
own HTTPS origin, so cookie-authenticated demo actions pass its CSRF checks while
the gateway continues to reject other mutation origins.
The gateway validates the public host and mutation origin before forwarding.

Each authenticated principal has an independent loopback Next.js process, private
working directory, practice records, document storage, and cache. The existing
persona isolation assertions remain unchanged. Only practice identity and
application headers enter the child; Microsoft cookies, tokens, managed identity,
production configuration, and integration credentials do not. Immutable build
assets are shared read-only. Desktop/offline caching is disabled for this image.

The workshop pull identity has only AcrPull on the existing registry. The Entra
secret belongs to the platform authentication sidecar and is not a container
environment variable. No production data volume or database is attached.

## Bounded operating limits

The initial service has one 2-CPU/4-GiB replica and six concurrent practice rooms.
Rooms expire after 120 idle minutes and are temporary across a service restart.
An active room is never evicted to make space. A stale mutation must fail rather
than create work in a replacement room. A user may reset their own room to the
original nine cases. Reopening Workshop also resets that user's practice run.

This intentionally uses process isolation instead of restructuring the live
stores. A workshop requiring more than six simultaneous participants is the
trigger to adopt a session pool and routing design; do not increase replicas
without that design. Practice data is disposable, so rollback/restart recovers
the original cases instead of migrating old practice records.

## Release

1. Integrate the workshop candidate onto current main and satisfy required CI.
2. Build the existing Dockerfile's `workshop` target, using
   `NEXT_PUBLIC_PIPELINE_PERSONA_DEMO=true`,
   `NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=false`, and
   `NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=false`. The gateway is the only public
   listener. `Dockerfile.acr` provides the equivalent ACR build target.
3. Preserve existing Entra SPA settings. Add the workshop host's
   `/.auth/login/aad/callback` Web redirect and an additional, separately named
   credential for EasyAuth. Never replace existing credentials.
4. Preview `infra/azure/workshop.bicep`. Deploy with `publicIngress=false`, then
   verify required authentication, tenant, audience, and the gateway image.
5. Only after verification, apply `publicIngress=true`. Confirm anonymous and
   forged-principal requests cannot reach practice endpoints. Exercise the
   authenticated presentation, role switch, and independent reset behavior.
6. Set repository variable `PIPELINE_WORKSHOP_URL` to the hosted
   `/training/demo?journey=1` URL and use the normal production workflow. The
   production image embeds this URL as `NEXT_PUBLIC_PIPELINE_DEMO_URL`.

The default Docker target remains production. Production auth, stores,
extraction, and Azure runtime inputs retain their existing values. Record image
digest, source SHA, exact ready revisions, auth configuration checks, focused
test results, and previous image in the release ledger.

For recovery, first remove public workshop ingress if authentication is broken.
Otherwise redeploy the previous verified workshop image with its matching
configuration. Restore the previous Learning Center URL through the normal
production release if necessary. Do not disable authentication to diagnose a
hosted demo problem.

Platform references: [Container Apps authentication and trusted user headers](https://learn.microsoft.com/en-us/azure/container-apps/authentication),
[Microsoft Entra configuration](https://learn.microsoft.com/en-us/azure/container-apps/authentication-entra).
