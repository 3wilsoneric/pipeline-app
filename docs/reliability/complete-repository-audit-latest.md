# Complete Repository and Dependency Audit

Audit date: 2026-08-28

This is a deterministic inventory of the current worktree. It covers every repository-owned file that exists on disk, records tracked files pending deletion separately, and inventories every package-lock entry. It does not include ignored runtime data, `.git`, `node_modules`, `.next`, Playwright output, or local secrets. The per-file review focus is a release checklist, not a claim that generic static analysis can prove behavior correct.

## Executive Summary

- Existing repository files: 644
- Tracked paths pending deletion: 0
- Risk classification: 47 critical, 131 high, 133 medium, 333 low
- Files with concrete static review flags: 142
- Direct dependencies: 28
- Locked dependency locations: 530
- Installed unique package versions: 527
- Installed dependency edges: 1091
- Locked packages with install hooks: 2
- Locked entries without a declared lockfile license: 0
- Locked entries with a non-npm-registry source: 0
- Package names resolved at multiple versions: 18

## Immediate Findings

- The installed dependency tree contains no npm-reported problems.
- Critical/high files require behavior tests and boundary verification; static review alone is not release evidence.
- Large UI and fixture modules are called out individually so future work does not add more responsibilities to them.
- Generated audit files are listed but must be regenerated rather than edited manually.

## Human Triage Required

- Review all 142 current static flags; this generator does not auto-dismiss findings from an older audit.
- Resolve or explicitly accept all 0 tracked pending deletions in the same change as their replacements.
- Review all 0 installed-tree problems and every direct dependency with zero repository references.
- Record confirmed findings, owners, and disposition in the approved refactor slice rather than editing this generated report.

## Direct Dependency Review

| Dependency | Scope | Requested -> resolved | License | Purpose | Repository references | Mistakes to look for |
|---|---|---|---|---|---:|---|
| @azure/identity | runtime | ^4.13.1 -> 4.13.1 | MIT | Server-side Azure credentials and managed identity | 14 | Credential-chain ambiguity, accidental browser import, tenant mismatch, token logging, and unmanaged retries. |
| @azure/msal-browser | runtime | ^4.30.0 -> 4.30.0 | MIT | Browser Entra session and token acquisition | 7 | Client secrets in browser code, redirect loops, stale account selection, overbroad scopes, and cache/session expiry behavior. |
| @azure/msal-react | runtime | ^3.0.29 -> 3.0.29 | MIT | React bindings for browser Entra authentication | 5 | Provider remounts, login races, missing loading/error states, and rendering protected content before authentication settles. |
| @azure/storage-blob | runtime | ^12.33.0 -> 12.33.0 | MIT | Private document and backup storage | 14 | Public containers, long-lived SAS URLs, path traversal, unbounded downloads, missing content headers, and retry amplification. |
| @napi-rs/canvas | runtime | ^1.0.5 -> 1.0.5 | MIT | Server-side PDF thumbnail rasterization | 10 | Native binary compatibility, memory exhaustion, malformed-image handling, and accidental inclusion in browser bundles. |
| @playwright/test | development | ^1.61.1 -> 1.61.1 | Apache-2.0 | Browser journey and accessibility testing | 25 | Skipped production-critical paths, shared test state, flaky timing assertions, and tests that pass only against warm caches. |
| @tailwindcss/postcss | development | ^4 -> 4.2.2 | MIT | Tailwind PostCSS integration | 6 | Build-version incompatibility and generated CSS growth. |
| @tesseract.js-data/eng | runtime | ^1.0.0 -> 1.0.0 | MIT | Pinned English OCR language data | 6 | Runtime bundle growth, version mismatch with Tesseract, and loading data from an untrusted remote location. |
| @types/node | development | ^20.19.37 -> 20.19.37 | MIT | Node.js type declarations | 7 | Type/runtime version mismatch with the deployment image. |
| @types/react | development | ^19 -> 19.2.14 | MIT | React type declarations | 5 | Type/runtime mismatch and suppressions hiding changed React behavior. |
| @types/react-dom | development | ^19 -> 19.2.3 | MIT | React DOM type declarations | 5 | Type/runtime mismatch and incorrect server/client assumptions. |
| axe-core | development | ^4.11.1 -> 4.11.1 | MPL-2.0 | Automated accessibility checks | 5 | Treating automated scans as complete accessibility coverage and ignoring keyboard/focus/manual checks. |
| babel-plugin-react-compiler | development | 1.0.0 -> 1.0.0 | MIT | React compiler transform | 5 | Compiler/runtime incompatibility, changed memoization behavior, and transforms not exercised in development mode. |
| eslint | development | ^9 -> 9.39.4 | MIT | Static code-quality enforcement | 10 | Rule drift, ignored directories, and warnings that do not fail CI. |
| eslint-config-next | development | 16.2.11 -> 16.2.11 | MIT | Next.js lint rules | 6 | Framework/config version mismatch and disabled server/client boundary rules. |
| fflate | runtime | ^0.8.3 -> 0.8.3 | MIT | Browser-side ZIP generation for bounded exports | 5 | Zip bombs, unbounded in-memory archives, unsafe filenames, and exporting data without authorization or formula escaping. |
| jose | runtime | ^6.2.8 -> 6.2.8 | MIT | JWT signing and validation | 5 | Missing issuer/audience/algorithm checks, clock-skew mistakes, key rotation, and accepting untrusted claims as authorization. |
| lucide-react | runtime | ^0.577.0 -> 0.577.0 | ISC | Shared interface icons | 37 | Unlabelled icon-only controls, inconsistent sizing, and importing the full icon set into client bundles. |
| next | runtime | 16.2.11 -> 16.2.11 | MIT | Application framework and server runtime | 163 | Server/client boundary leaks, cache semantics, route-handler behavior, dynamic rendering drift, and framework-version API changes. |
| pdfjs-dist | runtime | ^6.2.108 -> 6.2.108 | Apache-2.0 | PDF parsing, page rendering, and previews | 7 | Worker configuration, malformed/oversized PDFs, page-count limits, memory cleanup, CSP compatibility, and version drift. |
| postcss | development | 8.5.26 -> 8.5.26 | MIT | CSS transformation runtime | 9 | Plugin ordering, parser vulnerabilities, and output differences between local and CI builds. |
| postgres | runtime | ^3.4.9 -> 3.4.9 | Unlicense | PostgreSQL client | 95 | Pool exhaustion, missing transaction boundaries, unsafe dynamic SQL, statement timeouts, retrying non-idempotent writes, and connection leaks. |
| react | runtime | 19.2.4 -> 19.2.4 | MIT | User-interface runtime | 57 | Effect races, stale closures, unstable keys, hydration mismatches, and state duplicated across server/client boundaries. |
| react-dom | runtime | 19.2.4 -> 19.2.4 | MIT | React DOM rendering | 11 | Hydration mismatch, focus loss, route-announcer conflicts, and browser-only APIs during server rendering. |
| server-only | runtime | ^0.0.1 -> 0.0.1 | MIT | Build-time server-boundary guard | 81 | Missing imports in credential/data modules and false confidence when transitive client imports bypass the intended boundary. |
| tailwindcss | development | ^4 -> 4.2.2 | MIT | Utility CSS generation | 7 | Unbounded content scanning, stale classes, generated CSS growth, and version-specific syntax. |
| tesseract.js | runtime | ^7.0.0 -> 7.0.0 | Apache-2.0 | Fallback OCR engine | 7 | CPU and memory denial of service, unbounded worker creation, language-data loading, cleanup, and low-confidence output treated as truth. |
| typescript | development | ^5 -> 5.9.3 | Apache-2.0 | Static type checking and compiler APIs | 18 | Compiler-version drift, skipped checks, broad assertions, and emitted/runtime behavior assumed from types. |

Reference counts are literal repository references, including build configuration and package scripts. Zero does not automatically mean unused when a framework discovers a dependency by convention.

## Per-File Audit

Every existing repository file is listed below. `Review focus` names the most likely failure class for that exact file; `Verification` names the minimum evidence expected before release.

