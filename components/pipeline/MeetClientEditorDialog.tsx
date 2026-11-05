"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, Check, ChevronRight, Eye, Plus, Redo2, SpellCheck, Undo2, X } from "lucide-react";
import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { meetClientLayout, meetClientSubjectLimit, parseMeetClientMessage, type MeetClientMessage, type MeetClientSectionId } from "@/lib/notifications/meet-client-message";
import { meetClientSections, renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import type { HandoffRecipients } from "./useHandoffRecipients";
import MeetClientSections from "./MeetClientSections";
import { createEditorHistory, messageKey, recordEditorChange, stepEditorHistory } from "./meet-client-editor-history";
import { useMobileViewport } from "./use-mobile-viewport";
import styles from "./MeetClientEditorDialog.module.css";

type EditorField = MeetClientSectionId | "subject";
export default function MeetClientEditorDialog({ summary, draft, preparedBy, attachments, demo, disabled, onClose }: {
  summary: MeetClientSummary; draft: HandoffRecipients; preparedBy: string; attachments: string[];
  demo: boolean; disabled: boolean; onClose: () => void;
}) {
  const dialog = useMobileViewport<HTMLDialogElement>();
  const title = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const returnToEdit = useRef<{ top: number; field: HTMLInputElement | HTMLTextAreaElement | null; start: number | null; end: number | null } | null>(null);
  const instance = useId();
  const [preview, setPreview] = useState(false);
  const [active, setActive] = useState<EditorField>("subject");
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const content = draft.fields.message;
  const [history, setHistory] = useState(() => createEditorHistory(content));
  const editable = draft.editable && !disabled && !closing;
  const ownsHistory = messageKey(content) === messageKey(history.present.message);
  const canUndo = editable && ownsHistory && history.past.length > 0;
  const canRedo = editable && ownsHistory && history.future.length > 0;
  const sections = meetClientSections(summary, content);
  const navigation = [{ id: "subject" as const, title: "Subject" }, ...sections];
  const activeField = navigation.some(item => item.id === active) ? active : navigation[0].id;
  const rendered = renderMeetClientEmail(summary, preparedBy, "preview", attachments, content, { demo, logoUrl: toPipelinePath("/brand/alamo-health-management.png") });
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal(); title.current?.focus();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [dialog]);
  const close = async () => {
    if (closing) return;
    setClosing(true);
    try { await draft.flush(); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Your email edits have not saved. Retry saving before closing."); }
    finally { setClosing(false); }
  };
  const focusField = (field: EditorField) => {
    requestAnimationFrame(() => {
      const target = dialog.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-editor-field="${field}"]`)
        ?? dialog.current?.querySelector<HTMLInputElement>('[data-editor-field="subject"]');
      if (!target) return;
      target.focus({ preventScroll: true });
      (target.closest("[data-message-section]") ?? target).scrollIntoView({ block: "start", behavior: "instant" });
      setActive(target.dataset.editorField as EditorField);
    });
  };
  const apply = (next: MeetClientMessage) => {
    setError("");
    draft.changeMessage(next);
    if (JSON.stringify(meetClientLayout(content)) !== JSON.stringify(meetClientLayout(next))) draft.changeLayout(meetClientLayout(next));
  };
  const change = (next: MeetClientMessage, field: EditorField, typing = false) => {
    if (!editable) return;
    const parsed = parseMeetClientMessage(next);
    if (!parsed) { setError("Keep the email text within 20,000 characters and the subject within 200."); return; }
    setHistory(current => recordEditorChange(current, content, parsed, field, typing ? field : ""));
    apply(parsed);
  };
  const changeText = (id: MeetClientSectionId, value: string | undefined) => {
    if (id === "message" && content.body != null) { change({ ...content, body: value ?? "" }, id, value !== undefined); return; }
    const sectionText = { ...content.sectionText };
    if (value === undefined) delete sectionText[id]; else sectionText[id] = value;
    change({ ...content, sectionText }, id, value !== undefined);
    if (value === undefined) focusField(id === "message" ? "subject" : id);
  };
  const stepHistory = (direction: "undo" | "redo") => {
    if (direction === "undo" ? !canUndo : !canRedo) return;
    const next = stepEditorHistory(history, direction);
    setHistory(next); apply(next.present.message);
    focusField(next.present.field);
  };
  const togglePreview = () => {
    if (!preview) {
      const field = lastField.current;
      returnToEdit.current = { top: scroll.current?.scrollTop ?? 0, field, start: field?.selectionStart ?? null, end: field?.selectionEnd ?? null };
      setPreview(true);
    } else {
      setPreview(false);
      requestAnimationFrame(() => {
        const saved = returnToEdit.current;
        if (!saved) return;
        if (saved.field?.isConnected) {
          saved.field.focus({ preventScroll: true });
          if (saved.start !== null && saved.end !== null) saved.field.setSelectionRange(saved.start, saved.end);
        }
        if (scroll.current) scroll.current.scrollTop = saved.top;
      });
    }
  };
  const trackSection = () => {
    const host = scroll.current;
    if (!host || preview) return;
    const top = host.getBoundingClientRect().top + 96;
    let current: EditorField = "subject";
    for (const block of host.querySelectorAll<HTMLElement>("[data-message-section]")) {
      if (block.getBoundingClientRect().top > top) break;
      current = block.dataset.messageSection as MeetClientSectionId;
    }
    setActive(current);
  };
  return <dialog ref={dialog} data-meet-client-editor className={styles.dialog} aria-labelledby={`${instance}-title`}
    onKeyDown={(event) => {
      if (preview || event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" || key === "y") { event.preventDefault(); stepHistory(key === "y" || event.shiftKey ? "redo" : "undo"); }
    }} onCancel={(event) => { event.preventDefault(); void close(); }}>
    <header className={styles.header}>
      <div><h2 id={`${instance}-title`} ref={title} tabIndex={-1}>Edit Meet the Client</h2><p>Layout follows you. Client wording stays here.</p></div>
      <button type="button" className={styles.close} aria-label="Close email editor" disabled={closing} onClick={() => void close()}><X size={22} aria-hidden="true" /></button>
    </header>
    <div className={styles.toolbar}>
      <div className={styles.historyTools} role="group" aria-label="Edit history">
        <button type="button" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={preview || !canUndo} onClick={() => stepHistory("undo")}><Undo2 size={19} aria-hidden="true" /></button>
        <button type="button" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={preview || !canRedo} onClick={() => stepHistory("redo")}><Redo2 size={19} aria-hidden="true" /></button>
      </div>
      <button type="button" className={styles.addNote} aria-label="Add a note" title="Add a note" disabled={preview || !editable || content.body != null || content.sectionText?.message !== undefined}
        onClick={() => { change({ ...content, sectionText: { ...content.sectionText, message: "" } }, "message"); focusField("message"); }}><Plus size={18} aria-hidden="true" /><span>Add a note</span></button>
      <span className={styles.spelling} title="Spellcheck on · autocorrect off"><SpellCheck size={18} aria-hidden="true" /><span>Spellcheck on · autocorrect off</span></span>
      <button type="button" className={styles.previewToggle} aria-pressed={preview} aria-controls={`${instance}-preview`} onClick={togglePreview}>
        {preview ? <ArrowLeft size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}{preview ? "Back to editing" : "Preview email"}
      </button>
    </div>
    <div className={styles.workspace} hidden={preview}>
      <aside className={styles.outline}>
        <div className={styles.client}><span>Meet the Client</span><strong>{summary.name}</strong></div>
        <nav aria-label="Email sections">{navigation.map(item => <button key={item.id} type="button" aria-current={activeField === item.id ? "location" : undefined} onClick={() => focusField(item.id)}>
          <span>{item.title}</span>{activeField === item.id ? <ChevronRight size={16} aria-hidden="true" /> : null}
        </button>)}</nav>
      </aside>
      <label className={styles.sectionPicker}><span>Section</span><select aria-label="Go to email section" value={activeField} onChange={event => focusField(event.target.value as EditorField)}>{navigation.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div ref={scroll} className={styles.scroll} onScroll={trackSection} onFocusCapture={event => {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) lastField.current = target;
        const field = (target as HTMLElement).dataset.editorField ?? (target as HTMLElement).closest<HTMLElement>("[data-message-section]")?.dataset.messageSection;
        if (field) setActive(field as EditorField);
      }}>
        <div className={styles.paper}>
          <label className={styles.subject}>Subject<input data-editor-field="subject" value={content.subject ?? rendered.subject} maxLength={meetClientSubjectLimit} readOnly={!editable}
            spellCheck lang="en-US" autoCorrect="off" autoCapitalize="off" onChange={event => change({ ...content, subject: event.target.value }, "subject", true)} /></label>
          <Image src={toPipelinePath("/brand/alamo-health-management.png")} alt="Alamo Health Management" width={300} height={80} unoptimized className={styles.logo} />
          <MeetClientSections summary={summary} message={content} editable={editable} editing activeSection={activeField}
            onOrderChange={(sectionOrder, moved) => change({ ...content, ...meetClientLayout(content), sectionOrder }, moved ?? activeField)}
            onFormatChange={(id, format) => change({ ...content, sectionFormats: { ...content.sectionFormats, [id]: format } }, id)}
            onTextChange={changeText} />
        </div>
      </div>
    </div>
    <div id={`${instance}-preview`} className={styles.previewPanel} hidden={!preview}>
      {preview ? <iframe title="Edited Meet the Client email preview" srcDoc={rendered.html} sandbox="" referrerPolicy="no-referrer" className={styles.preview} /> : null}
    </div>
    <footer className={styles.footer}>
      <div className={styles.saveStatus}>
        <span role="status" className={styles.draftStatus}>{draft.message === "Handoff draft saved" ? <Check size={16} aria-hidden="true" /> : null}{draft.message}</span>
        {error || draft.error ? <div role="alert">{error || draft.error} <button type="button" onClick={() => { setError(""); void draft.retry(); }}>Retry saving</button></div> : null}
        {draft.layoutError ? <div role="alert">{draft.layoutError} <button type="button" onClick={() => void draft.retryLayout()}>Retry layout save</button> <button type="button" onClick={() => void draft.retryLayout(true)}>Use latest default</button></div> : <span role="status">{draft.layoutStatus}</span>}
      </div>
      <button type="button" className={styles.done} disabled={closing} onClick={() => void close()}>{closing ? "Saving…" : "Done"}<Check size={18} aria-hidden="true" /></button>
    </footer>
  </dialog>;
}
