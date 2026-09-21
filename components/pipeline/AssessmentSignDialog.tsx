"use client";

import { useEffect, useRef } from "react";
import styles from "./AssessmentPreparation.module.css";

export default function AssessmentSignDialog({ clientName, signerName, isBusy, error, onClose, onConfirm }: {
  clientName: string;
  signerName: string;
  isBusy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    const current = dialog.current;
    current?.showModal();
    cancel.current?.focus({ preventScroll: true });
    return () => {
      current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} aria-label="Sign assessment" aria-describedby="assessment-sign-description" aria-busy={isBusy} className={styles.beginDialog}
    onCancel={(event) => { event.preventDefault(); if (!isBusy && !submitting.current) onClose(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") event.stopPropagation();
      if (event.key !== "Tab") return;
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <h2>Sign assessment?</h2>
    <dl>
      <div><dt>Client</dt><dd>{clientName}</dd></div>
      <div><dt>Signing as</dt><dd>{signerName}</dd></div>
    </dl>
    <p id="assessment-sign-description">This records your signature. It does not make an admission decision or send an email.</p>
    <p>You can still edit until Meet the Client is sent. Changes are logged.</p>
    {error ? <p role="alert">{error}</p> : null}
    <footer>
      <button ref={cancel} type="button" disabled={isBusy} onClick={onClose}>Cancel</button>
      <button type="button" disabled={isBusy} onClick={async () => {
        if (submitting.current || isBusy) return;
        submitting.current = true;
        try { await onConfirm(); } finally { submitting.current = false; }
      }}>{isBusy ? "Signing…" : "Sign assessment"}</button>
    </footer>
  </dialog>;
}
