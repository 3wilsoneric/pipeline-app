# Pipeline Windows app pilot

The owner requested Carelog's Windows installation and update experience for
Pipeline, with Eric as the first pilot on Windows and Mac (2026-11-02).

## What this package does

Microsoft PWABuilder packages the production Pipeline PWA into a small,
architecture-neutral MSIX bundle hosted by Microsoft Edge Stable. It works with
the existing HTTPS origin, Microsoft account selection, authorized API, server
drafts and current offline-assessment recovery. It contains icons and Windows
metadata, not a second copy of the application, a database, credentials or a
native command bridge. No new Entra registration or client secret is needed.

The public pilot signing identity matches the existing Carelog certificate
profile. The publisher is **Eric Wilson**, not a separately verified Alamo Health
corporate identity. `AlamoHealth.Pipeline` is the direct-distribution package
identity; it is **not a reserved Microsoft Store identity**.

Carelog's local tablet engine, staff PINs and WebView2 shell are specific to
Carelog and are not copied. The Pipeline PWA remains the canonical application.
This is deliberately limited to distribution. Revisit a native shell only for a
concrete OS capability that the hosted PWA cannot provide.

## Build and inspect

From the repository root, using Node 22+ and Python 3:

```sh
python3 scripts/windows/test-package.py
node scripts/windows/build-package.mjs 1.0.0.0 .data/windows-package
python3 scripts/windows/verify-package.py .data/windows-package
```

The generator sends only the public app URL, manifest URL, name and publisher
information to Microsoft's hosted PWABuilder service. It has no access to a
signed-in Pipeline session. The verifier extracts **only** `Pipeline.msixbundle`;
it does not execute or distribute the service's test sideloader or PowerShell
installer. It rejects altered identity, launch URLs, browser flags, extra
capabilities, executables, private files, duplicate entries and unsafe paths.
The allowed `runFullTrust` capability belongs to the Microsoft Edge PWA host;
the package includes no custom executable.

The output includes an unsigned versioned bundle, checksum, source commit,
inspection evidence and `edge-policy.json`. The latter is an alternative managed
Edge installation policy, not an extra installation requirement. Merge its one
entry into existing `WebAppInstallForceList` settings; never replace other apps'
policy entries. No policy or device assignment is made by the build.

## Signed release

The `Pipeline Windows app` workflow builds unsigned packages on pull requests.
Signing runs only on a manual dispatch of protected `main`, in the
`windows-release` environment. A separate identity requires only Certificate
Profile Signer on the existing signing profile. Do not reuse or broaden the
Carelog release federation or grant the Pipeline application signing access.
Configure these environment variables from the existing verified profile:

`SIGNING_CLIENT_ID`, `SIGNING_TENANT_ID`, `SIGNING_SUBSCRIPTION_ID`,
`SIGNING_ENDPOINT`, `SIGNING_ACCOUNT`, `SIGNING_CERTIFICATE_PROFILE`.

The workflow verifies that the unsigned bytes match the same run, attempt and
commit before signing. Windows SignTool must verify the signed bundle and the
package inspection must still pass before `Pipeline.appinstaller` is generated.
The feed checks on launch every eight hours, lets the user defer, and does not
enable downgrades. It does not reload an open assessment. Hosted application
changes continue through normal Pipeline deployment.

Both x64 and ARM64 hosted Windows jobs install the trusted bundle, verify the
registered identity/version and remove their isolated test installation. This
does not prove real-account sign-in, physical-device launch, interrupted updates,
or preservation of an active offline draft across an actual Windows upgrade.

Publish only after the package, signature and installation checks pass. Upload
the immutable versioned bundle first, verify its public hash, then upload the
feed as `application/appinstaller` with revalidation. Never overwrite an existing
version with different bytes. Keep the previous bundle and release evidence.
No workflow here uploads a release or assigns it to staff.

## Eric's acceptance

1. On Windows, install through the signed `.appinstaller` feed with Microsoft
   Edge and Windows App Installer available. Confirm the Pipeline icon, publisher
   and version. The app should open in its own window at the live Pipeline site.
2. Sign in with your own account. Confirm the existing workspace access and
   upload/download behavior. No test email or synthetic patient is created in
   production as part of packaging checks.
3. Finish/synchronize any existing offline work in the old installation before
   switching browser profiles or removing it. Chrome and Edge do not share local
   offline recovery storage. Do not uninstall an old copy to resolve a duplicate
   icon while it contains unsynchronized work.
4. Test close/reopen and deep links. Confirm an update can be deferred during
   work. A later package version must pass an upgrade test before staff rollout.
5. On Mac, install the same site through Chrome or Edge's app installation UI.
   MSIX and Microsoft Store packages are Windows-only. The existing PWA shares
   the same server data but is not a macOS App Store package.

## Microsoft Store submission

A Partner Center Windows developer account must reserve Pipeline and supply its
exact Package/Identity/Name, Publisher and PublisherDisplayName. Use that identity
in a separately reviewed Store package; never invent it or silently replace the
direct pilot identity. Keep the pilot's identity/feed stable for installed users.

The Store candidate needs an accurate listing, privacy/support URLs, screenshots
without client data, audience/age declarations and reviewer access instructions.
The current app requires an authorized Alamo account: state that in the listing.
Do not give reviewers a real employee's credentials or patient records. If an
isolated demonstration is needed, agree the access arrangement before submitting.
Upload the Store bundle, not PWABuilder's `.sideload.msix` test artifact.

Store approval, availability and automatic package updates cannot be claimed
until Partner Center confirms certification and the installed Store build passes
the pilot checks. The direct installer is a separate distribution channel.

## Recovery

For application behavior, use Pipeline's existing known-good Azure image and
deployment procedure. For a packaging defect, stop distributing the affected
feed, preserve installed work, and ship a corrected package with a higher
version. Never force a downgrade or delete browser data. The existing web URL
remains accessible throughout packaging work.

References: [Microsoft Store PWA packaging](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/microsoft-store),
[managed Edge installation](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/webappinstallforcelist),
[App Installer updates](https://learn.microsoft.com/en-us/windows/msix/app-installer/update-settings).
