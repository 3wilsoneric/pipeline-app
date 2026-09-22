"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Mail } from "lucide-react";
import { usePathname } from "next/navigation";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { acquireOutlookToken } from "@/lib/auth/outlook-client";
import HomeDialog from "./HomeDialog";
import styles from "./OutlookHandoffControls.module.css";

type Setup = { outlook_client_id: string; account_id: string; account_email: string; demo: boolean; can_connect: boolean };
const endpoint = "/api/me/outlook";
const changedEvent = "pipeline:outlook-connection";
const dismissalKey = (setup: Setup) => `pipeline.outlook.prompt:${setup.outlook_client_id}:${setup.account_id}`;
function deferred(setup: Setup) {
  try { return window.sessionStorage.getItem(dismissalKey(setup)) === "later"; } catch { return false; }
}
function connectionEnabled(setup: Setup) { return !setup.demo && setup.can_connect && Boolean(setup.outlook_client_id); }
async function verifyConnection(token: string) {
  return fetchPipelineJson<{ mailbox: string }>(endpoint, { method: "POST", headers: { "x-pipeline-outlook-token": token } });
}
async function restoreConnection(setup: Setup) {
  const token = await acquireOutlookToken(setup.outlook_client_id, false, setup.account_email);
  return token ? verifyConnection(token).catch(() => null) : null;
}
function shouldPrompt(mode: string, setup: Setup, restored: unknown) {
  return mode === "prompt" && !restored && !deferred(setup) && !document.querySelector("dialog[open]");
}

