"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { communicationStatusLabels, type CommunicationView } from "@/lib/notifications/communication-contract";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import CommunicationRecord, { CommunicationDialog } from "./CommunicationRecord";
import styles from "./CommunicationHistory.module.css";

export default function CommunicationHistory({ referralId, refreshKey = "", onPrepareUpdated }: { referralId?: number; refreshKey?: string; onPrepareUpdated?: () => void }) {
  const [items, setItems] = useState<CommunicationView[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("mine");
  const [canViewTeam, setCanViewTeam] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<CommunicationView | null>(null);
  const load = useCallback(async (next?: string, signal?: AbortSignal) => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ scope, q: query });
    if (referralId) params.set("referral_id", String(referralId));
    if (next) params.set("cursor", next);
    try {
      const result = await fetchPipelineJson<{ items: CommunicationView[]; next_cursor?: string; can_view_team: boolean }>(`/api/communications?${params}`, { cache: "no-store", signal });
      if (!signal?.aborted) { setItems(old => next ? [...old, ...result.items.filter(item => !old.some(prior => prior.id === item.id))] : result.items); setCursor(result.next_cursor); setCanViewTeam(result.can_view_team); }
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "History could not be loaded."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [query, referralId, scope]);
  useEffect(() => { const abort = new AbortController(); const timer = setTimeout(() => void load(undefined, abort.signal), 200); return () => { clearTimeout(timer); abort.abort(); }; }, [load, refreshKey]);
  const openRecord = async (item: CommunicationView) => {
    setError("");
    try { const result = await fetchPipelineJson<{ communication: CommunicationView }>(`/api/communications?referral_id=${item.referralId}&packet_id=${item.id}`, { cache: "no-store" }); setRecord(result.communication); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "This email could not be opened."); }
  };
  const content = <>
    <div className={styles.heading}>{referralId ? <h2>Email history</h2> : <div><h1>Communications</h1><p className={styles.muted}>Email history · Meet the Client and admission packets</p></div>}
      <button type="button" className={styles.secondary} disabled={loading} onClick={() => void load()}>Refresh history</button>
    </div>
    {!referralId ? <div className={styles.filters}><input type="search" aria-label="Find a client, community or subject" placeholder="Find a client, community or subject" value={query} onChange={event => setQuery(event.target.value)} />
      {canViewTeam ? <select aria-label="History scope" value={scope} onChange={event => setScope(event.target.value)}><option value="mine">My handoffs</option><option value="team">Team handoffs</option></select> : null}</div> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {loading ? <p className={styles.muted} role="status">Loading email history…</p> : null}
    {!loading && !error && !items.length ? <p className={styles.muted}>Saved email previews and send outcomes will appear here. Earlier handoff events remain in workspace Activity.</p> : null}
    <ul className={styles.list}>{items.map(item => <li key={item.id}><button type="button" className={styles.row} onClick={() => void openRecord(item)}>
      <span><strong>{referralId ? item.subject : item.clientName}</strong><span className={styles.muted}>{item.community} · {new Date(item.createdAt).toLocaleString()} · {item.to.length + item.cc.length} recipients · {item.files.length} {item.files.length === 1 ? "file" : "files"}</span></span>
      <span className={styles.status} data-issue={["not_sent", "unconfirmed"].includes(item.status)}>{communicationStatusLabels[item.status]}</span>
    </button></li>)}</ul>
    {cursor ? <button type="button" className={styles.secondary} disabled={loading} onClick={() => void load(cursor)}>Load earlier handoffs</button> : null}
    {record ? <CommunicationDialog title={`${record.clientName} · Email history`} onClose={() => setRecord(null)}>
      <CommunicationRecord record={record} history />
      {onPrepareUpdated && ["submitted", "not_sent", "ready"].includes(record.status) ? <button type="button" className={styles.primary} onClick={() => { setRecord(null); onPrepareUpdated(); }}>Review an updated handoff</button> : null}
      <Link className={styles.secondary} href={toPipelinePath(`/?view=referrals&screen=packet&referralId=${record.referralId}&workspaceView=email`)}>Open client workspace</Link>
    </CommunicationDialog> : null}
  </>;
  return referralId ? <section className={styles.history} aria-label="Email history">{content}</section> : <div className={styles.page}>{content}</div>;
}
