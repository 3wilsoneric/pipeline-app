# Pipeline desktop distribution

Pipeline's desktop option is an installable Progressive Web App packaged for
Windows as an MSIX when needed. It is not an Electron fork. The installed app and
the browser app run the same production build, routes, authorization checks, API
contracts, and PostgreSQL data model.

## Installed experience

An installed Pipeline PWA is a desktop application from the user's perspective:

- It launches in its own window without browser tabs or an address bar.
- It uses the Pipeline name and generated Pipeline icon in the Start menu,
  Windows Search, taskbar, desktop shortcuts, and uninstall settings.
- It can be installed directly from Microsoft Edge for a pilot or packaged from
  the production URL as an MSIX for Microsoft Store or Intune distribution.
- Hosted application updates arrive through the normal Azure deployment; the
  installed shell must not become a second release of Pipeline.

Microsoft Store publication is not required for an Entra pilot. Store publication
adds managed discovery and installation, but it does not change Pipeline's runtime
or authentication architecture.

## Entra authentication model

The installed PWA and its MSIX package continue to load Pipeline from its stable
HTTPS production origin. They use the same Entra SPA registration,
authorization-code-with-PKCE flow, `/sign-in` redirect, access checks, session,
and logout behavior as the browser application.

Do not create a desktop client secret, public-client redirect, embedded sign-in
flow, or second Entra application for this PWA/MSIX distribution. A future native
Windows or Electron application would require a separate authentication design
and security review.

## Offline working-set contract

Offline support exists to protect an assessor's active work during an interview.
It is not an offline copy of Pipeline's PostgreSQL database, census, client
directory, or document library.

Beginning an assessment establishes the only offline working set. It may contain:

- The minimum client and referral identifiers needed to identify the interview.
- The assigned assessor and scheduled assessment time.
- The assessment schema, conditional question logic, current answers, notes, and
  completion state.
- Document-checklist labels and completion state, but not document contents,
  thumbnails, OCR text, or file previews.
- Pending section mutations, idempotency identifiers, local timestamps, and the
  server versions needed for conflict detection.

The working set must not contain the complete client profile, census roster,
search index, unrelated referrals, reporting data, uploaded files, access tokens,
or server credentials. Finalizing, signing, or making a supervisor decision
remains online-only.

### Offline save and reconnect behavior

1. An online assessment load obtains the current server values and versions.
2. Each edit saves locally without waiting for the network and attempts the
   normal authenticated server mutation when connectivity is available.
3. While offline, section mutations enter the encrypted per-user queue and the UI
   must show an explicit offline state and the number of changes waiting to sync.
4. Reconnection re-establishes Entra authorization before replaying queued
   mutations in order. Each mutation is idempotent and includes its expected
   section version.
5. Non-overlapping changes may synchronize normally. A stale same-section or
   same-field change must never silently overwrite newer server data; Pipeline
   shows both values and requires an explicit resolution.
6. Acknowledged mutations are removed from the local queue. Failed mutations
   remain visible with a recovery action instead of being discarded.
7. Completing the assessment, explicit sign-out, reassignment away from the
   current assessor, or the seven-day expiry removes its local working set and
   encryption key as applicable.

The current implementation supports an assessment that is already open when the
connection drops, encrypted local drafts, queued section saves, replay after
reconnection, expiry, and sign-out cleanup. Resuming that active assessment after
the installed application has been fully closed and reopened without a network
connection is a remaining enhancement. It must use a static offline assessment
shell plus the encrypted working set; it must not cache protected HTML or broaden
the service worker into an offline database.

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
connectivity drops. Until offline assessment relaunch is separately implemented
and certified, cold-start offline access, file previews, new referrals, search,
profile browsing, and signed clinical actions remain online-only so
authentication and protected records cannot be bypassed.

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

For a direct-install pilot, users may first install Pipeline from Microsoft Edge
after the production manifest and service worker are enabled and validated. This
provides the standalone window, icon, Start menu entry, taskbar pinning, and Entra
sign-in without waiting for Microsoft Store certification.

Before signing or publishing, verify:

- Package identity, display name, publisher subject, version, and icon assets.
- The package start URL and scope point only to the production Pipeline origin.
- No broad file-system, microphone, camera, location, or background capabilities
  are requested.
- The package contains no credentials, environment files, client data, packet
  data, seed data, or database URLs.
- Entra login and logout complete inside the installed app, including a direct
  protected deep link.

For Microsoft Store distribution, create a Partner Center product, reserve the
Pipeline app name, use the matching package identity and publisher, complete the
privacy/support and Store-listing material, upload the generated package, and
submit it for certification. For a private managed pilot, sign the MSIX with the
organization's trusted code-signing certificate and deploy it through Intune as a
line-of-business Windows app. Assign either distribution first to a small Entra
pilot group, then expand after sign-in, update, uninstall, offline-save,
reconnect-sync, conflict, and rollback checks pass.

## Deployment order

1. Back up the database and apply migration `0006_user_workspace_state`.
2. Deploy the normal web build with both desktop flags still `false`.
3. Run web regression and authentication checks.
4. Enable both desktop flags in a pilot deployment.
5. Validate direct Edge installation, Entra sign-in, per-user drafts/recents,
   offline edits, reconnect replay, and conflict recovery.
6. Pilot the directly installed PWA while Store material is prepared.
7. Generate, sign, and test the MSIX from that production PWA.
8. Submit through Partner Center or assign the package to the Intune pilot group.
9. Monitor authentication failures, queued-save failures, draft conflicts, API
   latency, and service-worker installation failures before broad assignment.

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
