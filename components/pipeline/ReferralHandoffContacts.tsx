"use client";

import { useState } from "react";
import { Mail, RotateCcw } from "lucide-react";
import { addListRecipients, parseRecipientText, type RecipientFields } from "@/lib/pipeline/community-recipient-lists";
import type { HandoffRecipients } from "./useHandoffRecipients";
import RecipientChipField from "./RecipientChipField";
import styles from "./ReferralHandoffContacts.module.css";

export default function ReferralHandoffContacts({ value, community, disabled = false, compact = false }: {
  value: HandoffRecipients; community: string; disabled?: boolean; compact?: boolean;
}) {
  const [text, setText] = useState({ to: "", cc: "" });
  const [inputError, setInputError] = useState("");
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
  return <details className={styles.section} open={!compact || undefined}>
    <summary><span className={styles.icon}><Mail size={19} aria-hidden="true" /></span><span><strong>Handoff contacts</strong><small>{community === "Unassigned" || !community ? "Select a community" : community} <span aria-hidden="true">/</span> {count} recipients</small></span><span className={styles.summaryNote}>{compact ? "Review To / Cc" : "Admission packet & Meet the Client"}</span></summary>
    <div className={styles.content} aria-label="Handoff contacts">
      <p className={styles.explanation}>Built from your admission emails. Changes here apply only to your handoff, not the community list. Review everyone before sending.</p>
      {(["to", "cc"] as const).map((lane) => <RecipientChipField key={`${community}-${lane}`} label={lane === "to" ? "To" : "Cc"}
        recipients={value.fields[lane]} contacts={contacts} excluded={excluded} text={text[lane]} disabled={disabled || !value.editable}
        onText={(input) => setText((previous) => ({ ...previous, [lane]: input }))} onAdd={(input) => add(lane, input)}
        onRemove={(email) => value.change({ ...value.fields, [lane]: value.fields[lane].filter((item) => item.email !== email) })} />)}
      {inputError ? <p role="alert" className={styles.error}>{inputError}</p> : null}
      {value.error ? <p role="alert" className={styles.error}>{value.error} <button type="button" onClick={() => { if (window.confirm("Reload the saved list? Any unsaved contact edits will be replaced.")) value.reload(); }}><RotateCcw size={14} /> Reload saved list</button></p> : null}
      <p role="status" className={styles.status}>{value.loading ? "Loading contacts..." : value.message}{!value.editable && !value.loading && !value.error ? ". Create the referral to edit these recipients." : ""}</p>
    </div>
  </details>;
}
