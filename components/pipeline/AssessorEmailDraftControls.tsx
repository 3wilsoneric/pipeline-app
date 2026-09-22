"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Mail, RefreshCw } from "lucide-react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { OutlookDraftView } from "@/lib/notifications/outlook-draft-contract";
import { useConfirmationDialog } from "./useConfirmationDialog";
import OutlookHandoffControls from "./OutlookHandoffControls";
import styles from "./OutlookHandoffControls.module.css";

type State = { draft: OutlookDraftView | null; occupied: boolean; demo?: boolean };
export default function AssessorEmailDraftControls({ referralId, demo, ready, sending, recipient, onPrepare, onSent, onExistingDraft }: {
  referralId: number; demo: boolean; ready: boolean; sending: boolean;
  recipient: { name: string; email: string } | null;
  onPrepare: (token?: string) => Promise<OutlookDraftView | undefined>;
  onSent: () => void; onExistingDraft: (draft: OutlookDraftView | null) => void;
}) {
  const [state, setState] = useState<State>({ draft: null, occupied: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const callbacks = useRef({ onSent, onExistingDraft });
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const endpoint = `/api/referrals/${referralId}/outlook-draft`;
  useEffect(() => { callbacks.current = { onSent, onExistingDraft }; }, [onSent, onExistingDraft]);
  const accept = useCallback((next: State) => {
    setState(next);
    callbacks.current.onExistingDraft(next.draft && !["sent", "discarded"].includes(next.draft.status) ? next.draft : null);
    if (next.draft?.status === "sent") callbacks.current.onSent();
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const next = await fetchPipelineJson<State>(endpoint, { cache: "no-store", signal });
    if (!signal?.aborted) accept(next);
  }, [endpoint, accept]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal).catch(() => { if (!controller.signal.aborted) setError("Draft status is unavailable. Refresh before emailing another draft."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);
  const run = async (operation: () => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError("");
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The draft could not be updated."); await load().catch(() => undefined); }
    finally { active.current = false; setBusy(false); }
  };
  const prepare = () => run(async () => { const draft = await onPrepare(); if (draft) accept({ draft, occupied: false }); });
  const act = async (action: "confirm_forward" | "discard_email") => {
    const result = await fetchPipelineJson<{ draft: OutlookDraftView }>(endpoint, {
      method: "POST", body: JSON.stringify({ action, packet_id: state.draft?.packet_id, confirmed: true }),
    });
    accept({ draft: result.draft.status === "discarded" ? null : result.draft, occupied: false });
  };
  const confirmSent = async () => {
    if (!await confirm({ title: "Confirm the handoff was sent?", message: "I forwarded this handoff from my email to the reviewed To and Cc recipients, including its packet link. This completes the handoff and locks this signed assessment. Pipeline cannot verify the send in my mailbox.", confirmLabel: "I sent the handoff", cancelLabel: "Not yet" })) return;
    await run(() => act("confirm_forward"));
  };
  const replace = async () => {
    if (!await confirm({ title: "Prepare a replacement draft?", message: "The old packet link will stop working. The email already in the assessor's inbox cannot be recalled. Review the latest message, recipients and files before emailing a replacement.", confirmLabel: "Replace draft", destructive: true })) return;
    await run(() => act("discard_email"));
  };
  const draft = state.draft;
  if (draft && draft.delivery !== "email") return <OutlookHandoffControls referralId={referralId} selected demo={demo} ready={ready} sending={sending}
    onPrepare={onPrepare} onSent={onSent} onExistingDraft={(present) => { onExistingDraft(present ? draft : null); if (!present) void load(); }} />;
  const disabled = [busy, sending, loading, demo, state.demo].some(Boolean);
  const working = busy || sending;
  const preparationDisabled = [disabled, !ready, !recipient, state.occupied, Boolean(error)].some(Boolean);
  const pending = Boolean(draft && draft.status !== "sent");
  const canReplace = pending && draft?.can_replace;
  const renderHeading = () => (<div className={styles.heading}><span className={styles.icon}><Mail size={22} aria-hidden="true" /></span><div>
      <h3>{pending ? "Finish in your email" : "Send the draft to the assessor"}</h3>
      <p>{draft?.mailbox || recipient?.email || "The signing assessor's work email will appear here."}</p>
    </div><span className={styles.badge}>{demo ? "Not production yet" : pending ? "Awaiting onward send" : "Ready for review"}</span></div>);
  const renderHint = () => (<p className={styles.hint} role="status">{demo ? "Not production yet — no email will be sent." : pending
      ? draft?.message || "Check the assessor's inbox, forward the prepared handoff, then confirm below."
      : "The assessor receives the message and complete packet link, then forwards them from Outlook to the reviewed recipients."}</p>);
  const renderActions = () => (<div className={styles.actions}>
      {!draft ? <button type="button" className={styles.primary} disabled={preparationDisabled} onClick={() => void prepare()}>
        {working ? <LoaderCircle size={16} className={styles.spin} /> : <Mail size={16} />}Email draft to assessor
      </button> : <>
        {draft.can_confirm && ["draft", "unconfirmed"].includes(draft.status) ? <button type="button" className={styles.primary} disabled={disabled} onClick={() => void confirmSent()}><Check size={16} />I sent the handoff</button> : null}
        {!draft.can_confirm ? <span className={styles.hint}>The assessor confirms the onward send here.</span> : null}
        {canReplace ? <button type="button" className={styles.quiet} disabled={disabled} onClick={() => void replace()}>Prepare replacement</button> : null}
      </>}
      {error || pending ? <button type="button" className={styles.quiet} disabled={busy || loading} onClick={() => void run(load)}><RefreshCw size={15} />Refresh status</button> : null}
    </div>);
  return <section className={styles.panel} aria-label="Email draft to assessor">
    {renderHeading()}
    {renderHint()}
    {!recipient && !draft ? <p className={styles.hint}>A confirmed work email for the signing assessor is needed before emailing the draft.</p> : null}
    {state.occupied ? <p className={styles.hint}>A handoff is already in progress. Refresh its status before continuing.</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {renderActions()}
    {confirmationDialog}
  </section>;
}
