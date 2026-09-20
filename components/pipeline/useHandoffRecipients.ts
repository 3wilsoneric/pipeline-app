"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { usePersonaSwitchSave } from "@/lib/demo/persona-switch-save";
import type { CommunityRecipientList, RecipientFields } from "@/lib/pipeline/community-recipient-lists";

const empty = (): RecipientFields => ({ to: [], cc: [] });
type Session = { key: string; version: number; fields: RecipientFields; saved: string; queue: Promise<void>; error: string };

export function useHandoffRecipients(referralId: number | undefined, community: string) {
  const [fields, setFields] = useState<RecipientFields>(empty);
  const [lists, setLists] = useState<CommunityRecipientList[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const loadKey = JSON.stringify([referralId, community, reloadKey]);
  const loading = loadedKey !== loadKey;
  const session = useRef<Session | null>(null);
  const endpoint = referralId ? `/api/referrals/${referralId}/handoff-recipients` : "";
  useEffect(() => {
    const controller = new AbortController();
    const current: Session = { key: `${referralId}:${community}`, version: 0, fields: empty(), saved: "", queue: Promise.resolve(), error: "" };
    session.current = current;
    const load = async () => {
      let templates: CommunityRecipientList[] = [];
      let note = "";
      try { templates = (await fetchPipelineJson<{ lists: CommunityRecipientList[] }>("/api/community-recipient-lists", { signal: controller.signal })).lists; }
      catch { note = "Community list unavailable. Add authorized recipients below."; }
      const stored = endpoint ? await fetchPipelineJson<{ draft: (RecipientFields & { community: string }) | null; version: number }>(endpoint, { signal: controller.signal }) : { draft: null, version: 0 };
      if (session.current !== current || controller.signal.aborted) return;
      const template = templates.find((list) => list.community === community);
      const values = stored.draft?.community === community ? stored.draft : template ?? empty();
      current.version = stored.version;
      current.fields = { to: values.to, cc: values.cc };
      current.saved = JSON.stringify(current.fields);
      setFields(current.fields); setLists(templates); setError("");
      setMessage(recipientLoadMessage(stored.draft?.community === community, note, Boolean(template), community));
    };
    void load().catch(() => { if (!controller.signal.aborted) setError("Recipient drafts could not be loaded. Retry before editing."); })
      .finally(() => { if (!controller.signal.aborted) setLoadedKey(loadKey); });
    return () => { controller.abort(); if (session.current === current) session.current = null; };
  }, [community, endpoint, referralId, loadKey]);

  const change = (next: RecipientFields) => {
    const current = session.current;
    if (!current || !endpoint || loading || current.error) return;
    current.fields = next; setFields(next); setMessage("Saving recipients...");
    current.queue = current.queue.then(async () => {
      if (session.current !== current) throw new Error("The workspace changed before recipients were saved.");
      const result = await fetchPipelineJson<{ version: number }>(endpoint, { method: "PUT", body: JSON.stringify({ if_match: current.version, draft: { ...next, community } }) });
      current.version = result.version;
      current.saved = JSON.stringify(next);
      if (session.current === current && current.saved === JSON.stringify(current.fields)) setMessage("Recipients saved for this handoff");
    });
    void current.queue.catch((failure) => {
      current.error = failure instanceof Error ? failure.message : "Recipients could not be saved.";
      if (session.current === current) { setError(current.error); setMessage("Not saved"); }
    });
  };
  const flush = useCallback(async () => { await session.current?.queue; }, []);
  usePersonaSwitchSave(flush);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      const current = session.current;
      if (current && current.saved !== JSON.stringify(current.fields)) event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  return { fields: loading ? empty() : fields, lists: loading ? [] : lists, loading, message: loading ? "Loading recipients..." : message, error: loading ? "" : error, change, flush, reload: () => setReloadKey((value) => value + 1), editable: Boolean(referralId) && !loading && !error };
}

export type HandoffRecipients = ReturnType<typeof useHandoffRecipients>;

function recipientLoadMessage(saved: boolean, note: string, hasTemplate: boolean, community: string) {
  if (saved) return "Your saved handoff list";
  if (note) return note;
  if (hasTemplate) return `Filled from ${community}'s admission list`;
  return community ? "No saved community list. Add authorized recipients below." : "Choose a community to load its contacts";
}