export default function OutlookConnectionSetup({ mode }: { mode: "prompt" | "settings" }) {
  const pathname = usePathname();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [mailbox, setMailbox] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const pending = useRef(false);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchPipelineJson<Setup>(endpoint, { cache: "no-store", signal });
      if (signal.aborted) return;
      setSetup(next);
      if (!connectionEnabled(next)) return;
      const restored = await restoreConnection(next);
      if (signal.aborted) return;
      setMailbox(restored?.mailbox ?? "");
      setPromptOpen(shouldPrompt(mode, next, restored));
    } catch (failure) {
      if (!signal.aborted) setError(failure instanceof Error ? failure.message : "Outlook connection could not be checked.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [mode]);
  useEffect(() => {
    let controller = new AbortController();
    void load(controller.signal);
    const refresh = () => { controller.abort(); controller = new AbortController(); void load(controller.signal); };
    window.addEventListener(changedEvent, refresh);
    return () => { controller.abort(); window.removeEventListener(changedEvent, refresh); };
  }, [load]);

  const dismiss = () => {
    if (pending.current) return;
    if (setup) { try { window.sessionStorage.setItem(dismissalKey(setup), "later"); } catch { /* Dismissal still lasts for this visit. */ } }
    setPromptOpen(false);
    setJustConnected(false);
  };
  const connect = async () => {
    if (!setup || setup.demo || !setup.can_connect || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const token = await acquireOutlookToken(setup.outlook_client_id, true, setup.account_email);
      if (!token) throw new Error("Outlook did not complete the connection. Try again.");
      const result = await verifyConnection(token);
      setMailbox(result.mailbox);
      setJustConnected(true);
      // The active prompt keeps its confirmation; other mounted connection views refresh.
      if (mode === "settings") window.dispatchEvent(new Event(changedEvent));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Outlook could not connect. Try again.");
    } finally { pending.current = false; setBusy(false); }
  };
  if (setup && !setup.can_connect) return null;
  const content = <OutlookConnectionCard setup={setup} mailbox={mailbox} mode={mode} busy={busy} loading={loading} error={error} justConnected={justConnected}
    onConnect={() => void connect()} onDismiss={dismiss} />;
  if (mode === "settings") return content;
  if (!promptOpen || loading || setup?.demo || pathname.endsWith("/settings")) return null;
  return <HomeDialog label="Connect your Outlook" title={justConnected ? "Ready for your first handoff" : "Connect your Outlook"} size="confirmation" onClose={dismiss}>{content}</HomeDialog>;
}

type ConnectionView = {
  setup: Setup | null; mailbox: string; mode: "prompt" | "settings"; busy: boolean; loading: boolean; error: string; justConnected: boolean;
  onConnect: () => void; onDismiss: () => void;
};

function OutlookConnectionCard(props: ConnectionView) {
  const { setup, mailbox, busy, loading, error } = props;
  return <section className={`${styles.panel} ${props.mode === "settings" ? styles.connectionSettings : styles.connectionPrompt}`} aria-label="Outlook connection" aria-busy={busy || loading}>
    <OutlookConnectionHeading {...props} />
    <p className={styles.hint}>{connectionDescription(setup, mailbox)}</p>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {error && !setup ? <button type="button" className={styles.secondary} disabled={loading} onClick={() => window.dispatchEvent(new Event(changedEvent))}>Retry connection check</button> : null}
    {!loading && setup && !setup.demo && !setup.outlook_client_id ? <p role="status" className={styles.hint}>Outlook setup is pending.</p> : null}
    <OutlookConnectionActions {...props} />
    <OutlookConnectionDetails {...props} />
  </section>;
}

function OutlookConnectionHeading({ mailbox, setup }: ConnectionView) {
  return <div className={styles.heading}><span className={styles.icon}><Mail size={22} aria-hidden="true" /></span>
    <div><h3>{mailbox ? "Outlook is connected" : "Your Outlook email"}</h3><p>{mailbox || setup?.account_email}</p></div>
    <span className={styles.badge}>{setup?.demo ? "Not production yet" : mailbox ? <><Check size={13} aria-hidden="true" /> Connected</> : "Not connected"}</span>
  </div>;
}

function connectionDescription(setup: Setup | null, mailbox: string) {
  if (setup?.demo) return "Demo only — Outlook connection is not enabled. No draft will be created and no email will be sent.";
  if (mailbox) return "Your handoffs will open in your Outlook Drafts. You review and send them.";
  return "Save your reviewed handoffs in Outlook Drafts. You send them from your own email.";
}

function ConnectOutlookButton({ setup, busy, loading, onConnect }: ConnectionView) {
  return <button type="button" className={styles.primary} disabled={busy || loading || !setup?.outlook_client_id || setup.demo} onClick={onConnect}>
    {busy || loading ? <LoaderCircle size={16} className={styles.spin} aria-hidden="true" /> : <Mail size={16} aria-hidden="true" />} {busy ? "Connecting…" : loading ? "Checking connection…" : "Connect Outlook"}
  </button>;
}

function OutlookConnectionActions(props: ConnectionView) {
  const { mode, justConnected, mailbox, busy, onDismiss } = props;
  if (mode === "settings" && mailbox) return null;
  return <div className={styles.actions}>
    {mode === "prompt" && justConnected ? <button type="button" className={styles.primary} onClick={onDismiss}>Continue to Pipeline</button>
      : <ConnectOutlookButton {...props} />}
    {mode === "prompt" && !justConnected ? <button type="button" className={styles.quiet} disabled={busy} onClick={onDismiss}>Connect later</button> : null}
  </div>;
}

function OutlookConnectionDetails({ setup, mode, justConnected }: ConnectionView) {
  return <>
    {!setup?.demo ? <details className={styles.setup}><summary>Staying connected</summary><p>Your connection is remembered when you leave and return in this browser. Use the mailbox matching your Pipeline email and choose “Stay signed in” if Microsoft offers it. Signing out, clearing browser data or Microsoft security requirements may require you to reconnect.</p></details> : null}
    {mode === "prompt" && !justConnected ? <p className={styles.hint}>Connect later lets you keep working. Connect in Settings or before saving your first Outlook draft.</p> : null}
  </>;
}
