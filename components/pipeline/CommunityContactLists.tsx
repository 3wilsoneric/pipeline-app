"use client";

import { useConfirmationDialog } from "./useConfirmationDialog";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronRight, LoaderCircle, Mail, Undo2 } from "lucide-react";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { usePersonaSwitchSave } from "@/lib/demo/persona-switch-save";
import { addListRecipients, parseRecipientText, recipientListLimit, type CommunityRecipientList, type ListRecipient, type RecipientFields } from "@/lib/pipeline/community-recipient-lists";
import { usePipelineShell } from "./pipeline-shell-context";
import RecipientChipField from "./RecipientChipField";
import styles from "./CommunityContactLists.module.css";

const endpoint = "/api/community-recipient-lists";
const emptyText = { to: "", cc: "" };

export default function CommunityContactLists() {
  const [lists, setLists] = useState<CommunityRecipientList[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchPipelineJson<{ lists: CommunityRecipientList[]; canManage: boolean }>(endpoint, { cache: "no-store", signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setLists(result.lists); setCanManage(result.canManage); } })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof PipelineApiError ? failure.message : "Contact lists could not be loaded. Please reload to try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadKey]);
  return <div className={styles.page}>
    <div className={styles.content}>
      <header className={styles.pageHeader}>
        <Link href="/settings" className={styles.back}><ArrowLeft size={16} aria-hidden="true" /> Settings</Link>
        <div className={styles.headingLine}><h1>Community contact lists</h1></div>
        <p>Choose a community to manage its Meet the Client recipients. Saving updates the defaults for the team; it never sends an email.</p>
      </header>
      {loading ? <p role="status" className={styles.loading}><LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" /> Loading contact lists</p>
        : error ? <div role="alert" aria-label="Contact list error" className={styles.error}>{error}<button type="button" onClick={() => { setLoading(true); setError(""); setReloadKey((key) => key + 1); }}>Try again</button></div>
        : lists.length ? <ListEditor lists={lists} canEdit={canManage} onSaved={setLists} /> : <p>No community lists have been added yet.</p>}
    </div>
  </div>;
}

