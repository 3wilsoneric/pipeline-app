# Pipeline engineering documentation

Start here for current engineering work. The application layout remains `app/` for HTTP/routes, `components/` for UI, and `lib/` for domain and infrastructure owners; no top-level folder reorganization is needed.

## Authority and purpose

| Question | Start here |
| --- | --- |
| What work is authorized, and what checks should I run? | [Repository working policy](../AGENTS.md) and [verification commands](../scripts/README.md) |
| How do the application boundaries fit together? | [Architecture overview](ARCHITECTURE.md) |
| Where is a particular implementation? | [File map](FILE_MAP.md); verify the actual file before editing |
| How should referral data be loaded, edited, and joined to clinical data? | [Data architecture](ENGINEERING_DATA_ARCHITECTURE.md) and the current domain owners/tests |
| What did the earlier refactor program prove? | [Historical refactoring records](refactoring/README.md), bounded to their recorded commits |

Current owner instructions govern product intent. Historical documents must not reintroduce retired workflow locks, roles, or approval gates. Check the branch and commit before assuming an old report describes current production.

## Historical reports

Dated audits, performance certifications, deployment reports, and baseline snapshots describe their capture date and candidate, not a continuously maintained health claim. Their existing paths are retained because tests, evidence records, and links can reference them. Start from the current owners above; consult these reports as evidence, not live instructions. Do not move or rewrite evidence simply to tidy this directory.

## Structural cleanup scope — September 20, 2026

- Change detection includes deletion and both rename paths; empty/unknown change sets require both integration surfaces.
- `check:saving` exercises current saving, offline-session, upload-retry, and audit-value owners without launching browsers or touching production.
- Audit value construction is shared; local/SQL writes remain separate, and SQL audit writes remain inside their existing transactions.
- Artifact cleanup defaults to preview and requires explicit old, inactive artifact selections before deletion. No automatic pre-commit cleanup.
- Workbook ZIP/XML processing is loaded when an Excel action is used, not via an eager UI import. This is a loading-boundary improvement, not a measured production-latency certification.
- Untracked tools, local environment files, `src/app/favicon.ico`, local data, and other tasks' work are retained; lack of an obvious current caller is not deletion authority.
