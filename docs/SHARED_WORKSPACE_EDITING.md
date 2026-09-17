# Shared workspace editing — September 17, 2026

Every approved, signed-in Pipeline user can work on any active referral, regardless of assignment or whether their current role is admin, assessment coordinator, assessor (`reviewer`), or viewer. The existing login and approved-access boundary remains. No account roles, invitations, or Entra configuration change in this release.

Assignment identifies responsibility and drives an explicitly selected Mine filter. It does not authorize edits. Team views, client history, completion reports and workflow controls use the shared workspace policy. The canonical policy is `canEditWorkspace` in `lib/pipeline/referral-ownership.ts`; referral and assessment access helpers reuse it.

Approved teammates can create incomplete referrals, update intake and assignment, schedule/start/edit assessments, upload and manage documents, maintain contacts and identity links, record recommendations and admission decisions, sign, add attributed addenda, and explicitly prepare/send a packet. Acceptance, signature and packet delivery remain separate actions. No automatic email or signature is introduced.

Changes and signatures retain the acting user's actual identity and role. Personal recovery drafts stay private to their signed-in author while every approved role can save, read and clear its own drafts. Admin-only account administration and God mode are not granted through shared workspace access. Note Lab-only and unapproved accounts remain outside Pipeline.

Signed originals and historical workspaces retain their existing integrity rules and correction/new-intake paths. Version conflicts still protect against overwriting teammates' work. Storage failures are never represented as successful saves. External packet delivery retains explicit confirmation, recipients and safe-file checks. These are record integrity and delivery conditions, not per-person editing restrictions.

This is the intentionally simple current policy. Add a permission distinction only after an explicit product decision identifies a specific action that should be restricted; keep assignment and visual scope separate from that authorization decision.

## Evidence and release status

Focused evidence covers all four roles editing another assessor's referral and questionnaire, acceptance before signing, signer/addendum attribution, reports, team access, private recovery, browser intake/upload/document deletion and questionnaire editing, unapproved/anonymous access rejection, and same-origin protection. The same API sequence runs against isolated local-file and disposable PostgreSQL stores. No production records or real email are used.

Exact commit, commands and results are recorded in `.data/releases/shared-workspace-editing-handoff.json`. This branch is held for integration with the other queued work; it does not deploy or remove the maintenance cover. The earlier document-controls migration 0037 must precede app rollout. Independent presentation integration and its recorded offline reconciliation edge remain separate follow-ups.
