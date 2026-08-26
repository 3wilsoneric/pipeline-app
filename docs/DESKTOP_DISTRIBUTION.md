# Pipeline desktop distribution

Pipeline's desktop option is an installable Progressive Web App packaged for
Windows as an MSIX when needed. It is not an Electron fork. The installed app and
the browser app run the same production build, routes, authorization checks, API
contracts, and PostgreSQL data model.

## Safety boundary

Desktop support is off by default:

```text
NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=false
PIPELINE_DESKTOP_STATE_ENABLED=false
```

When both flags are off, Pipeline does not link the web manifest, register a
service worker, or call the per-user workspace-state APIs. Existing web behavior
is preserved. If an earlier build registered Pipeline's worker, the disabled
runtime unregisters it and removes only cache names beginning with
`pipeline-static-`.

When desktop support is enabled:

- The worker caches only generated app icons, the generic offline page, and
  immutable `/_next/static/` assets.
- Navigations are network-only and fall back to the generic offline page only
  when the network is unavailable.
- `/api` responses, pages, packet previews, uploaded files, query strings,
  client data, referral data, and authentication responses are never cached.
- Recovery drafts and the five most recent destinations move from browser
  session storage to an authenticated, per-user PostgreSQL store.
- Drafts expire after 30 days. Recents expire after 180 days.
- Draft writes use optimistic versions; another signed-in session cannot
  silently replace a newer draft.
- Open assessment drafts and queued section saves use a separate, per-user,
  non-extractable AES-GCM key in IndexedDB. They expire after seven days and
  are deleted on explicit sign-out.

The installed app supports continuity when an assessment is already open and
connectivity drops. Cold-start offline access, file previews, new referrals,
and signed clinical actions remain online-only so authentication and protected
records cannot be bypassed.

## Production prerequisites

1. Apply database migration `0006_user_workspace_state` before enabling either
   desktop flag.
2. Set `PIPELINE_DATABASE_MODE=postgres` and keep all Pipeline stores on the
   shared PostgreSQL database.
3. Configure production Entra authentication as documented in
   `docs/ENTRA_AUTHENTICATION.md`.
4. Serve Pipeline from one stable HTTPS production origin. Register that exact
   origin's `/sign-in` URL in the Entra SPA platform.
5. Set both desktop flags to `true` in the same deployment.
6. Run `npm run check:desktop`, `npm run check:security`, `npm run check:database`,
   `npm run lint`, and `npm run build` before promotion.

`PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE=true` is only for local development
and Playwright. Never set it in a production deployment.

## PWA validation

After deployment:

1. Sign in through Microsoft Entra and open a protected deep link.
2. In Edge DevTools, confirm `/sw.js` controls the page and the manifest reports
   the expected icons, `start_url`, and standalone display.
3. Inspect Cache Storage. Only `pipeline-static-v2` may exist, and it may contain
   only the Pipeline-scoped offline page, `/pwa/*`, and `/_next/static/*` URLs.
   When Pipeline uses a base path, confirm every cached URL, the manifest
   `start_url`, and the worker scope remain below that base path.
4. Open and edit a referral. Confirm no `pipeline-referral-draft:*` or
   `pipeline.recent-destinations.v1` value is written to browser storage.
5. Reload and confirm the signed-in user recovers only their own draft and
   recents.
6. Disconnect networking. An assessment that is already open remains editable.
   Drafts and section-save mutations are encrypted in IndexedDB, expire after
   seven days, and replay when connectivity returns. A cold navigation still
   shows the generic connection-required screen; protected HTML and uploaded
   documents are never written to Cache Storage.
7. Run `npm run test:e2e:desktop`. The browser suite installs the worker,
   verifies the generic offline fallback, replaces an old Pipeline cache,
   preserves an unrelated cache, exercises the hosted kill switch, and checks
   server-backed recents and optimistic draft conflicts.

## MSIX packaging

Use PWABuilder against the deployed HTTPS production URL. Generate a Windows
package from the live manifest rather than maintaining a second application
bundle.

Before signing or publishing, verify:

- Package identity, display name, publisher subject, version, and icon assets.
- The package start URL and scope point only to the production Pipeline origin.
- No broad file-system, microphone, camera, location, or background capabilities
  are requested.
- The package contains no credentials, environment files, client data, packet
  data, seed data, or database URLs.
- Entra login and logout complete inside the installed app, including a direct
  protected deep link.

For Microsoft Store distribution, reserve the app identity in Partner Center and
sign with the matching publisher identity. For a private pilot, sign the MSIX with
the organization's trusted code-signing certificate and deploy it through Intune
as a line-of-business Windows app. Assign it first to a small Entra pilot group,
then expand after sign-in, update, uninstall, and rollback checks pass.

## Deployment order

1. Back up the database and apply migration `0006_user_workspace_state`.
2. Deploy the normal web build with both desktop flags still `false`.
3. Run web regression and authentication checks.
4. Enable both desktop flags in a pilot deployment.
5. Validate PWA installation and per-user drafts/recents.
6. Generate, sign, and test the MSIX from that production PWA.
7. Assign the package to the Intune pilot group.
8. Monitor authentication failures, draft conflicts, API latency, and service
   worker installation failures before broad assignment.

## Rollback and kill switch

Set both desktop flags to `false` and redeploy. On the next web visit, Pipeline
unregisters its worker and deletes only Pipeline static caches. Existing MSIX/PWA
installations continue to load the hosted application and therefore receive the
disabled build. Do not roll back migration `0006` during an application incident;
the unused table is backward-compatible and can remain until a planned database
change window.

If package distribution itself must be stopped, unassign or supersede the Intune
package after the hosted kill-switch deployment. Revoking the package before the
hosted deployment is unnecessary and can strand installed shortcuts on an older
cached shell.
