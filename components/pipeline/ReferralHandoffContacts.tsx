"use client";

import { useState } from "react";
import { Mail, RotateCcw } from "lucide-react";
import { addListRecipients, parseRecipientText, type RecipientFields } from "@/lib/pipeline/community-recipient-lists";
import type { HandoffRecipients } from "./useHandoffRecipients";
import RecipientChipField from "./RecipientChipField";
import styles from "./ReferralHandoffContacts.module.css";

export default function ReferralHandoffContacts({ value, community, disabled = false, compact = false, composer = false }: {
  value: HandoffRecipients; community: string; disabled?: boolean; compact?: boolean; composer?: boolean;
}) {
  const [text, setText] = useState({ to: "", cc: "" });
  const [inputError, setInputError] = useState("");
  const [applyingList, setApplyingList] = useState(false);
  const count = value.fields.to.length + value.fields.cc.length;
  const contacts = [...new Map(value.lists.flatMap((list) => [...list.to, ...list.cc]).map((item) => [item.email, item])).values()];
  const excluded = new Set([...value.fields.to, ...value.fields.cc].map((item) => item.email));
  const add = (lane: keyof RecipientFields, input: string) => {
    const parsed = parseRecipientText(input);
    if (parsed.error) { setInputError(parsed.error); return; }
    try {
      value.change(addListRecipients(value.fields, lane, parsed.recipients!).fields);
      setText((previous) => ({ ...previous, [lane]: "" })); setInputError("");
    } catch (failure) { setInputError((failure as Error).message); }
  };
  const renderRefresh = () => community && community !== "Unassigned" && <button type="button" className={styles.refreshList} disabled={disabled || applyingList || !value.editable} onClick={async () => {
        if (!window.confirm(`Replace this handoff's To and Cc with the latest ${community} contact list? This does not send an email.`)) return;
        setApplyingList(true); setInputError("");
        try { await value.applyCommunityList(); setText({ to: "", cc: "" }); }
        catch (failure) { setInputError(failure instanceof Error ? failure.message : "The community list could not be loaded. Your recipients are unchanged."); }
        finally { setApplyingList(false); }
      }}><RotateCcw size={14} aria-hidden="true" />{applyingList ? "Loading community list…" : "Use latest community list"}</button>;
  const content =
    <div className={styles.content} aria-label="Handoff contacts">
      {!composer ? <p className={styles.explanation}>Changes apply to this handoff only. Confirm recipients before sending.</p> : null}
      {(["to", "cc"] as const).map((lane) => <RecipientChipField key={`${community}-${lane}`} compact label={lane === "to" ? "To" : "Cc"}
        recipients={value.fields[lane]} contacts={contacts} excluded={excluded} text={text[lane]} disabled={disabled || applyingList || !value.editable}
        onText={(input) => setText((previous) => ({ ...previous, [lane]: input }))} onAdd={(input) => add(lane, input)}
        onRemove={(email) => value.change({ ...value.fields, [lane]: value.fields[lane].filter((item) => item.email !== email) })} />)}
      {inputError ? <p role="alert" className={styles.error}>{inputError}</p> : null}
      {value.error ? <p role="alert" className={styles.error}>{value.error} <button type="button" onClick={() => void value.retry()}>Retry saving</button> <button type="button" onClick={() => { if (window.confirm("Reload the saved handoff draft? Any unsaved recipient and message edits will be replaced.")) value.reload(); }}><RotateCcw size={14} /> Reload saved draft</button></p> : null}
      <HandoffContactStatus value={value} />
      {renderRefresh()}
    </div>;
  if (composer) return <div className={styles.composer}>{content}</div>;
  return <details className={styles.section} open={!compact || undefined}>
    <summary><span className={styles.icon}><Mail size={19} aria-hidden="true" /></span><span><strong>Handoff contacts</strong><small>{community === "Unassigned" || !community ? "Select a community" : community} <span aria-hidden="true">/</span> {count} recipients</small></span><span className={styles.summaryNote}>{compact ? "Review To / Cc" : "Admission packet & Meet the Client"}</span></summary>
    {content}
  </details>;
}

function HandoffContactStatus({ value }: { value: HandoffRecipients }) {
  return <p role="status" className={styles.status}>{value.loading ? "Loading contacts..." : value.message}{!value.editable && !value.loading && !value.error ? ". Create the referral to edit these recipients." : ""}</p>;
}
