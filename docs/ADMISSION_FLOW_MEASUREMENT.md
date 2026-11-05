# Admission flow measurement

Pipeline records the dates needed to study time from referral receipt to actual arrival without adding assessor tasks. The Admissions team uses the existing handoff drawer to record a client-ready date or a current hold when those facts cannot be inferred. Only coordinators and admins can save them.

## Definitions

- **Received:** referral-received date on the workspace, which can predate workspace creation. Missing or invalid dates have no measured interval.
- **Assessment performed:** the assessment date captured when the assessor starts the interview or explicitly corrects the performed date. Scheduling, signing, and acceptance are never substituted for it.
- **Ready to move in:** coordinator-entered date after an accepted decision and resolution of blocking move-in requirements. This is a documented operational judgment, not an inferred date. Corrections keep a revision history and audit event.
- **Actual arrival:** staff-confirmed `actualAdmissionDate`. Planned dates, acceptance, and due plans do not count.
- **Hold:** one current structured reason with the party responsible for the next action. Opening and ending are timestamped and audited; earlier holds remain on the referral. A hold is evidence of waiting, not a declaration that its duration was avoidable.
- **First change:** first audited referral change after creation. It does not prove the first phone call, first file read, or first human contact.
- **Rework / handoffs:** recorded assessment reschedules, cancellations, no-shows or changes requests / recorded reassignment and unassignment events. These counts reflect events, not a clinical judgment.

The **Admission flow** report in Pipeline Reports includes admitted, still-open, declined, and cancelled referrals. Only actual arrivals enter arrival-time metrics; open referrals remain visible with their current age. Date coverage is displayed so missing milestones cannot silently improve the averages. All dates is the default; selecting a month forms a cohort by the referral's received date, including cases still open. The report can also be filtered by community or assigned owner and exported with the existing audited CSV path. Received and actual-arrival dates are visible alongside referral source, county, and assigned owner; that owner is not asserted to be the person who performed the assessment.

The report does not label any duration as avoidable. Readiness, staffed-bed constraints, and client or source holds help the weekly review locate specific delays. Early discharge and other post-arrival balancing outcomes require a verified clinical stay link; the report does not invent them from the referral record.

## Operating practice

1. Assessors continue the existing interview and signing workflow. They have no admission-flow controls.
2. Coordinators record ready date when the client is actually ready, or record a hold only when a real wait needs explanation. End a hold when it resolves.
3. Coordinators confirm actual arrival separately after move-in. Admission and placement cancellation close an open hold automatically.
4. Each week, review missing dates, older open cases, long ready-to-arrival waits, and cases with no current hold explanation. Reconcile actual arrivals with ElderMark stays before citing a portfolio result.
5. Compare both median and distribution of admitted-case time with the age of the entire open queue. A faster admitted cohort alone does not prove the backlog improved.
