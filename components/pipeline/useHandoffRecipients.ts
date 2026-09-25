"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { fetchCurrentPipelineUser, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { usePersonaSwitchSave } from "@/lib/demo/persona-switch-save";
import { addListRecipients, parseRecipientText, type CommunityRecipientList, type RecipientFields } from "@/lib/pipeline/community-recipient-lists";
import { emptyMeetClientMessage, type MeetClientMessage } from "@/lib/notifications/meet-client-message";
import { currentVolatileHandoffRecovery, forgetVolatileHandoffRecovery, registerHandoffEditor, rememberVolatileHandoffRecovery } from "@/lib/pipeline/volatile-recovery";

type DraftFields = RecipientFields & { message: MeetClientMessage };
const empty = (): DraftFields => ({ to: [], cc: [], message: emptyMeetClientMessage() });
const emptyInput = () => ({ to: "", cc: "" });
type Session = { key: string; version: number; fields: DraftFields; input: ReturnType<typeof emptyInput>; saved: string; queued: string; queue: Promise<void>; error: string };

export function useHandoffRecipients(referralId: number | undefined, community: string) {
  const [fields, setFields] = useState<DraftFields>(empty);
  const [recipientInput, setRecipientInput] = useState(emptyInput);
  const [inputError, setInputError] = useState("");
  const [lists, setLists] = useState<CommunityRecipientList[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const loadKey = JSON.stringify([referralId, community, reloadKey]);
  const loading = loadedKey !== loadKey;
  const session = useRef<Session | null>(null);
  const retrying = useRef(false);
  const messageSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpoint = referralId ? `/api/referrals/${referralId}/handoff-recipients` : "";
  useEffect(() => referralId ? registerHandoffEditor(referralId, community) : undefined, [community, referralId]);
  useEffect(() => {
    const controller = new AbortController();
    const current: Session = { key: `${referralId}:${community}`, version: 0, fields: empty(), input: emptyInput(), saved: "", queued: "", queue: Promise.resolve(), error: "" };
    session.current = current;
    const load = async () => {
      let templates: CommunityRecipientList[] = [];
      let note = "";
      try { templates = (await fetchPipelineJson<{ lists: CommunityRecipientList[] }>("/api/community-recipient-lists", { cache: "no-store", signal: controller.signal })).lists; }
      catch { note = "Community list unavailable. Add authorized recipients below."; }
      const stored = endpoint ? await fetchPipelineJson<{ draft: (RecipientFields & { community: string; message?: MeetClientMessage }) | null; version: number }>(endpoint, { signal: controller.signal }) : { draft: null, version: 0 };
      if (session.current !== current || controller.signal.aborted) return;
      const template = templates.find((list) => list.community === community);
      const values = stored.draft?.community === community ? stored.draft : template ?? empty();
      current.version = stored.version;
      current.fields = { to: values.to, cc: values.cc, message: stored.draft?.message ?? emptyMeetClientMessage() };
      current.saved = JSON.stringify(current.fields);
      current.queued = current.saved;
      let volatile = referralId ? await currentVolatileHandoffRecovery(referralId, community) : null;
      if (session.current !== current || controller.signal.aborted) return;
      if (volatile && referralId && !volatile.input.to.trim() && !volatile.input.cc.trim()
        && JSON.stringify(current.fields) === JSON.stringify(volatile.fields)) {
        forgetVolatileHandoffRecovery(referralId, community, volatile.fields);
        volatile = null;
      }
      if (volatile) {
        current.fields = volatile.fields;
        current.input = volatile.input;
        current.error = "Handoff edits are only in this open tab. Retry saving before sending.";
      }
      setFields(current.fields); setRecipientInput(current.input); setInputError(""); setLists(templates); setError(current.error);
      setMessage(volatile ? "Handoff edits restored · not yet saved" : recipientLoadMessage(stored.draft?.community === community, note, Boolean(template), community));
    };
    void load().catch(() => { if (!controller.signal.aborted) setError("Recipient drafts could not be loaded. Retry before editing."); })
      .finally(() => { if (!controller.signal.aborted) setLoadedKey(loadKey); });
    return () => { controller.abort(); if (messageSaveTimer.current) clearTimeout(messageSaveTimer.current); messageSaveTimer.current = null; if (session.current === current) session.current = null; };
  }, [community, endpoint, referralId, loadKey]);

  const save = useCallback(() => {
    const current = session.current;
    if (!current || !endpoint || !current.saved) return;
    const next = current.fields;
    const serialized = JSON.stringify(next);
    if (serialized === current.queued) return;
    current.queued = serialized;
    current.queue = current.queue.catch(() => undefined).then(async () => {
      if (session.current !== current) throw new Error("The workspace changed before recipients were saved.");
      const result = await fetchPipelineJson<{ version: number }>(endpoint, { method: "PUT", body: JSON.stringify({ if_match: current.version, draft: { ...next, community } }) });
      current.version = result.version;
      current.saved = serialized;
      if (session.current === current && current.saved === JSON.stringify(current.fields)) {
        current.error = "";
        setError("");
        setMessage("Handoff draft saved");
        if (referralId && !current.input.to.trim() && !current.input.cc.trim()) forgetVolatileHandoffRecovery(referralId, community, current.fields);
      }
    });
    void current.queue.catch((failure) => {
      current.error = failure instanceof Error ? failure.message : "The handoff draft could not be saved.";
      if (session.current === current) { setError(current.error); setMessage("Changes not saved. Retry saving."); }
    });
  }, [community, endpoint, referralId]);
  const change = (next: RecipientFields) => {
    const current = session.current;
    if (!current || !endpoint || loading || !current.saved) return;
    current.fields = { ...next, message: current.fields.message }; setFields(current.fields); setMessage(current.error ? "Changes not saved. Retry saving." : "Saving handoff draft...");
    save();
  };
  const changeMessage = (next: MeetClientMessage) => {
    const current = session.current;
    if (!current || !endpoint || loading || !current.saved) return;
    current.fields = { ...current.fields, message: next }; setFields(current.fields); setMessage(current.error ? "Changes not saved. Retry saving." : "Saving handoff draft...");
    if (messageSaveTimer.current) clearTimeout(messageSaveTimer.current);
    messageSaveTimer.current = setTimeout(() => { messageSaveTimer.current = null; save(); }, 400);
  };
  const changeRecipientInput = (lane: keyof RecipientFields, input: string) => {
    const current = session.current;
    if (!current || loading || !current.saved) return;
    current.input = { ...current.input, [lane]: input };
    setRecipientInput(current.input); setInputError("");
  };
  const flush = useCallback(async () => {
    if (messageSaveTimer.current) clearTimeout(messageSaveTimer.current);
    messageSaveTimer.current = null;
    const current = session.current;
    if (current && Object.values(current.input).some(value => value.trim())) {
      try {
        let recipients: RecipientFields = current.fields;
        for (const lane of ["to", "cc"] as const) {
          const parsed = parseRecipientText(current.input[lane]);
          if (parsed.error) throw new Error(parsed.error);
          recipients = addListRecipients(recipients, lane, parsed.recipients!).fields;
        }
        current.fields = { ...current.fields, ...recipients };
        current.input = emptyInput();
        setFields(current.fields); setRecipientInput(current.input); setInputError("");
      } catch (failure) {
        setInputError(failure instanceof Error ? failure.message : "Check the unfinished recipient address.");
        throw failure;
      }
    }
    save();
    await current?.queue;
  }, [save]);
  const leave = useCallback(async () => {
    try { await flush(); }
    catch {
      const current = session.current;
      if (!current || !referralId) return;
      if (current.saved === JSON.stringify(current.fields) && !current.input.to.trim() && !current.input.cc.trim()) return;
      const principal = (await fetchCurrentPipelineUser()).user?.id;
      if (!principal) throw new Error("Your account could not be confirmed for this handoff copy. Keep the workspace open.");
      rememberVolatileHandoffRecovery(principal, referralId, community, {
        version: current.version, fields: structuredClone(current.fields), input: { ...current.input },
      });
    }
  }, [community, flush, referralId]);
  const retry = async () => {
    const current = session.current;
    if (!current || retrying.current) return;
    retrying.current = true;
    try {
    if (!current.saved) { setReloadKey(value => value + 1); return; }
    await current.queue.catch(() => undefined);
    try {
      // The PUT may have committed even when its response was lost. Read it back
      // before retrying with an old version or telling the assessor to resubmit.
      const stored = await fetchPipelineJson<{ draft: DraftFields & { community: string } | null; version: number }>(endpoint, { cache: "no-store" });
      if (session.current !== current) return;
      const persisted = stored.draft?.community === community ? stored.draft : null;
      if (persisted && JSON.stringify({ to: persisted.to, cc: persisted.cc, message: persisted.message }) === JSON.stringify(current.fields)) {
        current.version = stored.version;
        current.saved = JSON.stringify(current.fields);
        current.queued = current.saved;
        current.queue = Promise.resolve();
        current.error = "";
        setError("");
        setMessage("Handoff draft saved");
        if (referralId && !current.input.to.trim() && !current.input.cc.trim()) forgetVolatileHandoffRecovery(referralId, community, current.fields);
        return;
      }
      if (stored.version !== current.version) {
        current.error = "This handoff draft changed in another session. Your edits are still here; reload the saved draft before replacing them.";
        setError(current.error);
        return;
      }
      current.queue = Promise.resolve();
      current.error = "";
      current.queued = "";
      setError("");
      save();
    } catch (failure) {
      if (session.current !== current) return;
      current.error = failure instanceof Error ? failure.message : "The saved handoff draft could not be checked. Retry saving.";
      setError(current.error);
    }
    } finally { retrying.current = false; }
  };
  const retryFailedHandoff = useEffectEvent(() => {
    const current = session.current;
    if (!current?.error || !current.saved || current.error.includes("changed in another session") || !window.navigator.onLine) return;
    void retry();
  });
  useEffect(() => {
    const timer = window.setInterval(() => retryFailedHandoff(), 10_000);
    const onOnline = () => retryFailedHandoff();
    window.addEventListener("online", onOnline);
    return () => { window.clearInterval(timer); window.removeEventListener("online", onOnline); };
  }, [community, referralId]);
  const applyCommunityList = async () => {
    const current = session.current;
    if (!current || loading || current.error || !endpoint) throw new Error("Save or reload these recipients before replacing the list.");
    await flush();
    const result = await fetchPipelineJson<{ lists: CommunityRecipientList[] }>("/api/community-recipient-lists", { cache: "no-store" });
    if (session.current !== current) throw new Error("The workspace changed. Open its contacts again.");
    const template = result.lists.find((list) => list.community === community);
    if (!template) throw new Error("No contact list is saved for this community yet.");
    setLists(result.lists);
    change({ to: template.to, cc: template.cc });
    await current.queue;
  };
  usePersonaSwitchSave(flush);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      const current = session.current;
      if (current && (current.saved !== JSON.stringify(current.fields) || Object.values(current.input).some(value => value.trim()))) event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  return { fields: loading ? empty() : fields, recipientInput: loading ? emptyInput() : recipientInput, inputError, changeRecipientInput, hasPendingRecipients: !loading && Object.values(recipientInput).some(value => value.trim()), lists: loading ? [] : lists, loading, message: loading ? "Loading recipients..." : message, error: loading ? "" : error, change, changeMessage, flush, leave, retry, applyCommunityList, reload: () => setReloadKey((value) => value + 1), editable: Boolean(referralId) && !loading && Boolean(session.current?.saved) };
}

export type HandoffRecipients = ReturnType<typeof useHandoffRecipients>;

function recipientLoadMessage(saved: boolean, note: string, hasTemplate: boolean, community: string) {
  if (saved) return "Your saved handoff list";
  if (note) return note;
  if (hasTemplate) return `Filled from ${community}'s admission list`;
  return community ? "No saved community list. Add authorized recipients below." : "Choose a community to load its contacts";
}
