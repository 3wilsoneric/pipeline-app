"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CommunicationView } from "@/lib/notifications/communication-contract";
import CommunicationRecord from "./CommunicationRecord";
import styles from "./CommunicationHistory.module.css";

export default function DirectHandoffPreview({ prepare, onBack, onDone, editor, ready, sending, readinessReasons, refresh }: {
  prepare: (snapshotId?: string) => Promise<CommunicationView>;
  onBack: () => void; onDone: () => void; editor: ReactNode; ready: boolean; sending: boolean;
  readinessReasons: string[]; refresh: ReactNode;
}) {
  const [record, setRecord] = useState<CommunicationView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const request = useRef<Promise<CommunicationView> | null>(null);
  const prepareRef = useRef(prepare);
  useEffect(() => { prepareRef.current = prepare; }, [prepare]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const promise = request.current ??= prepareRef.current();
    promise.then(value => { if (active && request.current === promise) setRecord(value); }, failure => { if (active && request.current === promise) setError(failure instanceof Error ? failure.message : "The exact preview could not be prepared."); });
    return () => { active = false; };
  }, [ready]);
  const run = async (send = false) => {
    if (busy || sending) return;
    setBusy(true); setError("");
    try {
      const promise = prepare(send ? record?.id : undefined);
      request.current = promise;
      const next = await promise;
      setRecord(next); setEditing(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The handoff could not be confirmed.");
      if (send) setRecord(null);
    } finally { setBusy(false); }
  };
  return <div>
    {editing ? editor : record ? <CommunicationRecord record={record} history={record.status !== "ready"} /> : !ready ? <div role="status"><h3>Finish preparing the packet</h3><ul>{readinessReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div> : !error ? <p className={styles.muted} role="status">Preparing the exact email and preserving every attachment…</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {error || !ready || record?.status === "not_sent" ? refresh : null}
    {record?.status === "ready" && !editing ? <p className={styles.muted}>This email and these files will be sent from Alamo Admissions. The assessor receives a copy and replies.</p> : null}
    <footer className={styles.toolbar}>
      <button type="button" className={styles.secondary} disabled={busy || sending} onClick={onBack}>Back to recipients</button>
      {record && ["submitted", "sending", "unconfirmed"].includes(record.status) ? <button type="button" className={styles.primary} onClick={onDone}>Done · view history</button>
        : editing ? <button type="button" className={styles.primary} disabled={busy || sending || !ready} onClick={() => void run()}>Save & preview email</button>
        : record?.status === "ready" ? <>
          <button type="button" className={styles.secondary} disabled={busy || sending} onClick={() => setEditing(true)}>Edit message</button>
          <button type="button" className={styles.primary} disabled={busy || sending || !ready} onClick={() => void run(true)}>{busy || sending ? "Sending…" : "Send email & packet"}</button>
        </> : error || record?.status === "not_sent" ? <button type="button" className={styles.primary} disabled={busy || sending || !ready} onClick={() => void run()}>Prepare preview again</button> : null}
    </footer>
  </div>;
}
