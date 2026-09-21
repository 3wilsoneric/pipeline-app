"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import styles from "./MeetClientEmailPage.module.css";

type Link = { id: string; created_at: string; expires_at: string; revoked: boolean; file_count: number; recipient_count: number };
export default function AdmissionPacketAccessControls({ referralId }: { referralId: number }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const data = await fetchPipelineJson<{ packets: Link[] }>(`/api/referrals/${referralId}/admission-packets`);
    setLinks(data.packets);
  }, [referralId]);
  useEffect(() => { void load().catch(() => setError("Could not load packet access. Refresh to try again.")); }, [load]);
  const change = async (id: string, action: "renew" | "revoke") => {
    setBusy(true); setError(""); setNotice("");
    try {
      await fetchPipelineJson(`/api/referrals/${referralId}/admission-packets`, { method: "POST", body: JSON.stringify({ packet_id: id, action }) });
      await load();
      setNotice(action === "renew" ? "Access renewed for 30 days. Recipients can use the same link with a new email code." : "Access revoked. Recipients can no longer open or download this packet.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Try again."); }
    finally { setBusy(false); }
  };
  if (!links.length && !error) return null;
  return <section className={styles.attachments} aria-label="Sent packet access">
    <h3>Packet access</h3>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {links.map((link) => <div key={link.id} className={styles.attachmentHeading}>
      <p>{link.file_count} files · {link.recipient_count} recipients<br /><small>{link.revoked ? "Access revoked" : `Access through ${new Date(link.expires_at).toLocaleDateString()}`}</small></p>
      <div><button className={styles.textButton} type="button" disabled={busy} onClick={() => void change(link.id, "renew")}>Renew 30 days</button>{!link.revoked ? <button className={styles.textButton} type="button" disabled={busy} onClick={() => void change(link.id, "revoke")}>Revoke access</button> : null}</div>
    </div>)}
  </section>;
}
