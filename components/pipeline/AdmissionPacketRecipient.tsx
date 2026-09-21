"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Download, LockKeyhole, Mail } from "lucide-react";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import styles from "./AdmissionPacketRecipient.module.css";

type Packet = { expires_at: string; session_expires_at: number; message: { subject: string; body: string }; files: { id: string; name: string; byteSize: number }[] };
export default function AdmissionPacketRecipient({ packetId, downloadError = false }: { packetId: string; downloadError?: boolean }) {
  const [packet, setPacket] = useState<Packet | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(downloadError ? "That download could not finish. Verify your email if asked, then try the file again. If it was replaced or withdrawn, contact the sender." : "");
  const [unavailable, setUnavailable] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const endpoint = toPipelinePath(`/api/admission-packets/${packetId}`);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { cache: "no-store", signal });
    const body = await response.json();
    if (response.ok) { setPacket(body); setUnavailable(false); setError(""); return; }
    setPacket(null);
    setUnavailable(response.status === 410);
    if (response.status !== 401) throw new Error(body.error || "Could not open the packet. Please try again.");
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [load]);
  useEffect(() => { if (codeRequested) codeInput.current?.focus(); }, [codeRequested]);
  useEffect(() => { if (packet) heading.current?.focus(); }, [packet]);
  useEffect(() => {
    if (!packet) return;
    const timer = setTimeout(() => { setPacket(null); setCodeRequested(false); setNotice("Your session expired. Verify your email again to continue."); }, Math.max(0, packet.session_expires_at - Date.now()));
    return () => clearTimeout(timer);
  }, [packet]);
  // Drop private content when the tab returns after its session may have expired.
  useEffect(() => {
    const check = () => { if (document.visibilityState === "visible" && packet) { setPacket(null); void load().catch((reason) => setError(reason.message)); } };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [load, packet]);
  const submit = async (action: "request_code" | "verify" | "close", event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, email: email.trim(), code }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Please try again.");
      if (action === "request_code") { setCodeRequested(true); setCode(""); setNotice(body.message); }
      else if (action === "close") { setPacket(null); setEmail(""); setCode(""); setCodeRequested(false); setNotice("Packet closed. Verify your email to open it again."); }
      else { await load(); setCode(""); }
    } catch (reason) { setError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : "Check your internet connection, then try again."); }
    finally { setBusy(false); }
  };
  return <main className={styles.page}>
    <div className={styles.brand}>Pipeline</div>
    <section className={`${styles.card} ${packet ? styles.open : ""}`} aria-labelledby="packet-title" aria-busy={busy}>
      <div className={styles.symbol}><LockKeyhole size={26} aria-hidden="true" /></div>
      <h1 ref={heading} tabIndex={-1} id="packet-title">{packet ? "Your admission packet" : "Open your admission packet"}</h1>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
      {packet ? <>
        <p className={styles.muted}>Access through {new Date(packet.expires_at).toLocaleDateString()}. Download files you need for care coordination.</p>
        <h2>{packet.message.subject}</h2><p className={styles.message}>{packet.message.body}</p>
        <h2>Files <span className={styles.muted}>({packet.files.length})</span></h2>
        <ul className={styles.files}>{packet.files.map((file) => <li key={file.id}><a href={`${endpoint}/files/${encodeURIComponent(file.id)}`} target="_blank" rel="noopener noreferrer">
          <span><strong>{file.name}</strong><small>{file.byteSize < 1024 * 1024 ? `${Math.max(1, Math.ceil(file.byteSize / 1024))} KB` : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(file.byteSize / 1024 / 1024)} MB`}</small></span><Download size={20} aria-label="Download" />
        </a></li>)}</ul>
        <div className={styles.secondary}><button type="button" disabled={busy} onClick={() => void submit("close")}>Close secure packet</button></div>
      </> : unavailable ? <><p>Contact the person who sent this link to renew access. You can use this same link once they renew it.</p><div className={styles.secondary}><button type="button" disabled={busy} onClick={() => { setBusy(true); void load().catch((reason) => setError(reason.message)).finally(() => setBusy(false)); }}>Check access again</button></div></> : <>
        <p className={styles.muted}>{codeRequested ? "Enter the 8-digit code sent to your email." : "Use the email address that received this packet. We’ll send a one-time code. No account needed."}</p>
        <form onSubmit={(event) => void submit(codeRequested ? "verify" : "request_code", event)}>
          <label htmlFor="packet-email">Your email</label>
          <input id="packet-email" type="email" autoComplete="email" required maxLength={254} value={email} readOnly={codeRequested} onChange={(event) => setEmail(event.target.value)} />
          {codeRequested ? <><label htmlFor="packet-code">Email code</label><input ref={codeInput} id="packet-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" required minLength={8} maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /><small>Codes expire after 10 minutes. Use the most recent code.</small></> : null}
          <button type="submit" disabled={busy}><Mail size={18} aria-hidden="true" />{busy ? "Please wait…" : codeRequested ? "Verify & open packet" : "Email me a code"}</button>
        </form>
        {codeRequested ? <div className={styles.secondary}><button type="button" disabled={busy} onClick={() => void submit("request_code")}>Send a new code</button><button type="button" disabled={busy} onClick={() => { setCodeRequested(false); setCode(""); setNotice(""); setError(""); }}>Use a different email</button></div> : null}
      </>}
    </section>
    <p className={styles.footer}>Private care coordination · Share only with authorized recipients.</p>
  </main>;
}
