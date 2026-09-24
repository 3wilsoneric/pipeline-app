"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { getPlannedAdmissionDate, plannedAdmissionDateError } from "@/lib/pipeline/admission-lifecycle";
import { normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import type { Referral } from "@/lib/pipeline/referral-types";
import styles from "./MeetClientEmailPage.module.css";

export default function MeetClientAdmissionReview({ referral, editable, demo, onConfirm, onReviewWithoutDate, onSavingChange, onReload }: {
  referral: Referral;
  editable: boolean;
  demo: boolean;
  onConfirm: (referral: Referral) => Promise<void>;
  onReviewWithoutDate: () => void;
  onSavingChange: (saving: boolean) => void;
  onReload: () => void;
}) {
  const [date, setDate] = useState(getPlannedAdmissionDate(referral));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const mutation = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (inFlight.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const confirmDate = async () => {
    if (inFlight.current || conflict || plannedAdmissionDateError(date)) return;
    inFlight.current = true;
    setSaving(true);
    onSavingChange(true);
    setError("");
    try {
      let saved = referral;
      if (date !== getPlannedAdmissionDate(referral)) {
        const key = JSON.stringify([referral.id, referral.version, date]);
        if (mutation.current?.key !== key) mutation.current = { key, id: crypto.randomUUID() };
        const result = await fetchPipelineJson<{ referral: Referral }>(`/api/referrals/${referral.id}`, {
          method: "PATCH",
          body: JSON.stringify({ if_match: referral.version, if_match_sections: { intake: normalizeReferralSectionVersions(referral.sectionVersions).intake },
            client_mutation_id: mutation.current.id, patch: { plannedAdmissionDate: date } }),
        });
        saved = result.referral;
      }
      await onConfirm(saved);
    } catch (failure) {
      setConflict(failure instanceof PipelineApiError && failure.status === 409);
      setError(failure instanceof Error ? failure.message : "The admit date could not be saved. Try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  };
  return <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void confirmDate(); }}>
    <div className={styles.composeScroll}>
      {demo ? <p role="status" className={styles.demoNotice}>Demo only — no email will be sent.</p> : null}
      <div className={styles.reviewContent}>
        <p className={styles.reviewInstruction}>When is {referral.name} expected to arrive?</p>
        <label className={styles.admissionDateField}>Planned admit date
          <input type="date" required value={date} readOnly={!editable} disabled={saving || conflict}
            onChange={(event) => { setDate(event.target.value); setError(""); }} aria-describedby="handoff-admit-date-help" />
        </label>
        <p id="handoff-admit-date-help" className={styles.sourceNote}>Required before sending. You can review the email and packet now; the date will be added to the email when saved.</p>
        {error ? <p role="alert" className={styles.notice}>{error}</p> : null}
        {conflict ? <button type="button" className={styles.textButton} onClick={onReload}>Reload saved date</button> : null}
      </div>
    </div>
    <footer className={styles.toolbar}>
      <span>{saving ? "Saving admit date…" : "Then check the client summary"}</span>
      {!date && !getPlannedAdmissionDate(referral) ? <button type="button" className={styles.textButton} disabled={saving || conflict} onClick={onReviewWithoutDate}>Review without admit date</button> : null}
      <button type="submit" className={styles.sendButton} disabled={saving || conflict || Boolean(plannedAdmissionDateError(date))}>
        {saving ? "Saving…" : "Confirm admit date"}<ArrowRight size={18} aria-hidden="true" />
      </button>
    </footer>
  </form>;
}
