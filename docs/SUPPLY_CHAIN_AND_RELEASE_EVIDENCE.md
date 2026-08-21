# Supply Chain and Release Evidence

## Enforced controls

- `package-lock.json` is required at lockfile version 3. Every registry package
  must declare an approved SPDX license and an integrity hash.
- CI runs `npm ci`, `npm audit --audit-level=high`, the license policy, the API
  route policy, and the complete platform gate.
- Every third-party GitHub Action is pinned to a reviewed 40-character commit
  SHA. Dependabot covers npm and Actions. Pull requests run native dependency
  review when the repository feature is available and
  `PIPELINE_DEPENDENCY_REVIEW_ENABLED=true`; CodeQL runs on pull requests,
  `main`, and weekly.
- Browser CI runs in the official Playwright image that matches the locked npm
  package version, pinned by immutable multi-architecture digest.
- Sanitized test fixtures never replace unavailable production services.

## Release bundle

Create and verify the bundle from a clean release checkout:

```bash
npm run release:evidence -- --out-dir /approved/path/pipeline-release-evidence
PIPELINE_REQUIRE_CLEAN_RELEASE=true npm run release:evidence:verify -- --dir /approved/path/pipeline-release-evidence
```

The directory contains `release-manifest.json`, `pipeline.cdx.json`, and
`SHA256SUMS.json`. The manifest binds the source revision, package lock,
migration manifest, CI/security workflows, API policy, operational alerts, and
desktop artifacts. It also fingerprints the tracked binary patch and all
non-ignored untracked source files. That candidate fingerprint records only
SHA-256 values and file counts, so a dirty review candidate can be identified
without copying its source or filenames into the evidence record. A production
release must still be reviewed, committed, regenerated from a clean checkout,
and verified with `PIPELINE_REQUIRE_CLEAN_RELEASE=true`.

The CycloneDX SBOM removes random serial and wall-clock metadata. Evidence
timestamps use `SOURCE_DATE_EPOCH` when present, otherwise the source commit
time.

The bundle contains no credentials, environment values, URLs, client data, or
packet content. Store it with the reviewed release record and operator smoke
evidence. Do not edit an evidence file after generation; regenerate the whole
bundle and re-run verification.

## External verification

GitHub dependency review, CodeQL, Dependabot updates, and immutable artifact
retention run only after the revision is pushed. Native dependency review is a
separately enabled GitHub repository feature; when unavailable, CI records the
skip while the blocking audit, license, lockfile-integrity, CodeQL, and platform
checks still run. A local green gate does not claim those hosted jobs ran.