| File | Role | Risk | Size / lines | Review focus | Verification |
|---|---|---:|---:|---|---|
| `.dockerignore` | Build, runtime, or repository configuration | low | 132 B / 17 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `.env.example` | Build, runtime, or repository configuration | low | 10202 B / 212 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `.github/CODEOWNERS` | CI or supply-chain configuration | low | 335 B / 12 lines | Check least-privilege tokens, pinned actions, path filters, cache poisoning, secret exposure, cancellation/concurrency, and required-gate coverage. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/PULL_REQUEST_TEMPLATE/refactor.md` | CI or supply-chain configuration | low | 1375 B / 61 lines | Check least-privilege tokens, pinned actions, path filters, cache poisoning, secret exposure, cancellation/concurrency, and required-gate coverage. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/codex/prompts/refactor-slice.md` | CI or supply-chain configuration | low | 2622 B / 30 lines | Check least-privilege tokens, pinned actions, path filters, cache poisoning, secret exposure, cancellation/concurrency, and required-gate coverage. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/codex/schemas/refactor-result.schema.json` | CI or supply-chain configuration | low | 795 B / 33 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/dependabot.yml` | CI or supply-chain configuration | low | 733 B / 27 lines | Check least-privilege tokens, pinned actions, path filters, cache poisoning, secret exposure, cancellation/concurrency, and required-gate coverage. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/dependency-review-config.yml` | CI or supply-chain configuration | low | 319 B / 22 lines | Check least-privilege tokens, pinned actions, path filters, cache poisoning, secret exposure, cancellation/concurrency, and required-gate coverage. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/workflows/assurance.yml` | CI or supply-chain configuration | medium | 1126 B / 40 lines | Check least-privilege tokens, pinned actions, path filters, cache poisoning, secret exposure, cancellation/concurrency, and required-gate coverage. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/workflows/ci.yml` | CI or supply-chain configuration | medium | 10375 B / 256 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/workflows/deploy-azure.yml` | CI or supply-chain configuration | medium | 13413 B / 277 lines | Check least-privilege tokens, pinned actions, path filters, cache poisoning, secret exposure, cancellation/concurrency, and required-gate coverage. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/workflows/refactor-agent.yml` | CI or supply-chain configuration | medium | 17380 B / 388 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:ci-impact + check:supply-chain + CI dry run |
| `.github/workflows/security.yml` | CI or supply-chain configuration | medium | 1901 B / 62 lines | Check least-privilege tokens, pinned actions, path filters, cache poisoning, secret exposure, cancellation/concurrency, and required-gate coverage. | check:ci-impact + check:supply-chain + CI dry run |
| `.gitignore` | Build, runtime, or repository configuration | low | 568 B / 48 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `.nvmrc` | Build, runtime, or repository configuration | low | 3 B / 2 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `AGENTS.md` | Repository support file | low | 1556 B / 18 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `CLAUDE.md` | Repository support file | low | 11 B / 2 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `Dockerfile` | Build, runtime, or repository configuration | low | 2537 B / 66 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `Dockerfile.acr` | Build, runtime, or repository configuration | low | 2417 B / 66 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `Dockerfile.operations` | Build, runtime, or repository configuration | low | 102 B / 7 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `Dockerfile.ops` | Build, runtime, or repository configuration | low | 803 B / 10 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `README.md` | Repository support file | low | 2662 B / 58 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `app/(pipeline)/academy/page.tsx` | Next.js route or application shell | low | 1817 B / 60 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/(pipeline)/assessments/page.tsx` | Next.js route or application shell | low | 149 B / 6 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/(pipeline)/communities/page.tsx` | Next.js route or application shell | low | 135 B / 6 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/(pipeline)/error.tsx` | Next.js route or application shell | low | 976 B / 29 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/(pipeline)/layout.tsx` | Next.js route or application shell | low | 224 B / 10 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/(pipeline)/loading.tsx` | Next.js route or application shell | low | 536 B / 14 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/(pipeline)/page.tsx` | Next.js route or application shell | low | 528 B / 19 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/(pipeline)/referrals/page.tsx` | Next.js route or application shell | low | 121 B / 6 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/(pipeline)/settings/page.tsx` | Next.js route or application shell | low | 105 B / 6 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/(pipeline)/training/page.tsx` | Next.js route or application shell | low | 2004 B / 40 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/api/academy/progress/route.ts` | HTTP API route | high | 2966 B / 90 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/assessments/[assessmentId]/addenda/route.ts` | HTTP API route | high | 2887 B / 52 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/assessments/[assessmentId]/route.ts` | HTTP API route | high | 4849 B / 114 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/assessments/[assessmentId]/schedule/route.ts` | HTTP API route | high | 3013 B / 55 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/assessments/[assessmentId]/sign/route.ts` | HTTP API route | high | 3027 B / 54 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/assessments/[assessmentId]/start/route.ts` | HTTP API route | high | 3224 B / 57 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/assessments/route.ts` | HTTP API route | high | 2531 B / 51 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/auth/me/route.ts` | HTTP API route | critical | 758 B / 24 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | check:api + check:route-policy + targeted E2E |
| `app/api/auth/session/route.ts` | HTTP API route | critical | 1618 B / 45 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/calendar/events/route.ts` | HTTP API route | high | 2711 B / 58 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/clinical/census/route.ts` | HTTP API route | high | 733 B / 24 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/clinical/clients/[canonicalClientId]/facts/[fieldName]/evidence/route.ts` | HTTP API route | high | 1537 B / 50 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/clinical/clients/[canonicalClientId]/search/route.ts` | HTTP API route | high | 1523 B / 47 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/clinical/clients/route.ts` | HTTP API route | high | 1150 B / 35 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/clinical/health/route.ts` | HTTP API route | high | 1305 B / 34 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/clinical/medications/summary/route.ts` | HTTP API route | high | 768 B / 24 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/clinical/residents/[residentId]/route.ts` | HTTP API route | high | 1080 B / 37 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/clinical/roster/route.ts` | HTTP API route | high | 1200 B / 36 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/files/[documentId]/download/route.ts` | HTTP API route | high | 2352 B / 48 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/files/[documentId]/preview/route.ts` | HTTP API route | high | 2595 B / 42 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/files/[documentId]/route.ts` | HTTP API route | high | 2309 B / 49 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/files/import-review/[itemId]/route.ts` | HTTP API route | high | 2876 B / 52 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | check:api + check:route-policy + targeted E2E |
| `app/api/files/import-review/route.ts` | HTTP API route | high | 1825 B / 42 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/files/route.ts` | HTTP API route | high | 3880 B / 79 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/health/live/route.ts` | HTTP API route | high | 237 B / 8 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/health/route.ts` | HTTP API route | high | 2412 B / 59 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/internal/clinical/reconcile/route.ts` | HTTP API route | critical | 1504 B / 40 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/internal/extraction/dead-letter/route.ts` | HTTP API route | critical | 1229 B / 25 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/internal/extraction/dispatch/route.ts` | HTTP API route | critical | 728 B / 21 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/internal/extraction/queue/route.ts` | HTTP API route | critical | 624 B / 16 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/internal/extraction/reconcile/route.ts` | HTTP API route | critical | 705 B / 21 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/internal/extraction/report/route.ts` | HTTP API route | critical | 1126 B / 24 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/internal/retention/route.ts` | HTTP API route | critical | 1193 B / 25 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/me/assessment-drafts/[assessmentId]/route.ts` | HTTP API route | high | 6055 B / 123 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/me/recents/route.ts` | HTTP API route | high | 4216 B / 100 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/me/referral-drafts/[draftKey]/route.ts` | HTTP API route | high | 5639 B / 143 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/members/route.ts` | HTTP API route | high | 837 B / 21 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/operations/dashboard/route.ts` | HTTP API route | high | 1139 B / 22 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/operations/my-queue/route.ts` | HTTP API route | high | 956 B / 27 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/operations/overview/route.ts` | HTTP API route | high | 638 B / 18 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/operations/referral-worklist/route.ts` | HTTP API route | high | 628 B / 17 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/operations/supervisor-queue/route.ts` | HTTP API route | high | 691 B / 17 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/packets/[packetId]/evidence/[fieldKey]/route.ts` | HTTP API route | high | 2550 B / 49 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/packets/[packetId]/fields/[fieldKey]/retry/route.ts` | HTTP API route | high | 2121 B / 56 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/packets/[packetId]/fields/[fieldKey]/review/route.ts` | HTTP API route | high | 2128 B / 56 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/packets/[packetId]/fields/route.ts` | HTTP API route | high | 1110 B / 31 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/packets/[packetId]/status/route.ts` | HTTP API route | high | 1110 B / 31 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/profiles/[residentKey]/route.ts` | HTTP API route | high | 2074 B / 58 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/profiles/[residentKey]/source-documents/[documentId]/preview/route.ts` | HTTP API route | high | 1307 B / 37 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/profiles/[residentKey]/source-documents/[documentId]/thumbnail/route.ts` | HTTP API route | high | 1308 B / 37 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/profiles/directory/route.ts` | HTTP API route | high | 6350 B / 175 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/activity/route.ts` | HTTP API route | high | 1399 B / 31 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/assessments/import/route.ts` | HTTP API route | high | 4745 B / 101 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/assessments/route.ts` | HTTP API route | high | 5439 B / 124 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/assessments/sync-packet/route.ts` | HTTP API route | high | 6538 B / 150 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/canvas/route.ts` | HTTP API route | high | 1562 B / 41 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/census-reconciliation/route.ts` | HTTP API route | high | 3496 B / 79 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/changes/route.ts` | HTTP API route | high | 2136 B / 50 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/decision/route.ts` | HTTP API route | high | 5073 B / 105 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/ehr-handoff/route.ts` | HTTP API route | high | 4045 B / 91 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/manual-intake/route.ts` | HTTP API route | high | 3418 B / 71 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/packet/route.ts` | HTTP API route | high | 1863 B / 41 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/presence/route.ts` | HTTP API route | high | 4570 B / 104 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/progress/route.ts` | HTTP API route | high | 1492 B / 35 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/recommendation/route.ts` | HTTP API route | high | 4864 B / 81 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/route.ts` | HTTP API route | high | 12652 B / 301 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/transition/route.ts` | HTTP API route | high | 3324 B / 76 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/work-items/[workItemId]/route.ts` | HTTP API route | high | 5710 B / 125 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/[referralId]/work-items/route.ts` | HTTP API route | high | 1425 B / 31 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/changes/route.ts` | HTTP API route | high | 1153 B / 26 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/directory/route.ts` | HTTP API route | high | 2116 B / 56 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/facets/route.ts` | HTTP API route | high | 1420 B / 33 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/referrals/route.ts` | HTTP API route | high | 8954 B / 234 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/resident-links/[linkId]/route.ts` | HTTP API route | high | 3692 B / 94 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/resident-links/route.ts` | HTTP API route | high | 7215 B / 161 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/search/route.ts` | HTTP API route | high | 8189 B / 276 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/training/progress/route.ts` | HTTP API route | high | 2771 B / 49 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/trash/referrals/[referralId]/restore/route.ts` | HTTP API route | high | 2087 B / 40 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/trash/referrals/route.ts` | HTTP API route | high | 923 B / 20 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/uploads/complete/route.ts` | HTTP API route | critical | 2085 B / 55 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/uploads/create-url/route.ts` | HTTP API route | critical | 1731 B / 41 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/api/uploads/local/route.ts` | HTTP API route | critical | 2870 B / 68 lines | Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs. | check:api + check:route-policy + targeted E2E |
| `app/desktop-manifest.webmanifest/route.ts` | Next.js route or application shell | low | 1243 B / 49 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/fonts/GEIST-LICENSE.txt` | Next.js route or application shell | low | 4368 B / 93 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | typecheck + lint + build + responsive/accessibility E2E |
| `app/fonts/README.md` | Next.js route or application shell | low | 406 B / 9 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/fonts/geist-latin.woff2` | Next.js route or application shell | low | 28356 B / binary | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/globals.css` | Next.js route or application shell | low | 2328 B / 138 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/icon.svg` | Next.js route or application shell | low | 297 B / 9 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | typecheck + lint + build + responsive/accessibility E2E |
| `app/layout.tsx` | Next.js route or application shell | low | 1234 B / 41 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/not-found.tsx` | Next.js route or application shell | low | 528 B / 15 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `app/sign-in/page.tsx` | Next.js route or application shell | low | 518 B / 20 lines | Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `components/auth/AuthenticationBrand.tsx` | Authentication UI | low | 1174 B / 33 lines | Check redirect loops, session restoration, account switching, keyboard access, and protected-content flashes. | check:security + authentication E2E |
| `components/auth/AuthenticationProgress.tsx` | Authentication UI | low | 2112 B / 46 lines | Check redirect loops, session restoration, account switching, keyboard access, and protected-content flashes. | check:security + authentication E2E |
| `components/auth/PipelineAuthProvider.tsx` | Authentication UI | low | 9699 B / 275 lines | Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. | check:security + authentication E2E |
| `components/auth/PipelineSignIn.tsx` | Authentication UI | low | 3182 B / 65 lines | Check redirect loops, session restoration, account switching, keyboard access, and protected-content flashes. | check:security + authentication E2E |
| `components/desktop/DesktopRuntime.tsx` | Shared user interface | low | 2137 B / 74 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/AssessmentWorkspace.tsx` | Pipeline user interface | medium | 88234 B / 1642 lines | Large module (1642 lines): split by behavior before adding more responsibilities. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ClientAssessmentSummary.tsx` | Pipeline user interface | medium | 4343 B / 89 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ClientProfileDirectory.tsx` | Pipeline user interface | medium | 28145 B / 622 lines | Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ClientProfileView.tsx` | Pipeline user interface | medium | 70806 B / 1552 lines | Large module (1552 lines): split by behavior before adding more responsibilities. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/DeleteWorkspaceDialog.tsx` | Pipeline user interface | medium | 1590 B / 43 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/OperationsDashboard.tsx` | Pipeline user interface | medium | 22655 B / 507 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PacketExtractionReview.tsx` | Pipeline user interface | medium | 14950 B / 334 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineActionNav.tsx` | Pipeline user interface | medium | 6970 B / 176 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineAppShell.tsx` | Pipeline user interface | medium | 1102 B / 30 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineCalendar.tsx` | Pipeline user interface | medium | 23794 B / 398 lines | Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineDeveloperAcademy.tsx` | Pipeline user interface | medium | 15759 B / 325 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineHeader.tsx` | Pipeline user interface | medium | 14527 B / 271 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineLogoMark.tsx` | Pipeline user interface | medium | 679 B / 31 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineOperatorAcademy.tsx` | Pipeline user interface | medium | 16966 B / 238 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineOverviewRoute.tsx` | Pipeline user interface | medium | 9854 B / 280 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineSearchPanel.tsx` | Pipeline user interface | medium | 16908 B / 475 lines | Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineTrash.tsx` | Pipeline user interface | medium | 5689 B / 95 lines | Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/PipelineWelcome.tsx` | Pipeline user interface | medium | 19144 B / 476 lines | Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ReferralActivityPanel.tsx` | Pipeline user interface | medium | 6829 B / 171 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ReferralFilePreviewDialog.tsx` | Pipeline user interface | medium | 9047 B / 204 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ReferralHome.tsx` | Pipeline user interface | medium | 51800 B / 1086 lines | Large module (1086 lines): split by behavior before adding more responsibilities. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ReferralPacketCanvas.tsx` | Pipeline user interface | medium | 109506 B / 2657 lines | Large module (2657 lines): split by behavior before adding more responsibilities. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ReferralProgressPanel.tsx` | Pipeline user interface | medium | 5477 B / 112 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ReferralWorkflowTracker.tsx` | Pipeline user interface | medium | 7527 B / 192 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/ReferralWorklist.tsx` | Pipeline user interface | medium | 9459 B / 210 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/StructuredNarrativeField.tsx` | Pipeline user interface | medium | 7937 B / 184 lines | Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/academy/AcademyCurriculumView.tsx` | Pipeline user interface | medium | 20368 B / 295 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/academy/AcademyJourneyLibrary.tsx` | Pipeline user interface | medium | 6267 B / 93 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/academy/AcademyLabsView.tsx` | Pipeline user interface | medium | 8501 B / 142 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/academy/AcademyMasteryView.tsx` | Pipeline user interface | medium | 8520 B / 109 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/academy/AcademyRepositoryAtlas.tsx` | Pipeline user interface | medium | 8746 B / 161 lines | Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/pipeline-shell-context.tsx` | Pipeline user interface | medium | 929 B / 41 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/training/OperatorCertification.tsx` | Pipeline user interface | medium | 6770 B / 39 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/training/OperatorCurriculumView.tsx` | Pipeline user interface | medium | 20109 B / 135 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/training/OperatorGuidedTours.tsx` | Pipeline user interface | medium | 4337 B / 37 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/training/OperatorJobAids.tsx` | Pipeline user interface | medium | 3286 B / 33 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/training/OperatorPracticeLab.tsx` | Pipeline user interface | medium | 8523 B / 68 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/training/OperatorProductMap.tsx` | Pipeline user interface | medium | 2325 B / 26 lines | Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions. | typecheck + lint + build + responsive/accessibility E2E |
| `components/pipeline/training/PipelineGuidedCoach.tsx` | Pipeline user interface | medium | 32794 B / 496 lines | Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. | typecheck + lint + build + responsive/accessibility E2E |
| `config/provisional-workspace-members.json` | Repository support file | low | 1554 B / 55 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `database/fixtures/integration.sql` | Database fixture or manifest | low | 4080 B / 81 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `database/migration-checksums.json` | Database fixture or manifest | low | 2069 B / 26 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `database/migrations/0001_pipeline_core.sql` | Forward database migration | critical | 13797 B / 333 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0002_workflow_engine.sql` | Forward database migration | critical | 852 B / 31 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0003_operational_hardening.sql` | Forward database migration | critical | 2433 B / 57 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0004_document_processing.sql` | Forward database migration | critical | 7290 B / 165 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0005_collaboration.sql` | Forward database migration | critical | 1442 B / 45 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0006_user_workspace_state.sql` | Forward database migration | critical | 1024 B / 29 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0007_canonical_client_assessments.sql` | Forward database migration | critical | 1834 B / 46 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0008_client_workspaces.sql` | Forward database migration | critical | 6636 B / 150 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0009_assessment_collaboration.sql` | Forward database migration | critical | 2427 B / 67 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0010_provisional_workspace_members.sql` | Forward database migration | critical | 2268 B / 65 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0011_historical_material_workspaces.sql` | Forward database migration | critical | 3631 B / 82 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0012_referral_trash.sql` | Forward database migration | critical | 1166 B / 37 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0013_search_performance.sql` | Forward database migration | critical | 1939 B / 55 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0014_workspace_county.sql` | Forward database migration | critical | 3649 B / 78 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0015_assessor_workflow.sql` | Forward database migration | critical | 9814 B / 209 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0016_zoom_assessment_method.sql` | Forward database migration | critical | 449 B / 15 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0017_referral_received_month.sql` | Forward database migration | critical | 472 B / 14 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0018_academy_progress.sql` | Forward database migration | critical | 476 B / 19 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/migrations/0019_operator_training_progress.sql` | Forward database migration | critical | 520 B / 20 lines | Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0005_collaboration.sql` | Database rollback | high | 364 B / 6 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0006_user_workspace_state.sql` | Database rollback | high | 277 B / 5 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0007_canonical_client_assessments.sql` | Database rollback | high | 294 B / 5 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0008_client_workspaces.sql` | Database rollback | high | 1395 B / 31 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0009_assessment_collaboration.sql` | Database rollback | high | 958 B / 23 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0010_provisional_workspace_members.sql` | Database rollback | high | 905 B / 24 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0011_historical_material_workspaces.sql` | Database rollback | high | 1325 B / 30 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0012_referral_trash.sql` | Database rollback | high | 449 B / 13 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0013_search_performance.sql` | Database rollback | high | 754 B / 25 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0014_workspace_county.sql` | Database rollback | high | 206 B / 4 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0015_assessor_workflow.sql` | Database rollback | high | 2463 B / 59 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0016_zoom_assessment_method.sql` | Database rollback | high | 476 B / 14 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0017_referral_received_month.sql` | Database rollback | high | 157 B / 5 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0018_academy_progress.sql` | Database rollback | high | 460 B / 12 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `database/rollbacks/0019_operator_training_progress.sql` | Database rollback | high | 500 B / 12 lines | Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path. | check:database + database:fixtures + rollback/query-plan drill |
| `databricks.yml` | Build, runtime, or repository configuration | low | 2731 B / 77 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `databricks/pipeline_extraction_worker.py` | Databricks worker | low | 31157 B / 782 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:extraction + check:extraction-worker + sample packet |
| `docs/ABUSE_AND_ALERTING.md` | Documentation or runbook | low | 3356 B / 69 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/ALAMO_ADMISSIONS_ZONE.md` | Documentation or runbook | low | 2027 B / 50 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/ARCHITECTURE.md` | Documentation or runbook | low | 5831 B / 73 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/ASSESSMENT_NOTE_GUIDE.md` | Documentation or runbook | low | 1545 B / 31 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/ASSESSMENT_TOOL_DATA_MODEL.md` | Documentation or runbook | low | 7526 B / 146 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/ASSESSOR_WORKFLOW_48_HOUR_EXECUTION_SPINE.md` | Documentation or runbook | low | 31597 B / 572 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/AZURE_DATABRICKS_BACKEND_SETUP.md` | Documentation or runbook | low | 6538 B / 157 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/AZURE_DEPLOYMENT_STATE.md` | Documentation or runbook | low | 8156 B / 179 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/AZURE_INPUT_HANDOFF.md` | Documentation or runbook | low | 3338 B / 70 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/AZURE_PRODUCTION_SETUP.md` | Documentation or runbook | low | 16967 B / 364 lines | Uses SELECT *; verify response growth, schema coupling, and PHI minimization. | link/config drift review against executable source |
| `docs/BUILD_BACKLOG.md` | Documentation or runbook | low | 2265 B / 41 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/CLIENT_FILE_IMPORT.md` | Documentation or runbook | low | 4643 B / 69 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/CLINICAL_DATA_INTEGRATION.md` | Documentation or runbook | low | 12743 B / 282 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/COLLABORATION_CONCURRENCY.md` | Documentation or runbook | low | 2128 B / 46 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/COMPLETE_REPOSITORY_AUDIT_2026-08-22.md` | Documentation or runbook | medium | 229547 B / 1246 lines | Large module (1246 lines): split by behavior before adding more responsibilities. | link/config drift review against executable source |
| `docs/CONSTRAINTS.md` | Documentation or runbook | low | 1198 B / 27 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/CURRENT_TASK.md` | Documentation or runbook | low | 10290 B / 164 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/DATABASE_ASSURANCE.md` | Documentation or runbook | low | 5887 B / 127 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/DATABASE_RECOVERY.md` | Documentation or runbook | low | 3914 B / 83 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/DESKTOP_DISTRIBUTION.md` | Documentation or runbook | low | 6552 B / 135 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/DOCUMENT_PROCESSING_RUNBOOK.md` | Documentation or runbook | low | 3069 B / 59 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/ENGINEERING_COMPLETION_REPORT.md` | Documentation or runbook | low | 10948 B / 263 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/ENGINEERING_DATA_ARCHITECTURE.md` | Documentation or runbook | low | 10283 B / 204 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/ENTRA_AUTHENTICATION.md` | Documentation or runbook | low | 7380 B / 124 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | link/config drift review against executable source |
| `docs/EXTRACTION_STACK_IMPLEMENTATION_CHECKLIST.md` | Documentation or runbook | low | 6022 B / 155 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/EXTREME_TESTING_PROTOCOL.md` | Documentation or runbook | low | 6459 B / 130 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/FILE_MAP.md` | Documentation or runbook | low | 19536 B / 177 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/LIVE_ACCESS_REHEARSAL.md` | Documentation or runbook | low | 1795 B / 40 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/MCMASTER_CERTIFICATION_2026-08-20.md` | Documentation or runbook | low | 4179 B / 87 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/OPERATIONAL_TESTING_STRATEGY.md` | Documentation or runbook | low | 15221 B / 197 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PERFORMANCE_BASELINE_2026-08-20.md` | Documentation or runbook | low | 4148 B / 85 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PIPELINE_V1_SPEC.md` | Documentation or runbook | low | 12029 B / 301 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PLATFORM_ASSURANCE_100.md` | Documentation or runbook | low | 6752 B / 117 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/POSTGRES_DEPLOYMENT.md` | Documentation or runbook | low | 4193 B / 85 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PRODUCTION_ACCEPTANCE_CHECKLIST.md` | Documentation or runbook | low | 4989 B / 80 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PRODUCTION_BASELINE_2026-08-19.md` | Documentation or runbook | low | 9725 B / 226 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PRODUCTION_DATA_OPERATIONS.md` | Documentation or runbook | low | 8295 B / 175 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | link/config drift review against executable source |
| `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` | Documentation or runbook | low | 1735 B / 38 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PRODUCTION_HARDENING_AUDIT.md` | Documentation or runbook | low | 4824 B / 80 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PRODUCTION_OPERATIONS_HANDOFF.md` | Documentation or runbook | low | 4769 B / 82 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PRODUCTION_READINESS.md` | Documentation or runbook | low | 5896 B / 84 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PRODUCT_DEMO_RUNBOOK.md` | Documentation or runbook | low | 3190 B / 71 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/PRODUCT_TENETS.md` | Documentation or runbook | low | 7482 B / 160 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/REFACTORING_PLAYBOOK.md` | Documentation or runbook | low | 14689 B / 241 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/REFERRAL_OPERATING_RELIABILITY_PLAN.md` | Documentation or runbook | low | 7256 B / 212 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/REFERRAL_PACKET_EXTRACTION_BUILD_SPEC.md` | Documentation or runbook | low | 24714 B / 717 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/REFERRAL_PACKET_INGESTION_RUNBOOK.md` | Documentation or runbook | low | 6707 B / 187 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/REFERRAL_WORK_QUEUE_DESIGN.md` | Documentation or runbook | low | 3667 B / 86 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/RELEASE_OPERATIONS.md` | Documentation or runbook | low | 2662 B / 44 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/RETENTION_POLICY.md` | Documentation or runbook | low | 793 B / 14 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/SPRING_CLEANING_AUDIT_2026-08-22.md` | Documentation or runbook | low | 17674 B / 290 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/SUPPLY_CHAIN_AND_RELEASE_EVIDENCE.md` | Documentation or runbook | low | 2655 B / 53 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/TEST_EFFECTIVENESS_AND_CORPUS.md` | Documentation or runbook | low | 2910 B / 77 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/WORKFLOW_BUILD_QUEUE.md` | Documentation or runbook | low | 10440 B / 170 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/WORKSPACE_MEMBER_IDENTITY.md` | Documentation or runbook | low | 2124 B / 50 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/academy/ARCHITECTURE_GUIDE.md` | Documentation or runbook | low | 10181 B / 173 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/academy/CHANGE_DOSSIER_TEMPLATE.md` | Documentation or runbook | low | 1825 B / 84 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/academy/CURRICULUM.md` | Documentation or runbook | low | 5710 B / 88 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/academy/ENTERPRISE_ACADEMY_STANDARD.md` | Documentation or runbook | low | 3987 B / 63 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/academy/README.md` | Documentation or runbook | low | 4199 B / 74 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/academy/WORKBOOK.md` | Documentation or runbook | low | 3652 B / 137 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/academy/academy-registry.json` | Documentation or runbook | low | 1061 B / 37 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/academy/lessons/01_CREATE_REFERRAL.md` | Documentation or runbook | low | 13695 B / 269 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/ADAPTER_PARITY_CONTRACT.md` | Documentation or runbook | low | 2467 B / 44 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/ARCHITECTURE_NARRATIVE_TEMPLATE.md` | Documentation or runbook | low | 1634 B / 80 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/AUTHORIZATION_CHARACTERIZATION_PLAN.md` | Documentation or runbook | low | 1997 B / 45 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/CLOUD_REFACTOR_RUNBOOK.md` | Documentation or runbook | low | 5724 B / 98 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/CODE_QUALITY_POLICY.md` | Documentation or runbook | low | 4634 B / 65 lines | Contains unsafe type escape; replace with validation or a narrow type. | link/config drift review against executable source |
| `docs/refactoring/COMPATIBILITY_MATRIX.md` | Documentation or runbook | low | 2804 B / 29 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/CONTROL_PLANE_MAP.md` | Documentation or runbook | low | 5764 B / 92 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/CYCLOMATIC_COMPLEXITY_POLICY.md` | Documentation or runbook | low | 3199 B / 67 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/DECISION_RECORD_TEMPLATE.md` | Documentation or runbook | low | 948 B / 51 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/OWNERSHIP_AND_BRANCH_PROTECTION.md` | Documentation or runbook | low | 2642 B / 54 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/README.md` | Documentation or runbook | low | 5316 B / 105 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/REFACTOR_SLICE_TEMPLATE.md` | Documentation or runbook | low | 1554 B / 75 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/SHADOW_COMPARISON_CONTRACT.md` | Documentation or runbook | low | 1920 B / 43 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/WORKTREE_RUNBOOK.md` | Documentation or runbook | low | 2214 B / 42 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/characterization-manifest.example.json` | Documentation or runbook | low | 1059 B / 31 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/code-quality-policy.json` | Documentation or runbook | low | 2053 B / 57 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/evidence-matrix.json` | Documentation or runbook | low | 12945 B / 304 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/file-audit-disposition.example.json` | Documentation or runbook | low | 1310 B / 33 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/performance-budgets.json` | Documentation or runbook | low | 2206 B / 73 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/refactoring/refactor-slices.json` | Documentation or runbook | low | 5558 B / 161 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/reliability/complete-repository-audit-latest.md` | Generated audit evidence | medium | 284178 B / 1445 lines | Do not edit manually; regenerate and verify that inventory counts match the current worktree. | regenerate with npm run audit:repository |
| `docs/reliability/cyclomatic-complexity-baseline.json` | Documentation or runbook | medium | 2070816 B / 60929 lines | Large module (60929 lines): split by behavior before adding more responsibilities. | link/config drift review against executable source |
| `docs/reliability/dependency-inventory.json` | Generated audit evidence | medium | 205885 B / 7319 lines | Do not edit manually; regenerate and verify that inventory counts match the current worktree. | regenerate with npm run audit:repository |
| `docs/reliability/refactor-baseline-2026-08-27-setup.json` | Documentation or runbook | medium | 285515 B / 10598 lines | Large module (10598 lines): split by behavior before adding more responsibilities. | link/config drift review against executable source |
| `docs/reliability/refactor-baseline-2026-08-27-setup.md` | Documentation or runbook | low | 4783 B / 108 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/reliability/refactor-baseline-2026-08-27.json` | Documentation or runbook | medium | 284013 B / 10538 lines | Large module (10538 lines): split by behavior before adding more responsibilities. | link/config drift review against executable source |
| `docs/reliability/refactor-baseline-2026-08-27.md` | Documentation or runbook | low | 4777 B / 108 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/reliability/repository-file-inventory.json` | Generated audit evidence | medium | 367784 B / 7428 lines | Do not edit manually; regenerate and verify that inventory counts match the current worktree. | regenerate with npm run audit:repository |
| `docs/training/CHANGE_GOVERNANCE.md` | Documentation or runbook | low | 1802 B / 35 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/training/CURRICULUM.md` | Documentation or runbook | low | 2175 B / 50 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/training/README.md` | Documentation or runbook | low | 3069 B / 55 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/training/SUPERVISOR_SIGNOFF.md` | Documentation or runbook | low | 1054 B / 24 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `docs/training/training-registry.json` | Documentation or runbook | low | 657 B / 21 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |
| `eslint.config.mjs` | Build, runtime, or repository configuration | low | 483 B / 20 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `infra/azure/README.md` | Azure infrastructure as code | critical | 1826 B / 37 lines | Check least-privilege RBAC, secret references, private networking, retention/backup, resource names, cost defaults, and what-if output. | check:infrastructure + Azure what-if |
| `infra/azure/foundation-state.bicep` | Azure infrastructure as code | critical | 4164 B / 97 lines | Check least-privilege RBAC, secret references, private networking, retention/backup, resource names, cost defaults, and what-if output. | check:infrastructure + Azure what-if |
| `infra/azure/main.bicep` | Azure infrastructure as code | critical | 16604 B / 509 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:infrastructure + Azure what-if |
| `infra/azure/main.parameters.example.json` | Azure infrastructure as code | critical | 920 B / 21 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:infrastructure + Azure what-if |
| `infra/azure/operational-alerts.bicep` | Azure infrastructure as code | critical | 12055 B / 378 lines | Check least-privilege RBAC, secret references, private networking, retention/backup, resource names, cost defaults, and what-if output. | check:infrastructure + Azure what-if |
| `infra/azure/runtime.bicep` | Azure infrastructure as code | critical | 19747 B / 595 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:infrastructure + Azure what-if |
| `instrumentation.ts` | Build, runtime, or repository configuration | critical | 497 B / 20 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `lib/academy/academy-access-policy.ts` | Shared server/domain library | low | 1552 B / 65 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/academy/academy-access.ts` | Shared server/domain library | low | 1395 B / 47 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `lib/academy/academy-atlas.generated.json` | Shared server/domain library | medium | 195332 B / 7671 lines | Large module (7671 lines): split by behavior before adding more responsibilities. | check:platform:fast and owning feature test |
| `lib/academy/academy-curriculum.ts` | Shared server/domain library | medium | 97737 B / 1448 lines | Large module (1448 lines): split by behavior before adding more responsibilities. | check:platform:fast and owning feature test |
| `lib/academy/academy-journeys.ts` | Shared server/domain library | low | 14734 B / 150 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/academy/academy-progress-contract.ts` | Shared server/domain library | low | 6394 B / 178 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/academy/academy-progress-store.ts` | Shared server/domain library | low | 3067 B / 114 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/academy/academy-progress.ts` | Shared server/domain library | low | 3398 B / 74 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/academy/academy-types.ts` | Shared server/domain library | low | 2948 B / 144 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-access.ts` | Assessment domain | medium | 865 B / 23 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-client-identity.ts` | Assessment domain | medium | 2493 B / 82 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-completion.ts` | Assessment domain | medium | 2866 B / 78 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-field-ownership.ts` | Assessment domain | medium | 964 B / 36 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-file-parser.ts` | Assessment domain | medium | 15602 B / 391 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-interview-schema.ts` | Assessment domain | medium | 26792 B / 412 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-lifecycle-validation.ts` | Assessment domain | medium | 5084 B / 121 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-note-guide.ts` | Assessment domain | medium | 8721 B / 161 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-records.ts` | Assessment domain | medium | 4770 B / 165 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-sections.ts` | Assessment domain | medium | 1804 B / 48 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-seed.ts` | Assessment domain | medium | 5465 B / 138 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-store.ts` | Assessment domain | medium | 81620 B / 2074 lines | Large module (2074 lines): split by behavior before adding more responsibilities. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-tool-schema.ts` | Assessment domain | medium | 42376 B / 917 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-validation.ts` | Assessment domain | medium | 13373 B / 300 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/assessment/assessment-workbook-contract.ts` | Assessment domain | medium | 491 B / 18 lines | Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history. | check:platform:fast and owning feature test |
| `lib/auth/authenticated-fetch.ts` | Authentication and request security | critical | 8112 B / 244 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | check:security + authentication E2E |
| `lib/auth/browser-session.ts` | Authentication and request security | critical | 3708 B / 127 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | check:security + authentication E2E |
| `lib/auth/entra-client.ts` | Authentication and request security | critical | 4400 B / 123 lines | Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies. | check:security + authentication E2E |
| `lib/auth/internal-worker-auth.ts` | Authentication and request security | critical | 771 B / 22 lines | Check issuer/audience/tenant/role validation, cookie and CSRF rules, redirect allowlists, fail-closed defaults, and secret-safe logs. | check:security + authentication E2E |
| `lib/auth/pipeline-auth.ts` | Authentication and request security | critical | 17300 B / 521 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:security + authentication E2E |
| `lib/auth/post-login-path.ts` | Authentication and request security | critical | 1000 B / 36 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | check:security + authentication E2E |
| `lib/auth/request-security.ts` | Authentication and request security | critical | 1525 B / 52 lines | Check issuer/audience/tenant/role validation, cookie and CSRF rules, redirect allowlists, fail-closed defaults, and secret-safe logs. | check:security + authentication E2E |
| `lib/clinical/client-document-identifiers.ts` | Governed clinical adapter | high | 726 B / 25 lines | Check server-only credentials, exact endpoint allowlist, pagination/staleness, response-size limits, identity joins, and fail-closed outages. | check:clinical + check:security |
| `lib/clinical/clinical-contracts.ts` | Governed clinical adapter | high | 31275 B / 805 lines | Check server-only credentials, exact endpoint allowlist, pagination/staleness, response-size limits, identity joins, and fail-closed outages. | check:clinical + check:security |
| `lib/clinical/clinical-data.ts` | Governed clinical adapter | high | 31470 B / 832 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:clinical + check:security |
| `lib/clinical/clinical-value-presentation.ts` | Governed clinical adapter | high | 8607 B / 253 lines | Check server-only credentials, exact endpoint allowlist, pagination/staleness, response-size limits, identity joins, and fail-closed outages. | check:clinical + check:security |
| `lib/clinical/demo-clinical-data.ts` | Governed clinical adapter | high | 12845 B / 414 lines | Check server-only credentials, exact endpoint allowlist, pagination/staleness, response-size limits, identity joins, and fail-closed outages. | check:clinical + check:security |
| `lib/database/pipeline-database.ts` | Database access | critical | 3833 B / 111 lines | Check parameterization, transaction and lock scope, statement timeouts, optimistic versions, pool lifecycle, pagination, and retry safety. | check:database + database:fixtures + rollback/query-plan drill |
| `lib/desktop/desktop-config.ts` | Shared server/domain library | low | 470 B / 11 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/desktop/desktop-server-config.ts` | Shared server/domain library | low | 139 B / 6 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/extraction/azure-blob.ts` | Document ingestion and extraction | high | 7870 B / 216 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/backend-config.ts` | Document ingestion and extraction | high | 2658 B / 89 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/blob-paths.ts` | Document ingestion and extraction | high | 731 B / 16 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/contracts.ts` | Document ingestion and extraction | high | 11527 B / 430 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/databricks.ts` | Document ingestion and extraction | high | 8077 B / 216 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/document-assets.ts` | Document ingestion and extraction | high | 15702 B / 409 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/document-processing-error.ts` | Document ingestion and extraction | high | 278 B / 11 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/document-processing.ts` | Document ingestion and extraction | high | 27802 B / 646 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/durable-upload-reconciliation.ts` | Document ingestion and extraction | high | 1416 B / 40 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/extraction-service.ts` | Document ingestion and extraction | high | 9147 B / 272 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/extraction-state.ts` | Document ingestion and extraction | high | 1426 B / 45 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/http-byte-range.ts` | Document ingestion and extraction | high | 613 B / 16 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/local-packet-evidence.ts` | Document ingestion and extraction | high | 2178 B / 58 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/local-packet-ingestion.ts` | Document ingestion and extraction | high | 20448 B / 525 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/mock-store.ts` | Document ingestion and extraction | high | 15219 B / 507 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/packet-referral.ts` | Document ingestion and extraction | high | 1395 B / 39 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/processing-worker.ts` | Document ingestion and extraction | high | 27856 B / 591 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/referral-intake-schema.ts` | Document ingestion and extraction | high | 26915 B / 837 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/storage-inventory.ts` | Document ingestion and extraction | high | 5147 B / 131 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/extraction/worker-report-validation.ts` | Document ingestion and extraction | high | 5756 B / 133 lines | Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior. | check:extraction + check:extraction-worker + sample packet |
| `lib/integration/client-update-contracts.ts` | Shared server/domain library | low | 2232 B / 65 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/integration/client-update-outbox.ts` | Shared server/domain library | low | 2337 B / 66 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/observability/api-logging.ts` | PHI-safe observability | low | 3758 B / 148 lines | Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies. | check:platform:fast and owning feature test |
| `lib/observability/metric-contract.ts` | PHI-safe observability | low | 1099 B / 48 lines | Check low-cardinality dimensions, no IDs/names/query strings/tokens/upstream bodies, bounded values, and metric failure isolation. | check:platform:fast and owning feature test |
| `lib/observability/pipeline-metrics.ts` | PHI-safe observability | low | 383 B / 14 lines | Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies. | check:platform:fast and owning feature test |
| `lib/offline/offline-assessment-store.ts` | Shared server/domain library | low | 10470 B / 270 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/persistence/store-adapter.ts` | Shared server/domain library | low | 692 B / 28 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/pipeline/assessment-calendar.ts` | Pipeline domain | medium | 5720 B / 143 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/base-path.ts` | Pipeline domain | medium | 455 B / 18 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/calendar-store.ts` | Pipeline domain | medium | 10477 B / 260 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/calendar-types.ts` | Pipeline domain | medium | 1185 B / 46 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/client-file-import-contracts.ts` | Pipeline domain | medium | 954 B / 31 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/client-file-import-store.ts` | Pipeline domain | medium | 9106 B / 234 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/client-history-contracts.ts` | Pipeline domain | medium | 1040 B / 35 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/client-history-store.ts` | Pipeline domain | medium | 10626 B / 297 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/client-navigation.ts` | Pipeline domain | medium | 1221 B / 42 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/client-profile-presentation.ts` | Pipeline domain | medium | 14344 B / 287 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/client-workspace-contracts.ts` | Pipeline domain | medium | 623 B / 24 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/client-workspace-store.ts` | Pipeline domain | medium | 14482 B / 369 lines | Uses SELECT *; verify response growth, schema coupling, and PHI minimization. | check:platform:fast and owning feature test |
| `lib/pipeline/clinical-backlog-reconciliation.ts` | Pipeline domain | medium | 8002 B / 230 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/collaboration-types.ts` | Pipeline domain | medium | 513 B / 20 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/community-config.ts` | Pipeline domain | medium | 1377 B / 44 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/document-requirement-reconciliation.ts` | Pipeline domain | medium | 1932 B / 51 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/document-requirements.ts` | Pipeline domain | medium | 1105 B / 28 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/editing-presence.ts` | Pipeline domain | medium | 6224 B / 173 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/fuzzy-search.ts` | Pipeline domain | medium | 1399 B / 47 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/home-state.ts` | Pipeline domain | medium | 416 B / 11 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/keyset-cursor.ts` | Pipeline domain | medium | 1577 B / 43 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/known-users.ts` | Pipeline domain | medium | 2421 B / 68 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/local-document-store.ts` | Pipeline domain | medium | 5199 B / 144 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/master-record-matching.ts` | Pipeline domain | medium | 5440 B / 172 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/operations-snapshot.ts` | Pipeline domain | medium | 32122 B / 787 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/operations-types.ts` | Pipeline domain | medium | 4741 B / 191 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/recent-destinations.ts` | Pipeline domain | medium | 3277 B / 91 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-access.ts` | Pipeline domain | medium | 3338 B / 91 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-activity.ts` | Pipeline domain | medium | 9929 B / 260 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-canvas-extraction.ts` | Pipeline domain | medium | 7717 B / 201 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-canvas-persistence.ts` | Pipeline domain | medium | 5100 B / 152 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-clinical-reconciliation.ts` | Pipeline domain | medium | 3750 B / 110 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-draft-recovery.ts` | Pipeline domain | medium | 2899 B / 77 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-ownership.ts` | Pipeline domain | medium | 1043 B / 31 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-packet-upload.ts` | Pipeline domain | medium | 6188 B / 182 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-progress.ts` | Pipeline domain | medium | 11417 B / 314 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-query.ts` | Pipeline domain | medium | 5457 B / 129 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-retention.ts` | Pipeline domain | medium | 3688 B / 89 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-review.ts` | Pipeline domain | medium | 1268 B / 55 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-sections.ts` | Pipeline domain | medium | 2885 B / 99 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-sort-cursor.ts` | Pipeline domain | medium | 1824 B / 63 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-sort.ts` | Pipeline domain | medium | 336 B / 15 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-store.ts` | Pipeline domain | medium | 104023 B / 2692 lines | Large module (2692 lines): split by behavior before adding more responsibilities. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-types.ts` | Pipeline domain | medium | 8417 B / 296 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-validation.ts` | Pipeline domain | medium | 19861 B / 526 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-workflow.ts` | Pipeline domain | medium | 9833 B / 298 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/referral-worklist-filter.ts` | Pipeline domain | medium | 2507 B / 64 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/resident-link-records.ts` | Pipeline domain | medium | 1772 B / 68 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/resident-link-store.ts` | Pipeline domain | medium | 27103 B / 739 lines | Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies. | check:platform:fast and owning feature test |
| `lib/pipeline/resident-link-validation.ts` | Pipeline domain | medium | 6440 B / 154 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/site-search.ts` | Pipeline domain | medium | 2756 B / 82 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/structured-narrative.ts` | Pipeline domain | medium | 3270 B / 65 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/unified-profile-contracts.ts` | Pipeline domain | medium | 1992 B / 62 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/unified-profile.ts` | Pipeline domain | medium | 27367 B / 739 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/user-workspace-state-client.ts` | Pipeline domain | medium | 265 B / 9 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/user-workspace-state-store.ts` | Pipeline domain | medium | 16656 B / 461 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | check:platform:fast and owning feature test |
| `lib/pipeline/user-workspace-state-types.ts` | Pipeline domain | medium | 9512 B / 225 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/workflow-records.ts` | Pipeline domain | medium | 6995 B / 231 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/workflow-status.ts` | Pipeline domain | medium | 3895 B / 99 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/workflow-store.ts` | Pipeline domain | medium | 48199 B / 1184 lines | Large module (1184 lines): split by behavior before adding more responsibilities. | check:platform:fast and owning feature test |
| `lib/pipeline/workspace-members.ts` | Pipeline domain | medium | 5621 B / 152 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/pipeline/workspace-presentation.ts` | Pipeline domain | medium | 6090 B / 223 lines | Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records. | check:platform:fast and owning feature test |
| `lib/reliability/referral-operating-model.ts` | Shared server/domain library | low | 18440 B / 659 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/reliability/request-governor.ts` | Shared server/domain library | low | 4224 B / 127 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/training/operator-guided-tour-state.ts` | Shared server/domain library | low | 5753 B / 134 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/training/operator-guided-tutorials.ts` | Shared server/domain library | low | 19958 B / 168 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/training/operator-training-access.ts` | Shared server/domain library | low | 771 B / 18 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `lib/training/operator-training-curriculum.ts` | Shared server/domain library | low | 55578 B / 214 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/training/operator-training-progress-contract.ts` | Shared server/domain library | low | 10472 B / 258 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/training/operator-training-progress-store.ts` | Shared server/domain library | low | 3003 B / 72 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/training/operator-training-progress.ts` | Shared server/domain library | low | 3315 B / 66 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/training/operator-training-resources.ts` | Shared server/domain library | low | 18917 B / 125 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `lib/training/operator-training-types.ts` | Shared server/domain library | low | 2941 B / 128 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `next.config.ts` | Build, runtime, or repository configuration | low | 3097 B / 77 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `package-lock.json` | Build, runtime, or repository configuration | medium | 276955 B / 7956 lines | Large module (7956 lines): split by behavior before adding more responsibilities. | check:platform:fast and owning feature test |
| `package.json` | Build, runtime, or repository configuration | low | 13602 B / 198 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `playwright.config.ts` | Build, runtime, or repository configuration | low | 4165 B / 98 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `playwright.operational.config.ts` | Repository support file | low | 2604 B / 67 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | check:platform:fast and owning feature test |
| `postcss.config.mjs` | Build, runtime, or repository configuration | low | 266 B / 15 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `proxy.ts` | Build, runtime, or repository configuration | critical | 3272 B / 82 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `public/brand/pipeline-mark.png` | Static asset | low | 16681 B / binary | Check unnecessary bytes, stale branding, accessible alternatives, correct dimensions, cache behavior, and license/provenance. | visual render, dimensions, compression, cache headers, and provenance |
| `public/file.svg` | Static asset | low | 391 B / 1 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | visual render, dimensions, compression, cache headers, and provenance |
| `public/globe.svg` | Static asset | low | 1035 B / 1 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | visual render, dimensions, compression, cache headers, and provenance |
| `public/next.svg` | Static asset | low | 1375 B / 1 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | visual render, dimensions, compression, cache headers, and provenance |
| `public/offline.html` | Static asset | low | 1175 B / 26 lines | Check unnecessary bytes, stale branding, accessible alternatives, correct dimensions, cache behavior, and license/provenance. | visual render, dimensions, compression, cache headers, and provenance |
| `public/pwa/icon-192.png` | Static asset | low | 2410 B / binary | Check unnecessary bytes, stale branding, accessible alternatives, correct dimensions, cache behavior, and license/provenance. | visual render, dimensions, compression, cache headers, and provenance |
| `public/pwa/icon-512.png` | Static asset | low | 6840 B / binary | Check unnecessary bytes, stale branding, accessible alternatives, correct dimensions, cache behavior, and license/provenance. | visual render, dimensions, compression, cache headers, and provenance |
| `public/pwa/icon-maskable-512.png` | Static asset | low | 6847 B / binary | Check unnecessary bytes, stale branding, accessible alternatives, correct dimensions, cache behavior, and license/provenance. | visual render, dimensions, compression, cache headers, and provenance |
| `public/sw.js` | Static asset | low | 2697 B / 94 lines | Check unnecessary bytes, stale branding, accessible alternatives, correct dimensions, cache behavior, and license/provenance. | visual render, dimensions, compression, cache headers, and provenance |
| `public/templates/pipeline-assessment-workbook.xlsx` | Static asset | low | 333996 B / binary | Check unnecessary bytes, stale branding, accessible alternatives, correct dimensions, cache behavior, and license/provenance. | visual render, dimensions, compression, cache headers, and provenance |
| `public/window.svg` | Static asset | low | 385 B / 1 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | visual render, dimensions, compression, cache headers, and provenance |
| `scripts/academy-atlas.mjs` | Operator, verification, or data script | low | 12936 B / 240 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/academy-readiness.mjs` | Operator, verification, or data script | low | 8452 B / 189 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/academy-route-contracts.mjs` | Operator, verification, or data script | low | 8146 B / 180 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/admissions-zone-contracts.mjs` | Operator, verification, or data script | low | 2638 B / 51 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/alerting-readiness.mjs` | Operator, verification, or data script | low | 4045 B / 69 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/allo-import-identity-replay.mjs` | Operator, verification, or data script | low | 3865 B / 95 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/allo-workspace-import-common.mjs` | Operator, verification, or data script | low | 7473 B / 184 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/api-behavior-fixtures.mjs` | Operator, verification, or data script | medium | 78160 B / 1635 lines | Large module (1635 lines): split by behavior before adding more responsibilities. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/api-route-policy-audit.mjs` | Operator, verification, or data script | low | 8994 B / 181 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/apply-database-migrations.mjs` | Operator, verification, or data script | high | 5758 B / 183 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/assessment-workbook-contracts.mjs` | Operator, verification, or data script | low | 6014 B / 130 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/assessor-workflow-contracts.mjs` | Operator, verification, or data script | low | 15838 B / 180 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/audit-material-workspaces.mjs` | Operator, verification, or data script | low | 6279 B / 147 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/backfill-allo-admission-evidence.mjs` | Operator, verification, or data script | low | 7456 B / 181 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/backlog-rehearsal.mjs` | Operator, verification, or data script | low | 7466 B / 190 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/bootstrap-azure-foundation.sh` | Operator, verification, or data script | low | 6827 B / 196 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/bootstrap-production-database.mjs` | Operator, verification, or data script | low | 6771 B / 179 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/build-artifact-audit.mjs` | Operator, verification, or data script | low | 4193 B / 105 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/build-runtime-ops-dependencies.mjs` | Operator, verification, or data script | low | 1358 B / 37 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/chaos-recovery-replay.mjs` | Operator, verification, or data script | low | 5012 B / 89 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/ci-change-impact-fixtures.mjs` | Operator, verification, or data script | low | 2066 B / 63 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/ci-change-impact.mjs` | Operator, verification, or data script | low | 2163 B / 57 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/clean-local-artifacts.mjs` | Operator, verification, or data script | low | 891 B / 31 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/client-history-contracts.mjs` | Operator, verification, or data script | low | 4696 B / 107 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/client-workspace-contracts.mjs` | Operator, verification, or data script | low | 13577 B / 98 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/clinical-data-contracts.mjs` | Operator, verification, or data script | low | 30173 B / 537 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/clinical-value-presentation-contracts.mjs` | Operator, verification, or data script | low | 1813 B / 58 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/code-hygiene-audit.mjs` | Operator, verification, or data script | low | 8090 B / 261 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/code-quality-readiness.mjs` | Operator, verification, or data script | low | 20095 B / 308 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/codebase-refactor-baseline.mjs` | Operator, verification, or data script | low | 20927 B / 509 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/collaboration-load-smoke.mjs` | Operator, verification, or data script | low | 12622 B / 310 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/compare-refactor-baselines.mjs` | Operator, verification, or data script | low | 4096 B / 102 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/complete-repository-audit.mjs` | Operator, verification, or data script | low | 34388 B / 459 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/configure-azure-clinical.sh` | Operator, verification, or data script | low | 2979 B / 88 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/configure-azure-domain.sh` | Operator, verification, or data script | low | 6138 B / 170 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/configure-azure-production.sh` | Operator, verification, or data script | low | 9135 B / 214 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/configure-databricks-extraction.sh` | Operator, verification, or data script | low | 8868 B / 182 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/configure-entra-identities.sh` | Operator, verification, or data script | low | 12351 B / 293 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/create-batch-manifest.mjs` | Operator, verification, or data script | low | 5504 B / 220 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/create-client-file-import-manifest.mjs` | Operator, verification, or data script | low | 5646 B / 155 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/create-release-evidence.mjs` | Operator, verification, or data script | low | 1995 B / 51 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/create-release-manifest.mjs` | Operator, verification, or data script | low | 5946 B / 164 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/critical-safety-contracts.mjs` | Operator, verification, or data script | low | 6460 B / 153 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/cyclomatic-complexity-audit.mjs` | Operator, verification, or data script | low | 11060 B / 318 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/cyclomatic-complexity-python.py` | Operator, verification, or data script | low | 3415 B / 130 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/database-assurance-contracts.mjs` | Operator, verification, or data script | high | 3928 B / 53 lines | Uses SELECT *; verify response growth, schema coupling, and PHI minimization. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/database-assurance-registry.mjs` | Operator, verification, or data script | high | 10530 B / 210 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/database-assurance-runner.mjs` | Operator, verification, or data script | high | 8862 B / 220 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/database-assurance-status.mjs` | Operator, verification, or data script | high | 401 B / 13 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/database-backup-to-azure-blob.mjs` | Operator, verification, or data script | high | 8608 B / 245 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/database-backup.mjs` | Operator, verification, or data script | high | 3867 B / 113 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/database-readiness.mjs` | Operator, verification, or data script | high | 29201 B / 370 lines | Uses SELECT *; verify response growth, schema coupling, and PHI minimization. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/database-restore-verify.mjs` | Operator, verification, or data script | high | 5315 B / 129 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/database-rollback-drill.mjs` | Operator, verification, or data script | high | 30401 B / 456 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/demo-clinical-snapshot-contracts.mjs` | Operator, verification, or data script | low | 7420 B / 165 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/deployment-readiness.mjs` | Operator, verification, or data script | low | 4473 B / 127 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/desktop-readiness.mjs` | Operator, verification, or data script | low | 8216 B / 99 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/extraction-corpus-readiness.mjs` | Operator, verification, or data script | low | 3151 B / 64 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/extraction-quality-score.mjs` | Operator, verification, or data script | low | 10540 B / 244 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/extraction-state-machine-replay.mjs` | Operator, verification, or data script | low | 5234 B / 99 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/failure-recovery-readiness.mjs` | Operator, verification, or data script | low | 3046 B / 33 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/finalize-azure-database-bootstrap.sh` | Operator, verification, or data script | low | 1933 B / 62 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/fixtures/alamo-pipeline-clinical.sanitized.json` | Sanitized test fixture | low | 11611 B / 398 lines | Check that data is synthetic/sanitized, deterministic, schema-current, minimal, and impossible to load in live runtime. | check:platform:fast and owning feature test |
| `scripts/fixtures/demo-clinical-reconciliation.sanitized.csv` | Sanitized test fixture | low | 85 B / binary | Check that data is synthetic/sanitized, deterministic, schema-current, minimal, and impossible to load in live runtime. | check:platform:fast and owning feature test |
| `scripts/fixtures/demo-clinical-roster.sanitized.csv` | Sanitized test fixture | low | 749 B / binary | Check that data is synthetic/sanitized, deterministic, schema-current, minimal, and impossible to load in live runtime. | check:platform:fast and owning feature test |
| `scripts/fixtures/extraction-quality/actual.json` | Sanitized test fixture | low | 1796 B / 28 lines | Check that data is synthetic/sanitized, deterministic, schema-current, minimal, and impossible to load in live runtime. | check:platform:fast and owning feature test |
| `scripts/fixtures/extraction-quality/expected.json` | Sanitized test fixture | low | 1778 B / 25 lines | Check that data is synthetic/sanitized, deterministic, schema-current, minimal, and impossible to load in live runtime. | check:platform:fast and owning feature test |
| `scripts/fixtures/master-client-history.sanitized.csv` | Sanitized test fixture | low | 936 B / binary | Check that data is synthetic/sanitized, deterministic, schema-current, minimal, and impossible to load in live runtime. | check:platform:fast and owning feature test |
| `scripts/generate-pwa-icons.mjs` | Operator, verification, or data script | low | 1193 B / 37 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/generate-sbom.mjs` | Operator, verification, or data script | low | 1238 B / 34 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/http-capacity-smoke.mjs` | Operator, verification, or data script | low | 5909 B / 166 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/http-load-smoke.mjs` | Operator, verification, or data script | low | 4561 B / 116 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/import-allo-material-workspaces.mjs` | Operator, verification, or data script | high | 21291 B / 472 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/import-confirmed-client-files.mjs` | Operator, verification, or data script | high | 9813 B / 225 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/import-demo-clinical-roster.mjs` | Operator, verification, or data script | high | 10944 B / 279 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/import-local-referral-packets.mjs` | Operator, verification, or data script | high | 5063 B / 126 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/import-master-client-history.mjs` | Operator, verification, or data script | high | 15628 B / 388 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/import-provisional-workspace-members.mjs` | Operator, verification, or data script | high | 6065 B / 152 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/infrastructure-readiness.mjs` | Operator, verification, or data script | low | 12483 B / 147 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/lib/bounded-csv.mjs` | Operator, verification, or data script | low | 3238 B / 99 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/license-policy-audit.mjs` | Operator, verification, or data script | low | 2018 B / 51 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/link-provisional-workspace-member.mjs` | Operator, verification, or data script | low | 6515 B / 163 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/live-access-rehearsal-readiness.mjs` | Operator, verification, or data script | low | 1321 B / 18 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/live-access-rehearsal.mjs` | Operator, verification, or data script | low | 3678 B / 98 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/master-dataset-merge-certification.mjs` | Operator, verification, or data script | low | 4543 B / 87 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/mcmaster-certification-matrix.mjs` | Operator, verification, or data script | low | 7995 B / 79 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/mcmaster-certification-runner.mjs` | Operator, verification, or data script | low | 10481 B / 246 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/mcmaster-performance-contracts.mjs` | Operator, verification, or data script | low | 3435 B / 38 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/operational-capacity-model.mjs` | Operator, verification, or data script | low | 4590 B / 65 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/operational-certification.mjs` | Operator, verification, or data script | low | 7377 B / 205 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/operational-metric-fixtures.mjs` | Operator, verification, or data script | low | 2662 B / 66 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/operational-metrics-readiness.mjs` | Operator, verification, or data script | low | 4298 B / 73 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/operator-training-readiness.mjs` | Operator, verification, or data script | low | 11616 B / 88 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/operator-training-route-contracts.mjs` | Operator, verification, or data script | low | 9811 B / 49 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/pilot-reset.mjs` | Operator, verification, or data script | high | 3636 B / 80 lines | Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/pipeline-extraction-worker-contracts.mjs` | Operator, verification, or data script | low | 3517 B / 37 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/pipeline-performance-scorecard.mjs` | Operator, verification, or data script | low | 22617 B / 524 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/platform-assurance-certification.mjs` | Operator, verification, or data script | low | 5428 B / 167 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/platform-assurance-registry.mjs` | Operator, verification, or data script | low | 20396 B / 304 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/platform-assurance-scorecard.mjs` | Operator, verification, or data script | low | 2552 B / 65 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/platform-readiness.mjs` | Operator, verification, or data script | low | 6751 B / 290 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/postgres-capacity-certification.mjs` | Operator, verification, or data script | low | 9795 B / 258 lines | Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/postgres-concurrency-certification.mjs` | Operator, verification, or data script | low | 17352 B / 412 lines | Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/postgres-integration-fixtures.mjs` | Operator, verification, or data script | low | 10670 B / 188 lines | Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/postgres-integrity-audit.mjs` | Operator, verification, or data script | low | 5944 B / 142 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/postgres-live-smoke.mjs` | Operator, verification, or data script | low | 9299 B / 206 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/postgres-query-plan-fixtures.mjs` | Operator, verification, or data script | low | 3181 B / 86 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/prepare-allo-workspace-import.mjs` | Operator, verification, or data script | low | 11895 B / 293 lines | Explicitly suppresses a rejected promise; verify this is genuinely optional and observable. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/property-contracts.mjs` | Operator, verification, or data script | low | 7750 B / 168 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/publish-allo-workspace-manifest.mjs` | Operator, verification, or data script | low | 3645 B / 95 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/purge-user-workspace-state.mjs` | Operator, verification, or data script | high | 2481 B / 73 lines | Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/query-plan-audit.mjs` | Operator, verification, or data script | low | 3257 B / 44 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/reconcile-client-file-import.mjs` | Operator, verification, or data script | low | 9507 B / 234 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/recovery-readiness.mjs` | Operator, verification, or data script | low | 1423 B / 20 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/refactor-agent-control-fixtures.mjs` | Operator, verification, or data script | low | 2589 B / 63 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/refactor-agent-control.mjs` | Operator, verification, or data script | low | 14366 B / 336 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/refactor-evidence-readiness.mjs` | Operator, verification, or data script | low | 8753 B / 153 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/refactor-setup-readiness.mjs` | Operator, verification, or data script | low | 6734 B / 118 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/referral-journey-replay.mjs` | Operator, verification, or data script | low | 12064 B / 397 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/referral-reliability-replay.mjs` | Operator, verification, or data script | low | 21964 B / 663 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/release-compatibility.mjs` | Operator, verification, or data script | low | 2294 B / 30 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/reset-local-synthetic-data.mjs` | Operator, verification, or data script | low | 2736 B / 86 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/rollback-client-file-import.mjs` | Operator, verification, or data script | high | 12495 B / 261 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/sample-packet-extraction-smoke.mjs` | Operator, verification, or data script | low | 10854 B / 267 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/scan-allo-workspace-materials.mjs` | Operator, verification, or data script | low | 10591 B / 289 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/security-boundary-check.mjs` | Operator, verification, or data script | low | 6878 B / 129 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/seed-production-reference-data.mjs` | Operator, verification, or data script | high | 2352 B / 48 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/seeded-defect-certification.mjs` | Operator, verification, or data script | low | 7831 B / 139 lines | Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/stage-client-file-import.mjs` | Operator, verification, or data script | low | 4223 B / 90 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/start-standalone.mjs` | Operator, verification, or data script | low | 1696 B / 52 lines | Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/storage-capacity-readiness.mjs` | Operator, verification, or data script | low | 2076 B / 28 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/storage-consistency-replay.mjs` | Operator, verification, or data script | low | 2964 B / 43 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/supply-chain-readiness.mjs` | Operator, verification, or data script | low | 2328 B / 31 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/synthetic-scale-benchmark.mjs` | Operator, verification, or data script | low | 5184 B / 114 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/test-pipeline-extraction-worker.py` | Operator, verification, or data script | low | 6305 B / 130 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/ts-module-loader.mjs` | Operator, verification, or data script | low | 2526 B / 78 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/upload-allo-workspace-materials.mjs` | Operator, verification, or data script | high | 8432 B / 242 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/verify-database-migration-0007.mjs` | Operator, verification, or data script | low | 3189 B / 84 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/verify-release-evidence.mjs` | Operator, verification, or data script | low | 3736 B / 61 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/workflow-stateful-fuzz.mjs` | Operator, verification, or data script | low | 10888 B / 333 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `scripts/workspace-retention-readiness.mjs` | Operator, verification, or data script | low | 3224 B / 35 lines | Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery. | execute with sanitized fixture; verify dry-run/fail-closed behavior |
| `shared/pipeline-base-path.d.mts` | Repository support file | low | 230 B / 4 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `shared/pipeline-base-path.mjs` | Repository support file | low | 1467 B / 35 lines | Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior. | check:platform:fast and owning feature test |
| `src/app/favicon.ico` | Static asset | low | 25931 B / binary | Check unnecessary bytes, stale branding, accessible alternatives, correct dimensions, cache behavior, and license/provenance. | visual render, dimensions, compression, cache headers, and provenance |
| `tests/e2e/academy.spec.ts` | Browser journey test or snapshot | low | 6829 B / 113 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/cross-browser-smoke.spec.ts` | Browser journey test or snapshot | low | 718 B / 17 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/desktop-readiness.spec.ts` | Browser journey test or snapshot | low | 15874 B / 355 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/global-setup.ts` | Browser journey test or snapshot | low | 697 B / 19 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/operational/concurrent-referral-edits.scaffold.spec.ts` | Browser journey test or snapshot | low | 2803 B / 79 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/operational/golden-thread.spec.ts` | Browser journey test or snapshot | low | 9696 B / 221 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/operational/high-traffic-capacity.scaffold.spec.ts` | Browser journey test or snapshot | low | 21915 B / 548 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/operational/referral-lifecycle.scaffold.spec.ts` | Browser journey test or snapshot | low | 3015 B / 80 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/operational/role-access.spec.ts` | Browser journey test or snapshot | low | 4463 B / 118 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/operator-packet-smoke.spec.ts` | Browser journey test or snapshot | low | 1499 B / 29 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/operator-training.spec.ts` | Browser journey test or snapshot | low | 12303 B / 208 lines | Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/performance-navigation.spec.ts` | Browser journey test or snapshot | low | 3171 B / 68 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/pipeline-smoke.spec.ts` | Browser journey test or snapshot | medium | 137786 B / 2737 lines | Large module (2737 lines): split by behavior before adding more responsibilities. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/production-readiness.spec.ts` | Browser journey test or snapshot | low | 1670 B / 36 lines | Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/responsive-accessibility.spec.ts` | Browser journey test or snapshot | low | 7669 B / 160 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/support/operational-api.ts` | Browser journey test or snapshot | low | 13178 B / 388 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/support/pipeline-actors.ts` | Browser journey test or snapshot | low | 6228 B / 226 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/support/product-demo-scenario.ts` | Browser journey test or snapshot | low | 5818 B / 175 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts` | Browser journey test or snapshot | low | 3413 B / 82 lines | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/desktop-home-darwin.png` | Browser journey test or snapshot | low | 68833 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/desktop-home-linux.png` | Browser journey test or snapshot | low | 59682 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/desktop-new-packet-darwin.png` | Browser journey test or snapshot | low | 121881 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/desktop-new-packet-linux.png` | Browser journey test or snapshot | low | 101707 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/desktop-profiles-darwin.png` | Browser journey test or snapshot | low | 44344 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/desktop-profiles-linux.png` | Browser journey test or snapshot | low | 38558 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/desktop-referrals-darwin.png` | Browser journey test or snapshot | low | 65520 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/desktop-referrals-linux.png` | Browser journey test or snapshot | low | 56815 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/mobile-new-packet-darwin.png` | Browser journey test or snapshot | low | 34200 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/mobile-new-packet-linux.png` | Browser journey test or snapshot | low | 31951 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/mobile-referrals-darwin.png` | Browser journey test or snapshot | low | 33811 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tests/e2e/visual-regression.spec.ts-snapshots/mobile-referrals-linux.png` | Browser journey test or snapshot | low | 31238 B / binary | Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification. | run owning Playwright project and review skips/snapshots |
| `tsconfig.json` | Build, runtime, or repository configuration | low | 1265 B / 61 lines | Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults. | check:platform:fast and owning feature test |
| `wiki/INDEX.md` | Documentation or runbook | low | 491 B / 24 lines | Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions. | link/config drift review against executable source |

## Detected Static Review Flags

These are inspection prompts, not automatically confirmed defects. Each must be resolved as expected behavior, repaired, or assigned before release.

- `.env.example`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `.github/codex/schemas/refactor-result.schema.json`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `.github/workflows/ci.yml`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `.github/workflows/refactor-agent.yml`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `.gitignore`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `Dockerfile`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `Dockerfile.acr`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `app/api/auth/me/route.ts`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `app/api/files/import-review/[itemId]/route.ts`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `app/fonts/GEIST-LICENSE.txt`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `app/icon.svg`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `components/auth/PipelineAuthProvider.tsx`: Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `components/pipeline/AssessmentWorkspace.tsx`: Large module (1642 lines): split by behavior before adding more responsibilities. Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `components/pipeline/ClientProfileDirectory.tsx`: Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers.
- `components/pipeline/ClientProfileView.tsx`: Large module (1552 lines): split by behavior before adding more responsibilities. Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers.
- `components/pipeline/PacketExtractionReview.tsx`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `components/pipeline/PipelineCalendar.tsx`: Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers.
- `components/pipeline/PipelineDeveloperAcademy.tsx`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `components/pipeline/PipelineOperatorAcademy.tsx`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `components/pipeline/PipelineSearchPanel.tsx`: Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers.
- `components/pipeline/PipelineTrash.tsx`: Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers.
- `components/pipeline/PipelineWelcome.tsx`: Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `components/pipeline/ReferralHome.tsx`: Large module (1086 lines): split by behavior before adding more responsibilities. Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers.
- `components/pipeline/ReferralPacketCanvas.tsx`: Large module (2657 lines): split by behavior before adding more responsibilities. Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `components/pipeline/StructuredNarrativeField.tsx`: Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers.
- `components/pipeline/academy/AcademyRepositoryAtlas.tsx`: Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers.
- `components/pipeline/training/PipelineGuidedCoach.tsx`: Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers. Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `databricks.yml`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `databricks/pipeline_extraction_worker.py`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `docs/AZURE_PRODUCTION_SETUP.md`: Uses SELECT *; verify response growth, schema coupling, and PHI minimization.
- `docs/COMPLETE_REPOSITORY_AUDIT_2026-08-22.md`: Large module (1246 lines): split by behavior before adding more responsibilities. Uses SELECT *; verify response growth, schema coupling, and PHI minimization.
- `docs/ENTRA_AUTHENTICATION.md`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `docs/PRODUCTION_DATA_OPERATIONS.md`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `docs/refactoring/CODE_QUALITY_POLICY.md`: Contains unsafe type escape; replace with validation or a narrow type.
- `docs/reliability/cyclomatic-complexity-baseline.json`: Large module (60929 lines): split by behavior before adding more responsibilities. Large repository object (2022 KiB): confirm it belongs in Git and is compressed. Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `docs/reliability/refactor-baseline-2026-08-27-setup.json`: Large module (10598 lines): split by behavior before adding more responsibilities.
- `docs/reliability/refactor-baseline-2026-08-27.json`: Large module (10538 lines): split by behavior before adding more responsibilities.
- `infra/azure/main.bicep`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `infra/azure/main.parameters.example.json`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `infra/azure/runtime.bicep`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `lib/academy/academy-access.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `lib/academy/academy-atlas.generated.json`: Large module (7671 lines): split by behavior before adding more responsibilities.
- `lib/academy/academy-curriculum.ts`: Large module (1448 lines): split by behavior before adding more responsibilities.
- `lib/assessment/assessment-file-parser.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `lib/assessment/assessment-store.ts`: Large module (2074 lines): split by behavior before adding more responsibilities. Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies. Uses SELECT *; verify response growth, schema coupling, and PHI minimization. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `lib/auth/authenticated-fetch.ts`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `lib/auth/browser-session.ts`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `lib/auth/entra-client.ts`: Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies. Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `lib/auth/pipeline-auth.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `lib/auth/post-login-path.ts`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `lib/clinical/clinical-data.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `lib/extraction/azure-blob.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `lib/extraction/databricks.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `lib/extraction/local-packet-ingestion.ts`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `lib/extraction/mock-store.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `lib/observability/api-logging.ts`: Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies.
- `lib/observability/pipeline-metrics.ts`: Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies.
- `lib/pipeline/client-workspace-store.ts`: Uses SELECT *; verify response growth, schema coupling, and PHI minimization.
- `lib/pipeline/recent-destinations.ts`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `lib/pipeline/referral-draft-recovery.ts`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `lib/pipeline/referral-packet-upload.ts`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `lib/pipeline/referral-store.ts`: Large module (2692 lines): split by behavior before adding more responsibilities. Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `lib/pipeline/resident-link-store.ts`: Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies. Uses SELECT *; verify response growth, schema coupling, and PHI minimization. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `lib/pipeline/user-workspace-state-store.ts`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `lib/pipeline/workflow-store.ts`: Large module (1184 lines): split by behavior before adding more responsibilities.
- `lib/training/operator-training-access.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `next.config.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `package-lock.json`: Large module (7956 lines): split by behavior before adding more responsibilities.
- `playwright.config.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `playwright.operational.config.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `public/file.svg`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `public/globe.svg`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `public/next.svg`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `public/window.svg`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/academy-readiness.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/academy-route-contracts.mjs`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `scripts/admissions-zone-contracts.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/api-behavior-fixtures.mjs`: Large module (1635 lines): split by behavior before adding more responsibilities. Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/apply-database-migrations.mjs`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/assessor-workflow-contracts.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/backfill-allo-admission-evidence.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. Uses SELECT *; verify response growth, schema coupling, and PHI minimization.
- `scripts/backlog-rehearsal.mjs`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/bootstrap-azure-foundation.sh`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/bootstrap-production-database.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/ci-change-impact.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/client-history-contracts.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. Contains destructive behavior; require dry-run, explicit scope, and recovery evidence.
- `scripts/clinical-data-contracts.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/code-hygiene-audit.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/code-quality-readiness.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/codebase-refactor-baseline.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/complete-repository-audit.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup. Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. Uses SELECT *; verify response growth, schema coupling, and PHI minimization.
- `scripts/configure-azure-clinical.sh`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/configure-azure-domain.sh`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/configure-azure-production.sh`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/configure-databricks-extraction.sh`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/configure-entra-identities.sh`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/create-batch-manifest.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/create-client-file-import-manifest.mjs`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/create-release-evidence.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/create-release-manifest.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/cyclomatic-complexity-audit.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/database-assurance-contracts.mjs`: Uses SELECT *; verify response growth, schema coupling, and PHI minimization.
- `scripts/database-assurance-runner.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/database-backup-to-azure-blob.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/database-readiness.mjs`: Uses SELECT *; verify response growth, schema coupling, and PHI minimization.
- `scripts/database-rollback-drill.mjs`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/demo-clinical-snapshot-contracts.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. Contains destructive behavior; require dry-run, explicit scope, and recovery evidence.
- `scripts/desktop-readiness.mjs`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `scripts/generate-sbom.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/import-allo-material-workspaces.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/import-confirmed-client-files.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/import-local-referral-packets.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/infrastructure-readiness.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/mcmaster-certification-runner.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/operational-certification.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/operator-training-readiness.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/operator-training-route-contracts.mjs`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `scripts/pilot-reset.mjs`: Contains destructive behavior; require dry-run, explicit scope, and recovery evidence.
- `scripts/pipeline-extraction-worker-contracts.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/pipeline-performance-scorecard.mjs`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/platform-assurance-certification.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/platform-readiness.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/postgres-capacity-certification.mjs`: Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/postgres-concurrency-certification.mjs`: Contains destructive behavior; require dry-run, explicit scope, and recovery evidence. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/postgres-integration-fixtures.mjs`: Contains destructive behavior; require dry-run, explicit scope, and recovery evidence.
- `scripts/prepare-allo-workspace-import.mjs`: Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/publish-allo-workspace-manifest.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/purge-user-workspace-state.mjs`: Contains destructive behavior; require dry-run, explicit scope, and recovery evidence.
- `scripts/reconcile-client-file-import.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/refactor-agent-control.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.
- `scripts/rollback-client-file-import.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/sample-packet-extraction-smoke.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/scan-allo-workspace-materials.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.
- `scripts/seeded-defect-certification.mjs`: Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures. Contains destructive behavior; require dry-run, explicit scope, and recovery evidence.
- `scripts/start-standalone.mjs`: Contains destructive behavior; require dry-run, explicit scope, and recovery evidence.
- `scripts/test-pipeline-extraction-worker.py`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `scripts/upload-allo-workspace-materials.mjs`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.
- `tests/e2e/academy.spec.ts`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `tests/e2e/desktop-readiness.spec.ts`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `tests/e2e/operator-training.spec.ts`: Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `tests/e2e/pipeline-smoke.spec.ts`: Large module (2737 lines): split by behavior before adding more responsibilities. Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.
- `tests/e2e/production-readiness.spec.ts`: Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.

