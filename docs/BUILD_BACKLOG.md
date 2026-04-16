## Core Improvements (P0)
- Wire `NewReferralModal.tsx` submit flow to persistent referral creation instead of closing the modal only
- Replace mock state in `Referrals.tsx` with real referral data loading
- Replace mock state in `Assessments.tsx` with real packet data loading
- Add env validation around `lib/supabase/client.ts` so missing Supabase keys fail clearly
- Persist packet uploads from `NewReferralModal.tsx` and `Assessments.tsx` instead of mock extraction only

## Features In Progress / Next Up (P1)
- Align route names and UI labels so `/referrals` maps cleanly to Intake and `/assessments` maps cleanly to Packets
- Add referral-to-community routing handoff from `PipelineOverview.tsx` and `Communities.tsx`
- Add packet checklist status to `Referrals.tsx` rows and quick review panel
- Add save/reset handling for edited extracted fields in `Assessments.tsx`
- Connect `PipelineHeader.tsx` search to real data-backed filtering across pages

## Nice to Have (P2)
- Add loading and empty states that match current page surfaces in `PipelineOverview.tsx`, `Referrals.tsx`, and `Assessments.tsx`
- Add component-level tests for `NewReferralModal.tsx` packet-to-form flow
- Add component-level tests for `pipeline-shell-context.tsx` search propagation
- Add a lightweight file ownership map to `docs/FILE_MAP.md`
- Expand `wiki/INDEX.md` with page-by-page workflow notes
