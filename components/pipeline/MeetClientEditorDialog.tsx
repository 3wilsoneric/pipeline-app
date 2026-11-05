"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, Eye, Plus, X } from "lucide-react";
import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { meetClientLayout, meetClientSubjectLimit, parseMeetClientMessage, type MeetClientMessage, type MeetClientSectionId } from "@/lib/notifications/meet-client-message";
import { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import type { HandoffRecipients } from "./useHandoffRecipients";
import MeetClientSections from "./MeetClientSections";
import { useMobileViewport } from "./use-mobile-viewport";
import styles from "./MeetClientEditorDialog.module.css";

export default function MeetClientEditorDialog({ summary, draft, preparedBy, attachments, demo, disabled, onClose }: {
  summary: MeetClientSummary; draft: HandoffRecipients; preparedBy: string; attachments: string[];
  demo: boolean; disabled: boolean; onClose: () => void;
}) {
  const dialog = useMobileViewport<HTMLDialogElement>();
  const title = useRef<HTMLHeadingElement>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const content = draft.fields.message;
  const editable = draft.editable && !disabled && !closing;
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
  const change = (next: MeetClientMessage) => {
    if (!editable) return;
    if (!parseMeetClientMessage(next)) { setError("Keep the email text within 20,000 characters and the subject within 200."); return; }
    setError(""); draft.changeMessage(next);
  };
  const changeText = (id: MeetClientSectionId, value: string | undefined) => {
    if (id === "message" && content.body != null) { change({ ...content, body: value ?? "" }); return; }
    const sectionText = { ...content.sectionText };
    if (value === undefined) delete sectionText[id]; else sectionText[id] = value;
    change({ ...content, sectionText });
  };
  return <dialog ref={dialog} data-meet-client-editor className={styles.dialog} aria-labelledby="meet-client-editor-title"
    onCancel={(event) => { event.preventDefault(); void close(); }}>
    <header className={styles.header}>
      <div><h2 id="meet-client-editor-title" ref={title} tabIndex={-1}>Edit Meet the Client</h2><p>Layout follows you. Client wording stays here.</p></div>
      <button type="button" aria-label="Close email editor" disabled={closing} onClick={() => void close()}><X size={22} aria-hidden="true" /></button>
    </header>
    <div className={styles.toolbar}>
      <button type="button" onClick={() => setPreview(!preview)}>{preview ? <ArrowLeft size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}{preview ? "Back to editing" : "Preview email"}</button>
      {!preview && content.body == null && content.sectionText?.message === undefined ? <button type="button" disabled={!editable} onClick={() => { changeText("message", ""); requestAnimationFrame(() => dialog.current?.querySelector<HTMLTextAreaElement>('[data-message-section="message"] textarea')?.focus()); }}><Plus size={18} aria-hidden="true" />Add a note</button> : null}
      <span>Spellcheck on · autocorrect off</span>
    </div>
    <div className={styles.scroll}>
      {preview ? <iframe title="Edited Meet the Client email preview" srcDoc={rendered.html} sandbox="" referrerPolicy="no-referrer" className={styles.preview} /> : <div className={styles.paper}>
        <label className={styles.subject}>Subject<input value={content.subject ?? rendered.subject} maxLength={meetClientSubjectLimit} readOnly={!editable}
          spellCheck lang="en-US" autoCorrect="off" autoCapitalize="off" onChange={(event) => change({ ...content, subject: event.target.value })} /></label>
        <Image src={toPipelinePath("/brand/alamo-health-management.png")} alt="Alamo Health Management" width={300} height={80} unoptimized className={styles.logo} />
        <MeetClientSections summary={summary} message={content} editable={editable} editing
          onOrderChange={sectionOrder => draft.changeLayout({ ...meetClientLayout(content), sectionOrder })}
          onFormatChange={(id, format) => draft.changeLayout({ ...meetClientLayout(content), sectionFormats: { ...content.sectionFormats, [id]: format } })}
          onTextChange={changeText} />
      </div>}
    </div>
    <footer className={styles.footer}>
      <div className={styles.saveStatus}>
        <span role="status">{draft.message}</span>
        {error || draft.error ? <div role="alert">{error || draft.error} <button type="button" onClick={() => { setError(""); void draft.retry(); }}>Retry saving</button></div> : null}
        {draft.layoutError ? <div role="alert">{draft.layoutError} <button type="button" onClick={() => void draft.retryLayout()}>Retry layout save</button> <button type="button" onClick={() => void draft.retryLayout(true)}>Use latest default</button></div> : <span role="status">{draft.layoutStatus}</span>}
      </div>
      <button type="button" className={styles.done} disabled={closing} onClick={() => void close()}>{closing ? "Saving…" : "Done"}</button>
    </footer>
  </dialog>;
}