## Pending Deletions

None.

## Complete Locked Dependency Inventory

Duplicate package names at different paths or versions are intentionally retained; they represent the actual lockfile surface.

| Package | Version | Scope flags | License | Integrity | Source | Install hooks | Lock path |
|---|---|---|---|---|---|---|---|
| @alloc/quick-lru | 5.2.0 | dev | MIT | yes | npm registry | none | `node_modules/@alloc/quick-lru` |
| @azure/abort-controller | 2.2.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/abort-controller` |
| @azure/core-auth | 1.11.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/core-auth` |
| @azure/core-client | 1.11.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/core-client` |
| @azure/core-http-compat | 2.5.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/core-http-compat` |
| @azure/core-lro | 2.7.2 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/core-lro` |
| @azure/core-paging | 1.7.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/core-paging` |
| @azure/core-rest-pipeline | 1.25.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/core-rest-pipeline` |
| @azure/core-tracing | 1.4.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/core-tracing` |
| @azure/core-util | 1.14.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/core-util` |
| @azure/core-xml | 1.6.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/core-xml` |
| @azure/identity | 4.13.1 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/identity` |
| @azure/logger | 1.4.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/logger` |
| @azure/msal-browser | 4.30.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/msal-browser` |
| @azure/msal-browser | 5.18.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/identity/node_modules/@azure/msal-browser` |
| @azure/msal-common | 15.17.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/msal-common` |
| @azure/msal-common | 16.12.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/identity/node_modules/@azure/msal-common` |
| @azure/msal-common | 16.12.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/msal-node/node_modules/@azure/msal-common` |
| @azure/msal-node | 5.5.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/msal-node` |
| @azure/msal-react | 3.0.29 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/msal-react` |
| @azure/storage-blob | 12.33.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/storage-blob` |
| @azure/storage-common | 12.5.0 | runtime | MIT | yes | npm registry | none | `node_modules/@azure/storage-common` |
| @babel/code-frame | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/code-frame` |
| @babel/compat-data | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/compat-data` |
| @babel/core | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/core` |
| @babel/generator | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/generator` |
| @babel/helper-compilation-targets | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/helper-compilation-targets` |
| @babel/helper-globals | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/helper-globals` |
| @babel/helper-module-imports | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/helper-module-imports` |
| @babel/helper-module-transforms | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/helper-module-transforms` |
| @babel/helper-string-parser | 7.29.7 | runtime | MIT | yes | npm registry | none | `node_modules/@babel/helper-string-parser` |
| @babel/helper-validator-identifier | 7.29.7 | runtime | MIT | yes | npm registry | none | `node_modules/@babel/helper-validator-identifier` |
| @babel/helper-validator-option | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/helper-validator-option` |
| @babel/helpers | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/helpers` |
| @babel/parser | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/parser` |
| @babel/template | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/template` |
| @babel/traverse | 7.29.7 | dev | MIT | yes | npm registry | none | `node_modules/@babel/traverse` |
| @babel/types | 7.29.7 | runtime | MIT | yes | npm registry | none | `node_modules/@babel/types` |
| @emnapi/core | 1.8.1 | dev, optional | MIT | no | npm registry | none | `node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@emnapi/core` |
| @emnapi/core | 1.9.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@emnapi/core` |
| @emnapi/runtime | 1.11.3 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@emnapi/runtime` |
| @emnapi/runtime | 1.8.1 | dev, optional | MIT | no | npm registry | none | `node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@emnapi/runtime` |
| @emnapi/wasi-threads | 1.1.0 | dev, optional | MIT | no | npm registry | none | `node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@emnapi/wasi-threads` |
| @emnapi/wasi-threads | 1.2.0 | dev, optional | MIT | yes | npm registry | none | `node_modules/@emnapi/wasi-threads` |
| @eslint-community/eslint-utils | 4.9.1 | dev | MIT | yes | npm registry | none | `node_modules/@eslint-community/eslint-utils` |
| @eslint-community/regexpp | 4.12.2 | dev | MIT | yes | npm registry | none | `node_modules/@eslint-community/regexpp` |
| @eslint/config-array | 0.21.2 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@eslint/config-array` |
| @eslint/config-helpers | 0.4.2 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@eslint/config-helpers` |
| @eslint/core | 0.17.0 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@eslint/core` |
| @eslint/eslintrc | 3.3.5 | dev | MIT | yes | npm registry | none | `node_modules/@eslint/eslintrc` |
| @eslint/js | 9.39.4 | dev | MIT | yes | npm registry | none | `node_modules/@eslint/js` |
| @eslint/object-schema | 2.1.7 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@eslint/object-schema` |
| @eslint/plugin-kit | 0.4.1 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@eslint/plugin-kit` |
| @humanfs/core | 0.19.1 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@humanfs/core` |
| @humanfs/node | 0.16.7 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@humanfs/node` |
| @humanwhocodes/module-importer | 1.0.1 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@humanwhocodes/module-importer` |
| @humanwhocodes/retry | 0.4.3 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@humanwhocodes/retry` |
| @img/colour | 1.1.0 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@img/colour` |
| @img/sharp-darwin-arm64 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-darwin-arm64` |
| @img/sharp-darwin-x64 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-darwin-x64` |
| @img/sharp-freebsd-wasm32 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-freebsd-wasm32` |
| @img/sharp-libvips-darwin-arm64 | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-darwin-arm64` |
| @img/sharp-libvips-darwin-x64 | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-darwin-x64` |
| @img/sharp-libvips-linux-arm | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-linux-arm` |
| @img/sharp-libvips-linux-arm64 | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-linux-arm64` |
| @img/sharp-libvips-linux-ppc64 | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-linux-ppc64` |
| @img/sharp-libvips-linux-riscv64 | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-linux-riscv64` |
| @img/sharp-libvips-linux-s390x | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-linux-s390x` |
| @img/sharp-libvips-linux-x64 | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-linux-x64` |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-linuxmusl-arm64` |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.2 | runtime, optional | LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-libvips-linuxmusl-x64` |
| @img/sharp-linux-arm | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-linux-arm` |
| @img/sharp-linux-arm64 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-linux-arm64` |
| @img/sharp-linux-ppc64 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-linux-ppc64` |
| @img/sharp-linux-riscv64 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-linux-riscv64` |
| @img/sharp-linux-s390x | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-linux-s390x` |
| @img/sharp-linux-x64 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-linux-x64` |
| @img/sharp-linuxmusl-arm64 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-linuxmusl-arm64` |
| @img/sharp-linuxmusl-x64 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-linuxmusl-x64` |
| @img/sharp-wasm32 | 0.35.3 | runtime, optional | Apache-2.0 AND LGPL-3.0-or-later AND MIT | yes | npm registry | none | `node_modules/@img/sharp-wasm32` |
| @img/sharp-webcontainers-wasm32 | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/@img/sharp-webcontainers-wasm32` |
| @img/sharp-win32-arm64 | 0.35.3 | runtime, optional | Apache-2.0 AND LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-win32-arm64` |
| @img/sharp-win32-ia32 | 0.35.3 | runtime, optional | Apache-2.0 AND LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-win32-ia32` |
| @img/sharp-win32-x64 | 0.35.3 | runtime, optional | Apache-2.0 AND LGPL-3.0-or-later | yes | npm registry | none | `node_modules/@img/sharp-win32-x64` |
| @jridgewell/gen-mapping | 0.3.13 | dev | MIT | yes | npm registry | none | `node_modules/@jridgewell/gen-mapping` |
| @jridgewell/remapping | 2.3.5 | dev | MIT | yes | npm registry | none | `node_modules/@jridgewell/remapping` |
| @jridgewell/resolve-uri | 3.1.2 | dev | MIT | yes | npm registry | none | `node_modules/@jridgewell/resolve-uri` |
| @jridgewell/sourcemap-codec | 1.5.5 | dev | MIT | yes | npm registry | none | `node_modules/@jridgewell/sourcemap-codec` |
| @jridgewell/trace-mapping | 0.3.31 | dev | MIT | yes | npm registry | none | `node_modules/@jridgewell/trace-mapping` |
| @napi-rs/canvas | 1.0.5 | runtime | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas` |
| @napi-rs/canvas-android-arm64 | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-android-arm64` |
| @napi-rs/canvas-darwin-arm64 | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-darwin-arm64` |
| @napi-rs/canvas-darwin-x64 | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-darwin-x64` |
| @napi-rs/canvas-linux-arm-gnueabihf | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-linux-arm-gnueabihf` |
| @napi-rs/canvas-linux-arm64-gnu | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-linux-arm64-gnu` |
| @napi-rs/canvas-linux-arm64-musl | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-linux-arm64-musl` |
| @napi-rs/canvas-linux-riscv64-gnu | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-linux-riscv64-gnu` |
| @napi-rs/canvas-linux-x64-gnu | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-linux-x64-gnu` |
| @napi-rs/canvas-linux-x64-musl | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-linux-x64-musl` |
| @napi-rs/canvas-win32-arm64-msvc | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-win32-arm64-msvc` |
| @napi-rs/canvas-win32-x64-msvc | 1.0.5 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/canvas-win32-x64-msvc` |
| @napi-rs/wasm-runtime | 0.2.12 | dev, optional | MIT | yes | npm registry | none | `node_modules/@napi-rs/wasm-runtime` |
| @napi-rs/wasm-runtime | 1.1.1 | dev, optional | MIT | no | npm registry | none | `node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@napi-rs/wasm-runtime` |
| @next/env | 16.2.11 | runtime | MIT | yes | npm registry | none | `node_modules/@next/env` |
| @next/eslint-plugin-next | 16.2.11 | dev | MIT | yes | npm registry | none | `node_modules/@next/eslint-plugin-next` |
| @next/swc-darwin-arm64 | 16.2.11 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@next/swc-darwin-arm64` |
| @next/swc-darwin-x64 | 16.2.11 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@next/swc-darwin-x64` |
| @next/swc-linux-arm64-gnu | 16.2.11 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@next/swc-linux-arm64-gnu` |
| @next/swc-linux-arm64-musl | 16.2.11 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@next/swc-linux-arm64-musl` |
| @next/swc-linux-x64-gnu | 16.2.11 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@next/swc-linux-x64-gnu` |
| @next/swc-linux-x64-musl | 16.2.11 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@next/swc-linux-x64-musl` |
| @next/swc-win32-arm64-msvc | 16.2.11 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@next/swc-win32-arm64-msvc` |
| @next/swc-win32-x64-msvc | 16.2.11 | runtime, optional | MIT | yes | npm registry | none | `node_modules/@next/swc-win32-x64-msvc` |
| @nodable/entities | 3.0.0 | runtime | MIT | yes | npm registry | none | `node_modules/@nodable/entities` |
| @nodelib/fs.scandir | 2.1.5 | dev | MIT | yes | npm registry | none | `node_modules/@nodelib/fs.scandir` |
| @nodelib/fs.stat | 2.0.5 | dev | MIT | yes | npm registry | none | `node_modules/@nodelib/fs.stat` |
| @nodelib/fs.walk | 1.2.8 | dev | MIT | yes | npm registry | none | `node_modules/@nodelib/fs.walk` |
| @nolyfill/is-core-module | 1.0.39 | dev | MIT | yes | npm registry | none | `node_modules/@nolyfill/is-core-module` |
| @playwright/test | 1.61.1 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/@playwright/test` |
| @rtsao/scc | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/@rtsao/scc` |
| @swc/helpers | 0.5.15 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/@swc/helpers` |
| @tailwindcss/node | 4.2.2 | dev | MIT | yes | npm registry | none | `node_modules/@tailwindcss/node` |
| @tailwindcss/oxide | 4.2.2 | dev | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide` |
| @tailwindcss/oxide-android-arm64 | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-android-arm64` |
| @tailwindcss/oxide-darwin-arm64 | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-darwin-arm64` |
| @tailwindcss/oxide-darwin-x64 | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-darwin-x64` |
| @tailwindcss/oxide-freebsd-x64 | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-freebsd-x64` |
| @tailwindcss/oxide-linux-arm-gnueabihf | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-linux-arm-gnueabihf` |
| @tailwindcss/oxide-linux-arm64-gnu | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-linux-arm64-gnu` |
| @tailwindcss/oxide-linux-arm64-musl | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-linux-arm64-musl` |
| @tailwindcss/oxide-linux-x64-gnu | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-linux-x64-gnu` |
| @tailwindcss/oxide-linux-x64-musl | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-linux-x64-musl` |
| @tailwindcss/oxide-wasm32-wasi | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-wasm32-wasi` |
| @tailwindcss/oxide-win32-arm64-msvc | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-win32-arm64-msvc` |
| @tailwindcss/oxide-win32-x64-msvc | 4.2.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tailwindcss/oxide-win32-x64-msvc` |
| @tailwindcss/postcss | 4.2.2 | dev | MIT | yes | npm registry | none | `node_modules/@tailwindcss/postcss` |
| @tesseract.js-data/eng | 1.0.0 | runtime | MIT | yes | npm registry | none | `node_modules/@tesseract.js-data/eng` |
| @tybys/wasm-util | 0.10.1 | dev, optional | MIT | no | npm registry | none | `node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@tybys/wasm-util` |
| @tybys/wasm-util | 0.10.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@tybys/wasm-util` |
| @types/estree | 1.0.8 | dev | MIT | yes | npm registry | none | `node_modules/@types/estree` |
| @types/json-schema | 7.0.15 | dev | MIT | yes | npm registry | none | `node_modules/@types/json-schema` |
| @types/json5 | 0.0.29 | dev | MIT | yes | npm registry | none | `node_modules/@types/json5` |
| @types/node | 20.19.37 | dev | MIT | yes | npm registry | none | `node_modules/@types/node` |
| @types/react | 19.2.14 | dev | MIT | yes | npm registry | none | `node_modules/@types/react` |
| @types/react-dom | 19.2.3 | dev | MIT | yes | npm registry | none | `node_modules/@types/react-dom` |
| @typescript-eslint/eslint-plugin | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/eslint-plugin` |
| @typescript-eslint/parser | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/parser` |
| @typescript-eslint/project-service | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/project-service` |
| @typescript-eslint/scope-manager | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/scope-manager` |
| @typescript-eslint/tsconfig-utils | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/tsconfig-utils` |
| @typescript-eslint/type-utils | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/type-utils` |
| @typescript-eslint/types | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/types` |
| @typescript-eslint/typescript-estree | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/typescript-estree` |
| @typescript-eslint/utils | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/utils` |
| @typescript-eslint/visitor-keys | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/visitor-keys` |
| @typespec/ts-http-runtime | 0.3.8 | runtime | MIT | yes | npm registry | none | `node_modules/@typespec/ts-http-runtime` |
| @unrs/resolver-binding-android-arm-eabi | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-android-arm-eabi` |
| @unrs/resolver-binding-android-arm64 | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-android-arm64` |
| @unrs/resolver-binding-darwin-arm64 | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-darwin-arm64` |
| @unrs/resolver-binding-darwin-x64 | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-darwin-x64` |
| @unrs/resolver-binding-freebsd-x64 | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-freebsd-x64` |
| @unrs/resolver-binding-linux-arm-gnueabihf | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-arm-gnueabihf` |
| @unrs/resolver-binding-linux-arm-musleabihf | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-arm-musleabihf` |
| @unrs/resolver-binding-linux-arm64-gnu | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-arm64-gnu` |
| @unrs/resolver-binding-linux-arm64-musl | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-arm64-musl` |
| @unrs/resolver-binding-linux-ppc64-gnu | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-ppc64-gnu` |
| @unrs/resolver-binding-linux-riscv64-gnu | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-riscv64-gnu` |
| @unrs/resolver-binding-linux-riscv64-musl | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-riscv64-musl` |
| @unrs/resolver-binding-linux-s390x-gnu | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-s390x-gnu` |
| @unrs/resolver-binding-linux-x64-gnu | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-x64-gnu` |
| @unrs/resolver-binding-linux-x64-musl | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-linux-x64-musl` |
| @unrs/resolver-binding-wasm32-wasi | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-wasm32-wasi` |
| @unrs/resolver-binding-win32-arm64-msvc | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-win32-arm64-msvc` |
| @unrs/resolver-binding-win32-ia32-msvc | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-win32-ia32-msvc` |
| @unrs/resolver-binding-win32-x64-msvc | 1.11.1 | dev, optional | MIT | yes | npm registry | none | `node_modules/@unrs/resolver-binding-win32-x64-msvc` |
| acorn | 8.16.0 | dev | MIT | yes | npm registry | none | `node_modules/acorn` |
| acorn-jsx | 5.3.2 | dev | MIT | yes | npm registry | none | `node_modules/acorn-jsx` |
| agent-base | 7.1.4 | runtime | MIT | yes | npm registry | none | `node_modules/agent-base` |
| ajv | 6.14.0 | dev | MIT | yes | npm registry | none | `node_modules/ajv` |
| ansi-styles | 4.3.0 | dev | MIT | yes | npm registry | none | `node_modules/ansi-styles` |
| anynum | 1.0.1 | runtime | MIT | yes | npm registry | none | `node_modules/anynum` |
| argparse | 2.0.1 | dev | Python-2.0 | yes | npm registry | none | `node_modules/argparse` |
| aria-query | 5.3.2 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/aria-query` |
| array-buffer-byte-length | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/array-buffer-byte-length` |
| array-includes | 3.1.9 | dev | MIT | yes | npm registry | none | `node_modules/array-includes` |
| array.prototype.findlast | 1.2.5 | dev | MIT | yes | npm registry | none | `node_modules/array.prototype.findlast` |
| array.prototype.findlastindex | 1.2.6 | dev | MIT | yes | npm registry | none | `node_modules/array.prototype.findlastindex` |
| array.prototype.flat | 1.3.3 | dev | MIT | yes | npm registry | none | `node_modules/array.prototype.flat` |
| array.prototype.flatmap | 1.3.3 | dev | MIT | yes | npm registry | none | `node_modules/array.prototype.flatmap` |
| array.prototype.tosorted | 1.1.4 | dev | MIT | yes | npm registry | none | `node_modules/array.prototype.tosorted` |
| arraybuffer.prototype.slice | 1.0.4 | dev | MIT | yes | npm registry | none | `node_modules/arraybuffer.prototype.slice` |
| ast-types-flow | 0.0.8 | dev | MIT | yes | npm registry | none | `node_modules/ast-types-flow` |
| async-function | 1.0.0 | dev | MIT | yes | npm registry | none | `node_modules/async-function` |
| available-typed-arrays | 1.0.7 | dev | MIT | yes | npm registry | none | `node_modules/available-typed-arrays` |
| axe-core | 4.11.1 | dev | MPL-2.0 | yes | npm registry | none | `node_modules/axe-core` |
| axobject-query | 4.1.0 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/axobject-query` |
| babel-plugin-react-compiler | 1.0.0 | runtime | MIT | yes | npm registry | none | `node_modules/babel-plugin-react-compiler` |
| balanced-match | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/balanced-match` |
| balanced-match | 4.0.4 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/typescript-estree/node_modules/balanced-match` |
| baseline-browser-mapping | 2.10.40 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/baseline-browser-mapping` |
| bmp-js | 0.1.0 | runtime | MIT | yes | npm registry | none | `node_modules/bmp-js` |
| brace-expansion | 1.1.18 | dev | MIT | yes | npm registry | none | `node_modules/brace-expansion` |
| brace-expansion | 5.0.9 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion` |
| braces | 3.0.3 | dev | MIT | yes | npm registry | none | `node_modules/braces` |
| browserslist | 4.28.4 | dev | MIT | yes | npm registry | none | `node_modules/browserslist` |
| buffer-equal-constant-time | 1.0.1 | runtime | BSD-3-Clause | yes | npm registry | none | `node_modules/buffer-equal-constant-time` |
| bundle-name | 4.1.0 | runtime | MIT | yes | npm registry | none | `node_modules/bundle-name` |
| call-bind | 1.0.8 | dev | MIT | yes | npm registry | none | `node_modules/call-bind` |
| call-bind-apply-helpers | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/call-bind-apply-helpers` |
| call-bound | 1.0.4 | dev | MIT | yes | npm registry | none | `node_modules/call-bound` |
| callsites | 3.1.0 | dev | MIT | yes | npm registry | none | `node_modules/callsites` |
| caniuse-lite | 1.0.30001800 | runtime | CC-BY-4.0 | yes | npm registry | none | `node_modules/caniuse-lite` |
| chalk | 4.1.2 | dev | MIT | yes | npm registry | none | `node_modules/chalk` |
| client-only | 0.0.1 | runtime | MIT | yes | npm registry | none | `node_modules/client-only` |
| color-convert | 2.0.1 | dev | MIT | yes | npm registry | none | `node_modules/color-convert` |
| color-name | 1.1.4 | dev | MIT | yes | npm registry | none | `node_modules/color-name` |
| concat-map | 0.0.1 | dev | MIT | yes | npm registry | none | `node_modules/concat-map` |
| convert-source-map | 2.0.0 | dev | MIT | yes | npm registry | none | `node_modules/convert-source-map` |
| cross-spawn | 7.0.6 | dev | MIT | yes | npm registry | none | `node_modules/cross-spawn` |
| csstype | 3.2.3 | dev | MIT | yes | npm registry | none | `node_modules/csstype` |
| damerau-levenshtein | 1.0.8 | dev | BSD-2-Clause | yes | npm registry | none | `node_modules/damerau-levenshtein` |
| data-view-buffer | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/data-view-buffer` |
| data-view-byte-length | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/data-view-byte-length` |
| data-view-byte-offset | 1.0.1 | dev | MIT | yes | npm registry | none | `node_modules/data-view-byte-offset` |
| debug | 3.2.7 | dev | MIT | yes | npm registry | none | `node_modules/eslint-import-resolver-node/node_modules/debug` |
| debug | 3.2.7 | dev | MIT | yes | npm registry | none | `node_modules/eslint-module-utils/node_modules/debug` |
| debug | 3.2.7 | dev | MIT | yes | npm registry | none | `node_modules/eslint-plugin-import/node_modules/debug` |
| debug | 4.4.3 | runtime | MIT | yes | npm registry | none | `node_modules/debug` |
| deep-is | 0.1.4 | dev | MIT | yes | npm registry | none | `node_modules/deep-is` |
| default-browser | 5.5.0 | runtime | MIT | yes | npm registry | none | `node_modules/default-browser` |
| default-browser-id | 5.0.1 | runtime | MIT | yes | npm registry | none | `node_modules/default-browser-id` |
| define-data-property | 1.1.4 | dev | MIT | yes | npm registry | none | `node_modules/define-data-property` |
| define-lazy-prop | 3.0.0 | runtime | MIT | yes | npm registry | none | `node_modules/define-lazy-prop` |
| define-properties | 1.2.1 | dev | MIT | yes | npm registry | none | `node_modules/define-properties` |
| detect-libc | 2.1.2 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/detect-libc` |
| doctrine | 2.1.0 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/doctrine` |
| dunder-proto | 1.0.1 | dev | MIT | yes | npm registry | none | `node_modules/dunder-proto` |
| ecdsa-sig-formatter | 1.0.11 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/ecdsa-sig-formatter` |
| electron-to-chromium | 1.5.382 | dev | ISC | yes | npm registry | none | `node_modules/electron-to-chromium` |
| emoji-regex | 9.2.2 | dev | MIT | yes | npm registry | none | `node_modules/emoji-regex` |
| enhanced-resolve | 5.20.1 | dev | MIT | yes | npm registry | none | `node_modules/enhanced-resolve` |
| es-abstract | 1.24.1 | dev | MIT | yes | npm registry | none | `node_modules/es-abstract` |
| es-define-property | 1.0.1 | dev | MIT | yes | npm registry | none | `node_modules/es-define-property` |
| es-errors | 1.3.0 | dev | MIT | yes | npm registry | none | `node_modules/es-errors` |
| es-iterator-helpers | 1.3.1 | dev | MIT | yes | npm registry | none | `node_modules/es-iterator-helpers` |
| es-object-atoms | 1.1.1 | dev | MIT | yes | npm registry | none | `node_modules/es-object-atoms` |
| es-set-tostringtag | 2.1.0 | dev | MIT | yes | npm registry | none | `node_modules/es-set-tostringtag` |
| es-shim-unscopables | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/es-shim-unscopables` |
| es-to-primitive | 1.3.0 | dev | MIT | yes | npm registry | none | `node_modules/es-to-primitive` |
| escalade | 3.2.0 | dev | MIT | yes | npm registry | none | `node_modules/escalade` |
| escape-string-regexp | 4.0.0 | dev | MIT | yes | npm registry | none | `node_modules/escape-string-regexp` |
| eslint | 9.39.4 | dev | MIT | yes | npm registry | none | `node_modules/eslint` |
| eslint-config-next | 16.2.11 | dev | MIT | yes | npm registry | none | `node_modules/eslint-config-next` |
| eslint-import-resolver-node | 0.3.9 | dev | MIT | yes | npm registry | none | `node_modules/eslint-import-resolver-node` |
| eslint-import-resolver-typescript | 3.10.1 | dev | ISC | yes | npm registry | none | `node_modules/eslint-import-resolver-typescript` |
| eslint-module-utils | 2.12.1 | dev | MIT | yes | npm registry | none | `node_modules/eslint-module-utils` |
| eslint-plugin-import | 2.32.0 | dev | MIT | yes | npm registry | none | `node_modules/eslint-plugin-import` |
| eslint-plugin-jsx-a11y | 6.10.2 | dev | MIT | yes | npm registry | none | `node_modules/eslint-plugin-jsx-a11y` |
| eslint-plugin-react | 7.37.5 | dev | MIT | yes | npm registry | none | `node_modules/eslint-plugin-react` |
| eslint-plugin-react-hooks | 7.0.1 | dev | MIT | yes | npm registry | none | `node_modules/eslint-plugin-react-hooks` |
| eslint-scope | 8.4.0 | dev | BSD-2-Clause | yes | npm registry | none | `node_modules/eslint-scope` |
| eslint-visitor-keys | 3.4.3 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@eslint-community/eslint-utils/node_modules/eslint-visitor-keys` |
| eslint-visitor-keys | 4.2.1 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/eslint-visitor-keys` |
| eslint-visitor-keys | 5.0.1 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/@typescript-eslint/visitor-keys/node_modules/eslint-visitor-keys` |
| espree | 10.4.0 | dev | BSD-2-Clause | yes | npm registry | none | `node_modules/espree` |
| esquery | 1.7.0 | dev | BSD-3-Clause | yes | npm registry | none | `node_modules/esquery` |
| esrecurse | 4.3.0 | dev | BSD-2-Clause | yes | npm registry | none | `node_modules/esrecurse` |
| estraverse | 5.3.0 | dev | BSD-2-Clause | yes | npm registry | none | `node_modules/estraverse` |
| esutils | 2.0.3 | dev | BSD-2-Clause | yes | npm registry | none | `node_modules/esutils` |
| events | 3.3.0 | runtime | MIT | yes | npm registry | none | `node_modules/events` |
| fast-deep-equal | 3.1.3 | dev | MIT | yes | npm registry | none | `node_modules/fast-deep-equal` |
| fast-glob | 3.3.1 | dev | MIT | yes | npm registry | none | `node_modules/fast-glob` |
| fast-json-stable-stringify | 2.1.0 | dev | MIT | yes | npm registry | none | `node_modules/fast-json-stable-stringify` |
| fast-levenshtein | 2.0.6 | dev | MIT | yes | npm registry | none | `node_modules/fast-levenshtein` |
| fast-xml-builder | 1.3.0 | runtime | MIT | yes | npm registry | none | `node_modules/fast-xml-builder` |
| fast-xml-parser | 5.10.1 | runtime | MIT | yes | npm registry | none | `node_modules/fast-xml-parser` |
| fastq | 1.20.1 | dev | ISC | yes | npm registry | none | `node_modules/fastq` |
| fdir | 6.5.0 | dev | MIT | yes | npm registry | none | `node_modules/tinyglobby/node_modules/fdir` |
| fflate | 0.8.3 | runtime | MIT | yes | npm registry | none | `node_modules/fflate` |
| file-entry-cache | 8.0.0 | dev | MIT | yes | npm registry | none | `node_modules/file-entry-cache` |
| fill-range | 7.1.1 | dev | MIT | yes | npm registry | none | `node_modules/fill-range` |
| find-up | 5.0.0 | dev | MIT | yes | npm registry | none | `node_modules/find-up` |
| flat-cache | 4.0.1 | dev | MIT | yes | npm registry | none | `node_modules/flat-cache` |
| flatted | 3.4.2 | dev | ISC | yes | npm registry | none | `node_modules/flatted` |
| for-each | 0.3.5 | dev | MIT | yes | npm registry | none | `node_modules/for-each` |
| fsevents | 2.3.2 | dev, optional | MIT | yes | npm registry | none | `node_modules/fsevents` |
| function-bind | 1.1.2 | dev | MIT | yes | npm registry | none | `node_modules/function-bind` |
| function.prototype.name | 1.1.8 | dev | MIT | yes | npm registry | none | `node_modules/function.prototype.name` |
| functions-have-names | 1.2.3 | dev | MIT | yes | npm registry | none | `node_modules/functions-have-names` |
| generator-function | 2.0.1 | dev | MIT | yes | npm registry | none | `node_modules/generator-function` |
| gensync | 1.0.0-beta.2 | dev | MIT | yes | npm registry | none | `node_modules/gensync` |
| get-intrinsic | 1.3.0 | dev | MIT | yes | npm registry | none | `node_modules/get-intrinsic` |
| get-proto | 1.0.1 | dev | MIT | yes | npm registry | none | `node_modules/get-proto` |
| get-symbol-description | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/get-symbol-description` |
| get-tsconfig | 4.13.6 | dev | MIT | yes | npm registry | none | `node_modules/get-tsconfig` |
| glob-parent | 5.1.2 | dev | ISC | yes | npm registry | none | `node_modules/fast-glob/node_modules/glob-parent` |
| glob-parent | 6.0.2 | dev | ISC | yes | npm registry | none | `node_modules/glob-parent` |
| globals | 14.0.0 | dev | MIT | yes | npm registry | none | `node_modules/globals` |
| globals | 16.4.0 | dev | MIT | yes | npm registry | none | `node_modules/eslint-config-next/node_modules/globals` |
| globalthis | 1.0.4 | dev | MIT | yes | npm registry | none | `node_modules/globalthis` |
| gopd | 1.2.0 | dev | MIT | yes | npm registry | none | `node_modules/gopd` |
| graceful-fs | 4.2.11 | dev | ISC | yes | npm registry | none | `node_modules/graceful-fs` |
| has-bigints | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/has-bigints` |
| has-flag | 4.0.0 | dev | MIT | yes | npm registry | none | `node_modules/has-flag` |
| has-property-descriptors | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/has-property-descriptors` |
| has-proto | 1.2.0 | dev | MIT | yes | npm registry | none | `node_modules/has-proto` |
| has-symbols | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/has-symbols` |
| has-tostringtag | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/has-tostringtag` |
| hasown | 2.0.2 | dev | MIT | yes | npm registry | none | `node_modules/hasown` |
| hermes-estree | 0.25.1 | dev | MIT | yes | npm registry | none | `node_modules/hermes-estree` |
| hermes-parser | 0.25.1 | dev | MIT | yes | npm registry | none | `node_modules/hermes-parser` |
| http-proxy-agent | 7.0.2 | runtime | MIT | yes | npm registry | none | `node_modules/http-proxy-agent` |
| https-proxy-agent | 7.0.6 | runtime | MIT | yes | npm registry | none | `node_modules/https-proxy-agent` |
| idb-keyval | 6.3.0 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/idb-keyval` |
| ignore | 5.3.2 | dev | MIT | yes | npm registry | none | `node_modules/ignore` |
| ignore | 7.0.5 | dev | MIT | yes | npm registry | none | `node_modules/@typescript-eslint/eslint-plugin/node_modules/ignore` |
| import-fresh | 3.3.1 | dev | MIT | yes | npm registry | none | `node_modules/import-fresh` |
| imurmurhash | 0.1.4 | dev | MIT | yes | npm registry | none | `node_modules/imurmurhash` |
| internal-slot | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/internal-slot` |
| is-array-buffer | 3.0.5 | dev | MIT | yes | npm registry | none | `node_modules/is-array-buffer` |
| is-async-function | 2.1.1 | dev | MIT | yes | npm registry | none | `node_modules/is-async-function` |
| is-bigint | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/is-bigint` |
| is-boolean-object | 1.2.2 | dev | MIT | yes | npm registry | none | `node_modules/is-boolean-object` |
| is-bun-module | 2.0.0 | dev | MIT | yes | npm registry | none | `node_modules/is-bun-module` |
| is-callable | 1.2.7 | dev | MIT | yes | npm registry | none | `node_modules/is-callable` |
| is-core-module | 2.16.1 | dev | MIT | yes | npm registry | none | `node_modules/is-core-module` |
| is-data-view | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/is-data-view` |
| is-date-object | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/is-date-object` |
| is-docker | 3.0.0 | runtime | MIT | yes | npm registry | none | `node_modules/is-docker` |
| is-extglob | 2.1.1 | dev | MIT | yes | npm registry | none | `node_modules/is-extglob` |
| is-finalizationregistry | 1.1.1 | dev | MIT | yes | npm registry | none | `node_modules/is-finalizationregistry` |
| is-generator-function | 1.1.2 | dev | MIT | yes | npm registry | none | `node_modules/is-generator-function` |
| is-glob | 4.0.3 | dev | MIT | yes | npm registry | none | `node_modules/is-glob` |
| is-inside-container | 1.0.0 | runtime | MIT | yes | npm registry | none | `node_modules/is-inside-container` |
| is-map | 2.0.3 | dev | MIT | yes | npm registry | none | `node_modules/is-map` |
| is-negative-zero | 2.0.3 | dev | MIT | yes | npm registry | none | `node_modules/is-negative-zero` |
| is-number | 7.0.0 | dev | MIT | yes | npm registry | none | `node_modules/is-number` |
| is-number-object | 1.1.1 | dev | MIT | yes | npm registry | none | `node_modules/is-number-object` |
| is-regex | 1.2.1 | dev | MIT | yes | npm registry | none | `node_modules/is-regex` |
| is-set | 2.0.3 | dev | MIT | yes | npm registry | none | `node_modules/is-set` |
| is-shared-array-buffer | 1.0.4 | dev | MIT | yes | npm registry | none | `node_modules/is-shared-array-buffer` |
| is-string | 1.1.1 | dev | MIT | yes | npm registry | none | `node_modules/is-string` |
| is-symbol | 1.1.1 | dev | MIT | yes | npm registry | none | `node_modules/is-symbol` |
| is-typed-array | 1.1.15 | dev | MIT | yes | npm registry | none | `node_modules/is-typed-array` |
| is-unsafe | 2.0.0 | runtime | MIT | yes | npm registry | none | `node_modules/is-unsafe` |
| is-url | 1.2.4 | runtime | MIT | yes | npm registry | none | `node_modules/is-url` |
| is-weakmap | 2.0.2 | dev | MIT | yes | npm registry | none | `node_modules/is-weakmap` |
| is-weakref | 1.1.1 | dev | MIT | yes | npm registry | none | `node_modules/is-weakref` |
| is-weakset | 2.0.4 | dev | MIT | yes | npm registry | none | `node_modules/is-weakset` |
| is-wsl | 3.1.1 | runtime | MIT | yes | npm registry | none | `node_modules/is-wsl` |
| isarray | 2.0.5 | dev | MIT | yes | npm registry | none | `node_modules/isarray` |
| isexe | 2.0.0 | dev | ISC | yes | npm registry | none | `node_modules/isexe` |
| iterator.prototype | 1.1.5 | dev | MIT | yes | npm registry | none | `node_modules/iterator.prototype` |
| jiti | 2.6.1 | dev | MIT | yes | npm registry | none | `node_modules/jiti` |
| jose | 6.2.8 | runtime | MIT | yes | npm registry | none | `node_modules/jose` |
| js-tokens | 4.0.0 | dev | MIT | yes | npm registry | none | `node_modules/js-tokens` |
| js-yaml | 4.3.1 | dev | MIT | yes | npm registry | none | `node_modules/js-yaml` |
| jsesc | 3.1.0 | dev | MIT | yes | npm registry | none | `node_modules/jsesc` |
| json-buffer | 3.0.1 | dev | MIT | yes | npm registry | none | `node_modules/json-buffer` |
| json-schema-traverse | 0.4.1 | dev | MIT | yes | npm registry | none | `node_modules/json-schema-traverse` |
| json-stable-stringify-without-jsonify | 1.0.1 | dev | MIT | yes | npm registry | none | `node_modules/json-stable-stringify-without-jsonify` |
| json5 | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/tsconfig-paths/node_modules/json5` |
| json5 | 2.2.3 | dev | MIT | yes | npm registry | none | `node_modules/json5` |
| jsonwebtoken | 9.0.3 | runtime | MIT | yes | npm registry | none | `node_modules/jsonwebtoken` |
| jsx-ast-utils | 3.3.5 | dev | MIT | yes | npm registry | none | `node_modules/jsx-ast-utils` |
| jwa | 2.0.1 | runtime | MIT | yes | npm registry | none | `node_modules/jwa` |
| jws | 4.0.1 | runtime | MIT | yes | npm registry | none | `node_modules/jws` |
| keyv | 4.5.4 | dev | MIT | yes | npm registry | none | `node_modules/keyv` |
| language-subtag-registry | 0.3.23 | dev | CC0-1.0 | yes | npm registry | none | `node_modules/language-subtag-registry` |
| language-tags | 1.0.9 | dev | MIT | yes | npm registry | none | `node_modules/language-tags` |
| levn | 0.4.1 | dev | MIT | yes | npm registry | none | `node_modules/levn` |
| lightningcss | 1.32.0 | dev | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss` |
| lightningcss-android-arm64 | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-android-arm64` |
| lightningcss-darwin-arm64 | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-darwin-arm64` |
| lightningcss-darwin-x64 | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-darwin-x64` |
| lightningcss-freebsd-x64 | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-freebsd-x64` |
| lightningcss-linux-arm-gnueabihf | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-linux-arm-gnueabihf` |
| lightningcss-linux-arm64-gnu | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-linux-arm64-gnu` |
| lightningcss-linux-arm64-musl | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-linux-arm64-musl` |
| lightningcss-linux-x64-gnu | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-linux-x64-gnu` |
| lightningcss-linux-x64-musl | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-linux-x64-musl` |
| lightningcss-win32-arm64-msvc | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-win32-arm64-msvc` |
| lightningcss-win32-x64-msvc | 1.32.0 | dev, optional | MPL-2.0 | yes | npm registry | none | `node_modules/lightningcss-win32-x64-msvc` |
| locate-path | 6.0.0 | dev | MIT | yes | npm registry | none | `node_modules/locate-path` |
| lodash.includes | 4.3.0 | runtime | MIT | yes | npm registry | none | `node_modules/lodash.includes` |
| lodash.isboolean | 3.0.3 | runtime | MIT | yes | npm registry | none | `node_modules/lodash.isboolean` |
| lodash.isinteger | 4.0.4 | runtime | MIT | yes | npm registry | none | `node_modules/lodash.isinteger` |
| lodash.isnumber | 3.0.3 | runtime | MIT | yes | npm registry | none | `node_modules/lodash.isnumber` |
| lodash.isplainobject | 4.0.6 | runtime | MIT | yes | npm registry | none | `node_modules/lodash.isplainobject` |
| lodash.isstring | 4.0.1 | runtime | MIT | yes | npm registry | none | `node_modules/lodash.isstring` |
| lodash.merge | 4.6.2 | dev | MIT | yes | npm registry | none | `node_modules/lodash.merge` |
| lodash.once | 4.1.1 | runtime | MIT | yes | npm registry | none | `node_modules/lodash.once` |
| loose-envify | 1.4.0 | dev | MIT | yes | npm registry | none | `node_modules/loose-envify` |
| lru-cache | 5.1.1 | dev | ISC | yes | npm registry | none | `node_modules/lru-cache` |
| lucide-react | 0.577.0 | runtime | ISC | yes | npm registry | none | `node_modules/lucide-react` |
| magic-string | 0.30.21 | dev | MIT | yes | npm registry | none | `node_modules/magic-string` |
| math-intrinsics | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/math-intrinsics` |
| merge2 | 1.4.1 | dev | MIT | yes | npm registry | none | `node_modules/merge2` |
| micromatch | 4.0.8 | dev | MIT | yes | npm registry | none | `node_modules/micromatch` |
| minimatch | 10.2.4 | dev | BlueOak-1.0.0 | yes | npm registry | none | `node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch` |
| minimatch | 3.1.5 | dev | ISC | yes | npm registry | none | `node_modules/minimatch` |
| minimist | 1.2.8 | dev | MIT | yes | npm registry | none | `node_modules/minimist` |
| ms | 2.1.3 | runtime | MIT | yes | npm registry | none | `node_modules/ms` |
| nanoid | 3.3.18 | runtime | MIT | yes | npm registry | none | `node_modules/nanoid` |
| napi-postinstall | 0.3.4 | dev | MIT | yes | npm registry | none | `node_modules/napi-postinstall` |
| natural-compare | 1.4.0 | dev | MIT | yes | npm registry | none | `node_modules/natural-compare` |
| next | 16.2.11 | runtime | MIT | yes | npm registry | none | `node_modules/next` |
| node-exports-info | 1.6.0 | dev | MIT | yes | npm registry | none | `node_modules/node-exports-info` |
| node-fetch | 2.7.0 | runtime | MIT | yes | npm registry | none | `node_modules/node-fetch` |
| node-releases | 2.0.50 | dev | MIT | yes | npm registry | none | `node_modules/node-releases` |
| object-assign | 4.1.1 | dev | MIT | yes | npm registry | none | `node_modules/object-assign` |
| object-inspect | 1.13.4 | dev | MIT | yes | npm registry | none | `node_modules/object-inspect` |
| object-keys | 1.1.1 | dev | MIT | yes | npm registry | none | `node_modules/object-keys` |
| object.assign | 4.1.7 | dev | MIT | yes | npm registry | none | `node_modules/object.assign` |
| object.entries | 1.1.9 | dev | MIT | yes | npm registry | none | `node_modules/object.entries` |
| object.fromentries | 2.0.8 | dev | MIT | yes | npm registry | none | `node_modules/object.fromentries` |
| object.groupby | 1.0.3 | dev | MIT | yes | npm registry | none | `node_modules/object.groupby` |
| object.values | 1.2.1 | dev | MIT | yes | npm registry | none | `node_modules/object.values` |
| open | 10.2.0 | runtime | MIT | yes | npm registry | none | `node_modules/open` |
| opencollective-postinstall | 2.0.3 | runtime | MIT | yes | npm registry | none | `node_modules/opencollective-postinstall` |
| optionator | 0.9.4 | dev | MIT | yes | npm registry | none | `node_modules/optionator` |
| own-keys | 1.0.1 | dev | MIT | yes | npm registry | none | `node_modules/own-keys` |
| p-limit | 3.1.0 | dev | MIT | yes | npm registry | none | `node_modules/p-limit` |
| p-locate | 5.0.0 | dev | MIT | yes | npm registry | none | `node_modules/p-locate` |
| parent-module | 1.0.1 | dev | MIT | yes | npm registry | none | `node_modules/parent-module` |
| path-exists | 4.0.0 | dev | MIT | yes | npm registry | none | `node_modules/path-exists` |
| path-expression-matcher | 1.6.2 | runtime | MIT | yes | npm registry | none | `node_modules/path-expression-matcher` |
| path-key | 3.1.1 | dev | MIT | yes | npm registry | none | `node_modules/path-key` |
| path-parse | 1.0.7 | dev | MIT | yes | npm registry | none | `node_modules/path-parse` |
| pdfjs-dist | 6.2.108 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/pdfjs-dist` |
| picocolors | 1.1.1 | runtime | ISC | yes | npm registry | none | `node_modules/picocolors` |
| picomatch | 2.3.2 | dev | MIT | yes | npm registry | none | `node_modules/picomatch` |
| picomatch | 4.0.4 | dev | MIT | yes | npm registry | none | `node_modules/tinyglobby/node_modules/picomatch` |
| playwright | 1.61.1 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/playwright` |
| playwright-core | 1.61.1 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/playwright-core` |
| possible-typed-array-names | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/possible-typed-array-names` |
| postcss | 8.5.26 | runtime | MIT | yes | npm registry | none | `node_modules/postcss` |
| postgres | 3.4.9 | runtime | Unlicense | yes | npm registry | none | `node_modules/postgres` |
| prelude-ls | 1.2.1 | dev | MIT | yes | npm registry | none | `node_modules/prelude-ls` |
| prop-types | 15.8.1 | dev | MIT | yes | npm registry | none | `node_modules/prop-types` |
| punycode | 2.3.1 | dev | MIT | yes | npm registry | none | `node_modules/punycode` |
| queue-microtask | 1.2.3 | dev | MIT | yes | npm registry | none | `node_modules/queue-microtask` |
| react | 19.2.4 | runtime | MIT | yes | npm registry | none | `node_modules/react` |
| react-dom | 19.2.4 | runtime | MIT | yes | npm registry | none | `node_modules/react-dom` |
| react-is | 16.13.1 | dev | MIT | yes | npm registry | none | `node_modules/react-is` |
| reflect.getprototypeof | 1.0.10 | dev | MIT | yes | npm registry | none | `node_modules/reflect.getprototypeof` |
| regenerator-runtime | 0.13.11 | runtime | MIT | yes | npm registry | none | `node_modules/regenerator-runtime` |
| regexp.prototype.flags | 1.5.4 | dev | MIT | yes | npm registry | none | `node_modules/regexp.prototype.flags` |
| resolve | 1.22.11 | dev | MIT | yes | npm registry | none | `node_modules/resolve` |
| resolve | 2.0.0-next.6 | dev | MIT | yes | npm registry | none | `node_modules/eslint-plugin-react/node_modules/resolve` |
| resolve-from | 4.0.0 | dev | MIT | yes | npm registry | none | `node_modules/resolve-from` |
| resolve-pkg-maps | 1.0.0 | dev | MIT | yes | npm registry | none | `node_modules/resolve-pkg-maps` |
| reusify | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/reusify` |
| run-applescript | 7.1.0 | runtime | MIT | yes | npm registry | none | `node_modules/run-applescript` |
| run-parallel | 1.2.0 | dev | MIT | yes | npm registry | none | `node_modules/run-parallel` |
| safe-array-concat | 1.1.3 | dev | MIT | yes | npm registry | none | `node_modules/safe-array-concat` |
| safe-buffer | 5.2.1 | runtime | MIT | yes | npm registry | none | `node_modules/safe-buffer` |
| safe-push-apply | 1.0.0 | dev | MIT | yes | npm registry | none | `node_modules/safe-push-apply` |
| safe-regex-test | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/safe-regex-test` |
| scheduler | 0.27.0 | runtime | MIT | yes | npm registry | none | `node_modules/scheduler` |
| semver | 6.3.1 | dev | ISC | yes | npm registry | none | `node_modules/semver` |
| semver | 7.7.4 | dev | ISC | yes | npm registry | none | `node_modules/@typescript-eslint/typescript-estree/node_modules/semver` |
| semver | 7.7.4 | dev | ISC | yes | npm registry | none | `node_modules/is-bun-module/node_modules/semver` |
| semver | 7.8.5 | runtime | ISC | yes | npm registry | none | `node_modules/jsonwebtoken/node_modules/semver` |
| semver | 7.8.5 | runtime, optional | ISC | yes | npm registry | none | `node_modules/sharp/node_modules/semver` |
| server-only | 0.0.1 | runtime | MIT | yes | npm registry | none | `node_modules/server-only` |
| set-function-length | 1.2.2 | dev | MIT | yes | npm registry | none | `node_modules/set-function-length` |
| set-function-name | 2.0.2 | dev | MIT | yes | npm registry | none | `node_modules/set-function-name` |
| set-proto | 1.0.0 | dev | MIT | yes | npm registry | none | `node_modules/set-proto` |
| sharp | 0.35.3 | runtime, optional | Apache-2.0 | yes | npm registry | none | `node_modules/sharp` |
| shebang-command | 2.0.0 | dev | MIT | yes | npm registry | none | `node_modules/shebang-command` |
| shebang-regex | 3.0.0 | dev | MIT | yes | npm registry | none | `node_modules/shebang-regex` |
| side-channel | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/side-channel` |
| side-channel-list | 1.0.0 | dev | MIT | yes | npm registry | none | `node_modules/side-channel-list` |
| side-channel-map | 1.0.1 | dev | MIT | yes | npm registry | none | `node_modules/side-channel-map` |
| side-channel-weakmap | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/side-channel-weakmap` |
| source-map-js | 1.2.1 | runtime | BSD-3-Clause | yes | npm registry | none | `node_modules/source-map-js` |
| stable-hash | 0.0.5 | dev | MIT | yes | npm registry | none | `node_modules/stable-hash` |
| stop-iteration-iterator | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/stop-iteration-iterator` |
| string.prototype.includes | 2.0.1 | dev | MIT | yes | npm registry | none | `node_modules/string.prototype.includes` |
| string.prototype.matchall | 4.0.12 | dev | MIT | yes | npm registry | none | `node_modules/string.prototype.matchall` |
| string.prototype.repeat | 1.0.0 | dev | MIT | yes | npm registry | none | `node_modules/string.prototype.repeat` |
| string.prototype.trim | 1.2.10 | dev | MIT | yes | npm registry | none | `node_modules/string.prototype.trim` |
| string.prototype.trimend | 1.0.9 | dev | MIT | yes | npm registry | none | `node_modules/string.prototype.trimend` |
| string.prototype.trimstart | 1.0.8 | dev | MIT | yes | npm registry | none | `node_modules/string.prototype.trimstart` |
| strip-bom | 3.0.0 | dev | MIT | yes | npm registry | none | `node_modules/strip-bom` |
| strip-json-comments | 3.1.1 | dev | MIT | yes | npm registry | none | `node_modules/strip-json-comments` |
| strnum | 2.4.1 | runtime | MIT | yes | npm registry | none | `node_modules/strnum` |
| styled-jsx | 5.1.6 | runtime | MIT | yes | npm registry | none | `node_modules/styled-jsx` |
| supports-color | 7.2.0 | dev | MIT | yes | npm registry | none | `node_modules/supports-color` |
| supports-preserve-symlinks-flag | 1.0.0 | dev | MIT | yes | npm registry | none | `node_modules/supports-preserve-symlinks-flag` |
| tailwindcss | 4.2.2 | dev | MIT | yes | npm registry | none | `node_modules/tailwindcss` |
| tapable | 2.3.0 | dev | MIT | yes | npm registry | none | `node_modules/tapable` |
| tesseract.js | 7.0.0 | runtime | Apache-2.0 | yes | npm registry | postinstall | `node_modules/tesseract.js` |
| tesseract.js-core | 7.0.0 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/tesseract.js-core` |
| tinyglobby | 0.2.15 | dev | MIT | yes | npm registry | none | `node_modules/tinyglobby` |
| to-regex-range | 5.0.1 | dev | MIT | yes | npm registry | none | `node_modules/to-regex-range` |
| tr46 | 0.0.3 | runtime | MIT | yes | npm registry | none | `node_modules/tr46` |
| ts-api-utils | 2.5.0 | dev | MIT | yes | npm registry | none | `node_modules/ts-api-utils` |
| tsconfig-paths | 3.15.0 | dev | MIT | yes | npm registry | none | `node_modules/tsconfig-paths` |
| tslib | 2.8.1 | dev, optional | 0BSD | no | npm registry | none | `node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/tslib` |
| tslib | 2.8.1 | runtime | 0BSD | yes | npm registry | none | `node_modules/tslib` |
| type-check | 0.4.0 | dev | MIT | yes | npm registry | none | `node_modules/type-check` |
| typed-array-buffer | 1.0.3 | dev | MIT | yes | npm registry | none | `node_modules/typed-array-buffer` |
| typed-array-byte-length | 1.0.3 | dev | MIT | yes | npm registry | none | `node_modules/typed-array-byte-length` |
| typed-array-byte-offset | 1.0.4 | dev | MIT | yes | npm registry | none | `node_modules/typed-array-byte-offset` |
| typed-array-length | 1.0.7 | dev | MIT | yes | npm registry | none | `node_modules/typed-array-length` |
| typescript | 5.9.3 | dev | Apache-2.0 | yes | npm registry | none | `node_modules/typescript` |
| typescript-eslint | 8.57.1 | dev | MIT | yes | npm registry | none | `node_modules/typescript-eslint` |
| unbox-primitive | 1.1.0 | dev | MIT | yes | npm registry | none | `node_modules/unbox-primitive` |
| undici-types | 6.21.0 | dev | MIT | yes | npm registry | none | `node_modules/undici-types` |
| unrs-resolver | 1.11.1 | dev | MIT | yes | npm registry | postinstall | `node_modules/unrs-resolver` |
| update-browserslist-db | 1.2.3 | dev | MIT | yes | npm registry | none | `node_modules/update-browserslist-db` |
| uri-js | 4.4.1 | dev | BSD-2-Clause | yes | npm registry | none | `node_modules/uri-js` |
| wasm-feature-detect | 1.8.0 | runtime | Apache-2.0 | yes | npm registry | none | `node_modules/wasm-feature-detect` |
| webidl-conversions | 3.0.1 | runtime | BSD-2-Clause | yes | npm registry | none | `node_modules/webidl-conversions` |
| whatwg-url | 5.0.0 | runtime | MIT | yes | npm registry | none | `node_modules/whatwg-url` |
| which | 2.0.2 | dev | ISC | yes | npm registry | none | `node_modules/which` |
| which-boxed-primitive | 1.1.1 | dev | MIT | yes | npm registry | none | `node_modules/which-boxed-primitive` |
| which-builtin-type | 1.2.1 | dev | MIT | yes | npm registry | none | `node_modules/which-builtin-type` |
| which-collection | 1.0.2 | dev | MIT | yes | npm registry | none | `node_modules/which-collection` |
| which-typed-array | 1.1.20 | dev | MIT | yes | npm registry | none | `node_modules/which-typed-array` |
| word-wrap | 1.2.5 | dev | MIT | yes | npm registry | none | `node_modules/word-wrap` |
| wsl-utils | 0.1.0 | runtime | MIT | yes | npm registry | none | `node_modules/wsl-utils` |
| xml-naming | 0.3.0 | runtime | MIT | yes | npm registry | none | `node_modules/xml-naming` |
| yallist | 3.1.1 | dev | ISC | yes | npm registry | none | `node_modules/yallist` |
| yocto-queue | 0.1.0 | dev | MIT | yes | npm registry | none | `node_modules/yocto-queue` |
| zlibjs | 0.3.1 | runtime | MIT | yes | npm registry | none | `node_modules/zlibjs` |
| zod | 4.3.6 | dev | MIT | yes | npm registry | none | `node_modules/zod` |
| zod-validation-error | 4.0.2 | dev | MIT | yes | npm registry | none | `node_modules/zod-validation-error` |

