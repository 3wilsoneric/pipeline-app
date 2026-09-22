"use client";

import { RotateCcw } from "lucide-react";
import type { HandoffRecipients } from "./useHandoffRecipients";
import { useConfirmationDialog } from "./useConfirmationDialog";
import styles from "./ReferralHandoffContacts.module.css";

export default function HandoffDraftStatus({ value }: { value: HandoffRecipients }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  return <div className={styles.draftStatus}>
    {confirmationDialog}
    {value.error ? <p role="alert" className={styles.error}>{value.error} <button type="button" onClick={() => void value.retry()}>Retry saving</button> <button type="button" onClick={async () => {
      if (await confirm({ title: "Reload the saved handoff draft?", message: "Any unsaved recipient and message edits will be replaced.", confirmLabel: "Reload saved draft", cancelLabel: "Keep editing", destructive: true })) value.reload();
    }}><RotateCcw size={14} /> Reload saved draft</button></p> : null}
    {value.inputError ? <p role="alert" className={styles.error}>{value.inputError}</p> : null}
    <p role="status" className={styles.status}>{value.hasPendingRecipients ? "Press Enter or + to add the unfinished address before confirming recipients." : value.message}{!value.editable && !value.loading && !value.error ? ". Create the referral to edit these recipients." : ""}</p>
  </div>;
}
