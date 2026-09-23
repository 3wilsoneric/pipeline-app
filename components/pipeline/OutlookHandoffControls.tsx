"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ExternalLink, LoaderCircle, Mail, RefreshCw } from "lucide-react";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { acquireOutlookToken, checkWithOutlookToken } from "@/lib/auth/outlook-client";
import { safeOutlookWebLink, type OutlookDraftView } from "@/lib/notifications/outlook-draft-contract";
import { useConfirmationDialog } from "./useConfirmationDialog";
import OutlookConnectionNotice from "./OutlookConnectionNotice";
import styles from "./OutlookHandoffControls.module.css";

type State = { draft: OutlookDraftView | null; occupied: boolean; demo?: boolean; outlook_client_id?: string; account_email?: string; email_configured?: boolean; email_sender?: string };
export default function OutlookHandoffControls({ referralId, selected, demo, ready, readinessReasons, sending, onPrepare, onEmail, onSent, onExistingDraft }: {
  referralId: number; selected: boolean; demo: boolean; ready: boolean; readinessReasons: string[]; sending: boolean;
  onEmail: () => Promise<OutlookDraftView | undefined>;
  onPrepare: (token: string) => Promise<OutlookDraftView | undefined>;
  onSent: () => void; onExistingDraft: (draft: OutlookDraftView | null) => void;
}) {
  const readinessId = useId();
  const [state, setState] = useState<State>({ draft: null, occupied: false });
  const [delivery, setDelivery] = useState<"email" | "outlook">("email");
  const [mailbox, setMailbox] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectionCheckFailed, setConnectionCheckFailed] = useState(false);
  const [error, setError] = useState("");
  const [popupBlocked, setPopupBlocked] = useState(false);
  const active = useRef(false);
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const endpoint = `/api/referrals/${referralId}/outlook-draft`;
  const callbacks = useRef({ onSent, onExistingDraft });
  useEffect(() => { callbacks.current = { onSent, onExistingDraft }; }, [onSent, onExistingDraft]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const next = await fetchPipelineJson<State>(endpoint, { cache: "no-store", signal });
    if (signal?.aborted) return;
    setState(next);
    if (next.draft) setDelivery(next.draft.delivery_method === "assessor_email" ? "email" : "outlook");
    callbacks.current.onExistingDraft(next.draft && !["sent", "discarded"].includes(next.draft.status) ? next.draft : null);
    if (next.draft?.status === "sent") callbacks.current.onSent();
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    void load(controller.signal).catch(() => { if (!cancelled) setError("Outlook draft status could not be loaded. Retry before preparing a new draft."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [load]);
  useEffect(() => {
    if (!selected || demo || state.demo || delivery !== "outlook") return;
    let cancelled = false;
    setCheckingConnection(true);
    const reconnect = async () => {
      const result = await checkWithOutlookToken(state.outlook_client_id, state.account_email, token => fetchPipelineJson<{ mailbox: string }>(endpoint, { method: "POST", headers: { "x-pipeline-outlook-token": token }, body: JSON.stringify({ action: "connect" }) }));
      if (!cancelled) { setMailbox(result?.mailbox ?? ""); setConnectionCheckFailed(false); }
    };
    void reconnect().catch((failure) => { if (!cancelled) {
      setConnectionCheckFailed(!(failure instanceof PipelineApiError && [403, 428].includes(failure.status)));
      setError(failure instanceof Error ? failure.message : "Outlook connection could not be checked. Try again.");
    } })
      .finally(() => { if (!cancelled) setCheckingConnection(false); });
    return () => { cancelled = true; };
  }, [selected, demo, state.demo, delivery, state.outlook_client_id, state.account_email, endpoint]);
  const action = async (name: "connect" | "check" | "discard", token: string) => {
    const result = await fetchPipelineJson<{ mailbox?: string; draft?: OutlookDraftView }>(endpoint, {
      method: "POST", headers: { "x-pipeline-outlook-token": token },
      body: JSON.stringify({ action: name, packet_id: state.draft?.packet_id, confirmed: name === "discard" }),
    }, { timeoutMs: 300_000 });
    if (result.mailbox) setMailbox(result.mailbox);
    if (result.draft) acceptDraft(result.draft);
    return result;
  };
  const acceptDraft = (draft: OutlookDraftView) => {
    setState((current) => ({ ...current, draft: draft.status === "discarded" ? null : draft, occupied: false }));
    callbacks.current.onExistingDraft(!["sent", "discarded"].includes(draft.status) ? draft : null);
    if (draft.status === "sent") callbacks.current.onSent();
  };
  const run = async (operation: () => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError("");
    try { await operation(); }
    catch (reason) { if (reason instanceof PipelineApiError && [401, 403, 428].includes(reason.status)) setMailbox(""); setError(reason instanceof Error ? reason.message : "Outlook could not complete that step. Your work is saved."); }
    finally { active.current = false; setBusy(false); }
  };
  const requireToken = async (interactive = false) => {
    const token = await acquireOutlookToken(state.outlook_client_id, interactive, state.account_email);
    if (!token) { setMailbox(""); throw new Error("Reconnect Outlook to continue. Your existing draft will be kept."); }
    return token;
  };
  const connect = (interactive = true) => run(async () => {
    const result = await checkWithOutlookToken(state.outlook_client_id, state.account_email, token => action("connect", token), interactive);
    setConnectionCheckFailed(false);
    if (!result) setMailbox("");
  });
  const check = () => run(async () => { await action("check", await requireToken()); });
  const prepare = () => {
    if (active.current || sending) return;
    // Open immediately in the click event so Safari/iPad do not lose the user
    // gesture while the packet is prepared. The fallback link remains visible.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    void run(async () => {
      try {
        const draft = await onPrepare(await requireToken());
        if (!draft) { tab?.close(); return; }
        acceptDraft(draft);
        const link = safeOutlookWebLink(draft.web_link);
        if (link && tab) tab.location.replace(link);
        else { tab?.close(); setPopupBlocked(true); }
      } catch (reason) { tab?.close(); await load().catch(() => undefined); throw reason; }
    });
  };
  const emailPacket = () => run(async () => {
    try { const draft = await onEmail(); if (draft) acceptDraft(draft); }
    catch (reason) { await load().catch(() => undefined); throw reason; }
  });
  const inboxAction = async (name: "received" | "forwarded" | "replace") => {
    const copy = name === "forwarded"
      ? { title: "Did you forward the complete handoff?", message: "Confirm you sent the message and every attachment to the reviewed To / Cc list. This records your confirmation; it does not send an email or check your mailbox.", confirmLabel: "Yes, I sent it" }
      : name === "replace"
        ? { title: "Review a new handoff?", message: "Check your inbox, junk folder and Sent folder first. The earlier email cannot be recalled. Close this copy only when you are ready to review and prepare a replacement.", confirmLabel: "Close copy and review again", destructive: true }
        : { title: "Has the complete packet arrived?", message: "Confirm the Alamo Admissions email is in your inbox with the message and all packet files attached.", confirmLabel: "Yes, I received it" };
    if (!await confirm(copy)) return;
    await run(async () => {
      const result = await fetchPipelineJson<{ draft: OutlookDraftView }>(endpoint, {
        method: "POST", body: JSON.stringify({ action: name, packet_id: state.draft?.packet_id, confirmed: true }),
      });
      acceptDraft(result.draft);
    });
  };
  const discard = async () => {
    const changed = state.draft?.status === "needs_review";
    if (!await confirm({ title: changed ? "Prepare an updated handoff?" : "Remove this Outlook draft?", message: changed
      ? "Outlook already sent this email. Its attachments cannot be recalled. The original send will stay in the activity record. Review the latest assessment, recipients and files before creating another handoff."
      : "The unsent draft will be removed from Outlook, then you can prepare a replacement. An email already sent cannot be recalled.", confirmLabel: changed ? "Review updated handoff" : "Remove draft", destructive: true })) return;
    await run(async () => { await action("discard", await requireToken()); });
  };
  if (!selected) return null;
  const draft = state.draft;
  const disabled = busy || sending || loading || checkingConnection;
  const isDemo = demo || state.demo;
  const link = safeOutlookWebLink(draft?.web_link);
  const connected = Boolean(mailbox);
  const renderHeading = () => (<div className={styles.heading}><span className={styles.icon}><Mail size={22} aria-hidden="true" /></span><div><h3>{isDemo ? "Outlook preview" : draft ? "Your Outlook draft" : "Save to Outlook Drafts"}</h3><p>{connected ? mailbox : state.account_email || "Connect your own Outlook mailbox."}</p></div><span className={styles.badge}>{isDemo ? "Not production yet" : connected ? <><Check size={13} /> Connected</> : "Not connected"}</span></div>);
  const preparationDisabled = disabled || !ready || isDemo || state.occupied;
  const renderConnectAction = () => <button type="button" className={styles.primary} disabled={disabled || isDemo || !state.outlook_client_id || state.occupied} onClick={() => void connect(!connectionCheckFailed)}>{busy || checkingConnection ? <LoaderCircle size={16} className={styles.spin} /> : <Mail size={16} />}{checkingConnection ? "Checking connection…" : connectionCheckFailed ? "Retry connection check" : "Connect Outlook"}</button>;
  const renderDraftStatusAction = () => <button type="button" className={styles.primary} disabled={disabled || isDemo} onClick={() => void check()}><RefreshCw size={16} className={busy ? styles.spin : undefined} />{draft?.status === "preparing" || draft?.status === "unconfirmed" ? "Resume draft preparation" : "Check sent status"}</button>;
  const renderPrimaryAction = () => (isDemo ? <button type="button" className={styles.primary} disabled><ExternalLink size={16} />Save to Outlook Drafts</button> : !connected ? renderConnectAction()
        : !draft ? <button type="button" className={styles.primary} disabled={preparationDisabled} aria-describedby={!ready ? readinessId : undefined} onClick={prepare}>{busy || sending ? <LoaderCircle size={16} className={styles.spin} /> : <ExternalLink size={16} />}Save to Outlook Drafts</button>
          : renderDraftStatusAction());
  const renderActions = () => (<div className={styles.actions}>
      {renderPrimaryAction()}
      {link ? <a className={styles.secondary} href={link} target="_blank" rel="noopener noreferrer">Reopen draft<ExternalLink size={14} /></a> : null}
      {draft && draft.status !== "sent" ? <button type="button" className={styles.quiet} disabled={disabled || isDemo} onClick={() => void discard()}>{draft.status === "needs_review" ? "Prepare updated handoff" : "Remove draft"}</button> : null}
      {error && !draft && !connectionCheckFailed ? <button type="button" className={styles.quiet} disabled={disabled} onClick={() => void run(load)}>Retry status</button> : null}
    </div>);
  const reviewHint = !draft && !ready;
  const renderSetupStatus = () => !loading && !state.outlook_client_id ? <p role="status" className={styles.hint}>Outlook connection setup is pending. Your handoff is saved in Pipeline.</p> : null;
  const renderMessages = () => {
    if (isDemo) return <p className={styles.hint}>Not production yet — no draft will be created and no email will be sent.</p>;
    return <>
    {renderSetupStatus()}
    {!connected ? <OutlookConnectionNotice /> : null}
    {state.occupied ? <p role="status" className={styles.hint}>A teammate already has an Outlook draft for this workspace. Complete or remove that draft first.</p> : null}
    {draft ? <p className={styles.hint} role="status">{draft.message || "Saved in Outlook Drafts. Review and send it in Outlook, then choose Check sent status here."}</p>
      : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {popupBlocked && link ? <p role="status" className={styles.hint}>Your draft is saved. Use “Reopen draft” to open Outlook.</p> : null}

    {reviewHint ? <div id={readinessId} role="status" className={styles.hint}><strong>Before saving to Outlook Drafts:</strong><ul>{readinessReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div> : null}</>;
  };
  if (delivery === "email") return <section className={styles.panel} aria-label="Email packet to assessor">
    <div className={styles.heading}><span className={styles.icon}><Mail size={22} aria-hidden="true" /></span>
      <div><h3>{draft ? "Next: forward from your inbox" : "Email the packet to yourself"}</h3>
        <p>{draft?.mailbox || state.account_email || "Loading your email address…"}</p></div>
      {draft ? <span className={styles.badge}>{draft.status === "draft" ? "Ready to forward" : "Check inbox"}</span> : null}
    </div>
    {draft ? <p className={styles.hint} role="status">{draft.message || "Open the Alamo Admissions email, choose Forward, and add the reviewed To / Cc recipients. Keep every attachment."}</p>
      : <p className={styles.hint}>From Alamo Admissions{state.email_sender ? ` (${state.email_sender})` : ""}. Your message, PDF data sheet and original files arrive in your inbox. You forward them to the recipients above. No Outlook connection needed.</p>}
    {state.occupied ? <p role="status" className={styles.hint}>A teammate already has a prepared handoff for this workspace. Complete or close it first.</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {!draft && !ready ? <div role="status" className={styles.hint}><strong>Before emailing the packet:</strong><ul>{readinessReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div> : null}
    {!loading && !draft && !state.email_configured ? <p role="status" className={styles.hint}>Email from Alamo Admissions is unavailable for this account. You can use Outlook Drafts below.</p> : null}
    <div className={styles.actions}>
      {!draft ? <button type="button" className={styles.primary} disabled={busy || sending || loading || !ready || isDemo || state.occupied || !state.email_configured} onClick={() => void emailPacket()}>
        {busy || sending ? <LoaderCircle size={16} className={styles.spin} /> : <Mail size={16} />}{busy || sending ? "Emailing packet…" : "Email packet to me"}</button>
        : draft.status === "draft" ? <button type="button" className={styles.primary} disabled={busy || sending} onClick={() => void inboxAction("forwarded")}><Check size={16} />I forwarded the handoff</button>
          : draft.status !== "needs_review" ? <button type="button" className={styles.primary} disabled={busy || sending} onClick={() => void inboxAction("received")}>I received the complete packet</button> : null}
      {draft ? <button type="button" className={draft.status === "needs_review" ? styles.primary : styles.quiet} disabled={busy || sending} onClick={() => void inboxAction("replace")}>Review a new handoff</button>
        : <button type="button" className={styles.quiet} disabled={busy || sending || loading || state.occupied} onClick={() => { setError(""); setDelivery("outlook"); }}>Use Outlook Drafts instead</button>}
      {error ? <button type="button" className={styles.quiet} disabled={busy || sending} onClick={() => void run(load)}>Refresh status</button> : null}
    </div>
    {confirmationDialog}
  </section>;
  return <section className={styles.panel} aria-label="Outlook handoff">
    {!draft ? <button type="button" className={styles.switchMethod} disabled={disabled} onClick={() => { setError(""); setDelivery("email"); }}>Email packet to me instead — no Outlook connection</button> : null}
    {renderHeading()}
    {renderMessages()}
    {renderActions()}
    <details className={styles.setup}><summary>About the Outlook connection</summary><p>Connect the mailbox matching your Pipeline email. Microsoft may ask you or your organization to approve reading and writing mail so Pipeline can save and check the draft. Pipeline does not request permission to send from your mailbox.</p><p>You can leave and return: the draft stays in Outlook. After you send it, check its status here to complete the handoff.</p></details>
    {confirmationDialog}
  </section>;
}