## Dependency Duplication and Install Hooks

- `@azure/msal-browser`: 4.30.0, 5.18.0
- `@azure/msal-common`: 15.17.0, 16.12.0
- `@emnapi/core`: 1.8.1, 1.9.1
- `@emnapi/runtime`: 1.11.3, 1.8.1
- `@emnapi/wasi-threads`: 1.1.0, 1.2.0
- `@napi-rs/wasm-runtime`: 0.2.12, 1.1.1
- `balanced-match`: 1.0.2, 4.0.4
- `brace-expansion`: 1.1.18, 5.0.9
- `debug`: 3.2.7, 4.4.3
- `eslint-visitor-keys`: 3.4.3, 4.2.1, 5.0.1
- `glob-parent`: 5.1.2, 6.0.2
- `globals`: 14.0.0, 16.4.0
- `ignore`: 5.3.2, 7.0.5
- `json5`: 1.0.2, 2.2.3
- `minimatch`: 10.2.4, 3.1.5
- `picomatch`: 2.3.2, 4.0.4
- `resolve`: 1.22.11, 2.0.0-next.6
- `semver`: 6.3.1, 7.7.4, 7.8.5

- `tesseract.js@7.0.0`: postinstall at `node_modules/tesseract.js`
- `unrs-resolver@1.11.1`: postinstall at `node_modules/unrs-resolver`

## Review Method

1. Enumerate Git-tracked and non-ignored untracked paths; separate paths already deleted in the worktree.
2. Read every existing file as bytes and every recognized text file as UTF-8.
3. Classify role/risk and scan for large modules, type escapes, dynamic execution, secret-like public variables, runtime logging, subprocesses, destructive operations, timers, browser storage, hard-coded URLs, broad SQL, silent catches, and embedded credential patterns.
4. Parse `package.json`, `package-lock.json`, installed package manifests, and `npm ls --all` to capture versions, licenses, source integrity, install hooks, dependency edges, and tree problems.
5. Associate every file class with the executable verification required before release.

Machine-readable evidence:
- `docs/reliability/repository-file-inventory.json`
- `docs/reliability/dependency-inventory.json`