function ListEditor({ lists, canEdit, onSaved }: { lists: CommunityRecipientList[]; canEdit: boolean; onSaved: (lists: CommunityRecipientList[]) => void }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const router = useRouter();
  const [community, setCommunity] = useState(lists[0].community);
  const current = lists.find((list) => list.community === community)!;
  const [fields, setFields] = useState<RecipientFields>({ to: current.to, cc: current.cc });
  const [text, setText] = useState(emptyText);
  const [undo, setUndo] = useState<{ lane: keyof RecipientFields; recipient: ListRecipient; index: number } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const mutation = useRef<{ payload: string; id: string } | null>(null);
  const { beforeNavigationRef } = usePipelineShell();
  const changed = JSON.stringify(fields) !== JSON.stringify({ to: current.to, cc: current.cc });
  const dirty = changed || Object.values(text).some((value) => value.trim());
  const contacts = [...new Map(lists.flatMap((list) => [...list.to, ...list.cc]).map((item) => [item.email, item])).values()];
  const excluded = new Set([...fields.to, ...fields.cc].map((item) => item.email));

  const add = (lane: keyof RecipientFields, value: string) => {
    const parsed = parseRecipientText(value);
    setError("");
    if (parsed.error) { setText((previous) => ({ ...previous, [lane]: value })); setError(parsed.error); return; }
    try {
      const next = addListRecipients(fields, lane, parsed.recipients!);
      setFields(next.fields);
      setText((previous) => ({ ...previous, [lane]: "" }));
      setMessage(next.added ? `${next.added} contact${next.added === 1 ? "" : "s"} added.` : "Already included in To or Cc.");
    } catch (failure) { setText((previous) => ({ ...previous, [lane]: value })); setError((failure as Error).message); }
  };

  const save = async () => {
    if (!canEdit) return;
    if (pending.current) return pending.current;
    if (!dirty) return;
    const operation = async () => {
      setError(""); setSaving(true);
      try {
        let recipients = fields;
        for (const lane of ["to", "cc"] as const) {
          const parsed = parseRecipientText(text[lane]);
          if (parsed.error) throw new Error(parsed.error);
          recipients = addListRecipients(recipients, lane, parsed.recipients!).fields;
        }
        const payload = JSON.stringify({ community, version: current.version, ...recipients });
        if (mutation.current?.payload !== payload) mutation.current = { payload, id: crypto.randomUUID() };
        const result = await fetchPipelineJson<{ list: CommunityRecipientList }>(endpoint, { method: "PUT", body: JSON.stringify({ ...JSON.parse(payload), mutationId: mutation.current.id }) });
        onSaved(lists.map((list) => list.community === community ? result.list : list));
        setFields({ to: result.list.to, cc: result.list.cc }); setText(emptyText); setUndo(null); setConflict(false);
        setMessage("Contact list saved.");
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not save. Your edits are still here; try again.");
        setConflict(failure instanceof PipelineApiError && failure.status === 409);
        throw failure;
      } finally { setSaving(false); }
    };
    pending.current = operation();
    try { await pending.current; } finally { pending.current = null; }
  };
  const saveLatest = useEffectEvent(save);
  usePersonaSwitchSave(save);
  useEffect(() => {
    const guard = () => saveLatest();
    beforeNavigationRef.current = guard;
    return () => { if (beforeNavigationRef.current === guard) beforeNavigationRef.current = null; };
  }, [beforeNavigationRef]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const link = (event: MouseEvent) => {
      if (!isUnmodifiedClick(event)) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      event.preventDefault(); event.stopPropagation();
      void saveLatest().then(() => router.push(`${anchor.pathname}${anchor.search}${anchor.hash}`)).catch(() => undefined);
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", link, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", link, true); };
  }, [dirty, router]);

  const choose = async (next: typeof community) => {
    if (next === community || saving) return;
    if (dirty && !await confirm({ title: "Switch communities?", message: "Unsaved changes to this list will be discarded.", confirmLabel: "Discard & switch", cancelLabel: "Keep editing", destructive: true })) return;
    const list = lists.find((item) => item.community === next)!;
    setCommunity(next); setFields({ to: list.to, cc: list.cc }); setText(emptyText); setUndo(null); setError(""); setConflict(false); setMessage("");
  };
  const reload = async () => {
    if (dirty && !await confirm({ title: "Reload the saved list?", message: "Your unsaved edits will be replaced with the latest saved list.", confirmLabel: "Reload saved list", cancelLabel: "Keep editing", destructive: true })) return;
    try {
      const result = await fetchPipelineJson<{ lists: CommunityRecipientList[] }>(endpoint, { cache: "no-store" });
      const list = result.lists.find((item) => item.community === community)!;
      onSaved(result.lists); setFields({ to: list.to, cc: list.cc }); setText(emptyText); setUndo(null); setConflict(false); setError(""); setMessage("Latest saved list loaded.");
    } catch { setError("Could not reload. Your edits are still here; try again."); }
  };

  return <div className={styles.layout}>
    {confirmationDialog}
    <nav className={styles.communities} aria-label="Community contact lists">
      <span className={styles.navLabel}>Communities</span>
      {lists.map((list) => <button key={list.community} type="button" disabled={saving} aria-current={list.community === community ? "true" : undefined} onClick={() => choose(list.community)}>
        <span><strong>{list.community === "JC Wallace" ? "JC Wallace House" : list.community}</strong><small>{list.to.length + list.cc.length} contacts</small></span><ChevronRight size={16} aria-hidden="true" />
      </button>)}
    </nav>
    <div className={styles.mobileCommunity}>
      <label htmlFor="contact-community">Community</label>
      <select id="contact-community" value={community} disabled={saving} onChange={(event) => choose(event.target.value as typeof community)}>{lists.map((list) => <option key={list.community} value={list.community}>{list.community === "JC Wallace" ? "JC Wallace House" : list.community}</option>)}</select>
    </div>
    <form className={styles.editor} aria-label={`${community} contact list`} onSubmit={(event) => { event.preventDefault(); void save().catch(() => undefined); }}>
      <header className={styles.editorHeader}>
        <span className={styles.mailIcon}><Mail size={23} aria-hidden="true" /></span>
        <div><h2>{community === "JC Wallace" ? "JC Wallace House" : community}</h2><p>Meet the Client <span aria-hidden="true">/</span> {fields.to.length + fields.cc.length} recipients</p></div>
      </header>
      <fieldset disabled={saving} className={styles.fields}>
        <legend className="sr-only">Recipients</legend>
        {(["to", "cc"] as const).map((lane) => <RecipientChipField key={`${community}-${lane}`} label={lane === "to" ? "To" : "Cc"} recipients={fields[lane]} contacts={contacts} excluded={excluded} text={text[lane]} disabled={saving} readOnly={!canEdit}
          onText={(value) => { setText((previous) => ({ ...previous, [lane]: value })); setError(""); }} onAdd={(value) => add(lane, value)}
          onRemove={(email) => { const index = fields[lane].findIndex((item) => item.email === email); setUndo({ lane, recipient: fields[lane][index], index }); setFields({ ...fields, [lane]: fields[lane].filter((item) => item.email !== email) }); setError(""); setMessage("Contact removed from this list."); }} />)}
      </fieldset>
      <div className={styles.note}>These contacts prefill new handoffs for this community. Individually saved recipients stay unchanged; use the latest community list from the handoff when needed. Always review before sending.</div>
      {error && <div className={styles.error} role="alert" aria-label="Contact list error">{error}{conflict && <button type="button" disabled={saving} onClick={() => void reload()}>Reload saved list</button>}</div>}
      <footer className={styles.footer}>
        <div className={styles.feedback}><span role="status">{canEdit ? listSaveStatus(saving, dirty, message) : "View only. Change recipients on the individual handoff."}</span>
          {undo && <button type="button" disabled={saving} onClick={() => {
            if (!excluded.has(undo.recipient.email)) {
              if (excluded.size >= recipientListLimit) { setError("Remove a contact before undoing: the list has reached 100 recipients."); return; }
              const restored = [...fields[undo.lane]];
              restored.splice(undo.index, 0, undo.recipient);
              setFields({ ...fields, [undo.lane]: restored });
            }
            setUndo(null); setMessage("Removal undone.");
          }}><Undo2 size={14} aria-hidden="true" /> Undo</button>}
        </div>
        {canEdit && <button className={styles.save} type="submit" disabled={saving || !dirty}>{saving ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> : <Check size={16} aria-hidden="true" />} Save list</button>}
      </footer>
      <span role="status" className="sr-only">{message}</span>
    </form>
  </div>;
}

function isUnmodifiedClick(event: MouseEvent) {
  return !event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

function listSaveStatus(saving: boolean, dirty: boolean, message: string) {
  if (saving) return "Saving...";
  if (dirty) return "Unsaved changes";
  return message || "All changes saved";
}
