# Local Two-Account Pipeline

Run `npm run demo:personas` from this separate checkout. Open
http://127.0.0.1:3216. This is local-only, not a shareable production URL.

The small account switch beside the profile changes between:

- Alex Morgan: Supervisor, with administrator and coordination access.
- Jordan Lee: Assessor, with reviewer/viewer permissions, not administrator impersonation.

Use the normal intake to create a referral and assign Jordan. Switch to Assessor
to find it on Home, schedule and complete the real assessment. Switch back to
Supervisor to review and decide. The switch is also available in the full-screen
assessment. Pending intake/assessment edits are saved first; failed saves keep
the current page open. Switching returns Home and clears in-memory caches.

## One-Button Walkthrough

Learning Center -> Assessor orientation opens the existing presentation. The
last slide gives a field-specific Language Lab overview. Enter demo then prepares
nine synthetic local referrals through the normal referral, document, and
assessment APIs and opens Jordan's Assessor Home. Jordan sees seven assigned
cases in ready-to-schedule, scheduled, and assessment states; Alex sees those
same cases plus two unassigned referrals on Supervisor Home. Taylor Rivera is
the case to schedule and assess. Relative appointment dates are set on first
preparation, then saved like ordinary appointments.

Preparation happens only after starting this walkthrough, not when opening the
blank Assessment Lab. Reopening the presentation finds the same tagged cases;
it does not recreate them or overwrite practice edits. If preparation is
interrupted partway through, the partial synthetic record is kept for inspection;
use `npm run demo:personas -- --port=<demo-port> --reset` on that exact demo port before starting a clean
case set. These local fixtures are not copied to production or live accounts.

## Assessment Lab

Use Assessment lab in the header (Lab on narrow screens), the full-screen
assessment, or Learning Center's separate blank-lab command. It opens a full-screen, disposable questionnaire
without unloading the referral underneath. Back to referral returns to that exact
workspace. The lab starts blank at section one every time; all twelve sections
can be selected directly, or visited with Back/Next without entering answers.
Conditional follow-ups and field-specific Answer help use the existing schema
and authored guidance. Lab answers are memory-only and never update a referral,
assessment, saved practice record, or completion report. The standalone
`/note-lab/practice` route is also fresh in this copy; ordinary production practice
continues to retain its existing saved-practice behavior.

## Isolation

Only synthetic practice data belongs here. Referrals, assessments, documents,
contacts and per-user saved state live in `.data/persona-demo-3216/`. No live
records are copied. The launcher discards inherited integration settings;
startup rejects external credentials or data paths. Clinical sources are
disconnected. Email delivery is disabled, not silently redirected or reported
as sent. Normal application authorization and workflow rules still apply.

The local role cookie is shared by tabs on this demo port. Use the switch in one
tab; an older tab must reload before continuing after another tab switches.
It is not a public authentication mechanism. Hosting for other users requires
a separately authenticated sandbox and isolated stores, not removing these guards.

## Stop Or Start Fresh

Ctrl+C stops the server. Starting again preserves practice records. To start
fresh, stop the server, run `npm run demo:personas -- --reset`, then start again.
Reset moves the previous practice directory to a timestamped backup; it does
not delete it. Production, the original checkout and live accounts are untouched.

## Focused Checks

`node --test scripts/persona-demo-isolation.test.mjs`

`npx playwright test -c playwright.persona-demo.config.ts`

Browser checks use their own port and directory (3217). They cover the shell,
profile menu, role restrictions, stale-tab saves, pending-intake handoff, and
the scheduling/assessment/recommendation/supervisor-decision journey. The long
form's completion fixture uses canonical test helpers, not a product bypass.
This is bounded workflow evidence, not certification of every application feature.
