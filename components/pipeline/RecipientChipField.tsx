"use client";

import { useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { ListRecipient } from "@/lib/pipeline/community-recipient-lists";
import styles from "./CommunityContactLists.module.css";

type Props = {
  label: "To" | "Cc";
  recipients: ListRecipient[];
  contacts: ListRecipient[];
  excluded: Set<string>;
  text: string;
  disabled: boolean;
  onText: (text: string) => void;
  onAdd: (text: string) => void;
  onRemove: (email: string) => void;
};

export default function RecipientChipField({ label, recipients, contacts, excluded, text, disabled, onText, onAdd, onRemove }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const query = text.trim().toLowerCase();
  const suggestions = query && !/[<>;,\n]/u.test(query)
    ? contacts.filter((item) => !excluded.has(item.email) && `${item.name} ${item.email}`.toLowerCase().includes(query)).slice(0, 6) : [];
  const open = focused && suggestions.length > 0;
  const select = (recipient: ListRecipient) => {
    onAdd(recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email);
    setActive(-1);
    input.current?.focus();
  };

  return <div className={styles.recipientRow}>
    <label className={styles.laneLabel} htmlFor={id}>{label}<span>{recipients.length}</span></label>
    <div className={styles.recipientBody}>
      <ul className={styles.chips} aria-label={`${label} recipients`}>
        {recipients.map((recipient) => <li key={recipient.email} className={styles.chip}>
          <span className={styles.avatar} aria-hidden="true">{(recipient.name || recipient.email).slice(0, 1).toUpperCase()}</span>
          <span className={styles.identity}><strong>{recipient.name || recipient.email}</strong>{recipient.name && <span>{recipient.email}</span>}</span>
          <button type="button" disabled={disabled} className={styles.remove} aria-label={`Remove ${recipient.name || recipient.email} from ${label}`} title={`Remove ${recipient.email}`} onClick={() => { onRemove(recipient.email); input.current?.focus(); }}><X size={15} aria-hidden="true" /></button>
        </li>)}
      </ul>
      <div className={styles.addWrap}>
        <div className={styles.addLine}>
          <input ref={input} id={id} value={text} disabled={disabled} autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded={open} aria-controls={`${id}-suggestions`} aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? `${id}-suggestion-${active}` : undefined}
            placeholder="Add a name or email address" aria-describedby={`${id}-hint`}
            onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setActive(-1); }}
            onChange={(event) => { onText(event.target.value); setFocused(true); setActive(-1); }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              if (/[;\n]/u.test(pasted) && !text.trim()) { event.preventDefault(); onAdd(pasted); }
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                setActive((current) => event.key === "ArrowDown" ? (current + 1) % suggestions.length : (current - 1 + suggestions.length) % suggestions.length);
              } else if (event.key === "Escape") { setFocused(false); setActive(-1); }
              else if (event.key === "Enter" || event.key === ";") {
                event.preventDefault();
                if (open && active >= 0) select(suggestions[active]);
                else if (text.trim()) onAdd(text);
              } else if (event.key === "Backspace" && !text && recipients.length) {
                const buttons = event.currentTarget.closest(`.${styles.recipientBody}`)?.querySelectorAll<HTMLButtonElement>(`.${styles.remove}`);
                buttons?.[buttons.length - 1]?.focus();
              }
            }} />
          <button type="button" className={styles.addButton} disabled={disabled || !text.trim()} aria-label={`Add ${label} recipient`} onClick={() => { onAdd(text); input.current?.focus(); }}><Plus size={18} aria-hidden="true" /></button>
        </div>
        <ul id={`${id}-suggestions`} role="listbox" aria-label={`${label} contact suggestions`} className={styles.suggestions} hidden={!open}>
          {suggestions.map((recipient, index) => <li key={recipient.email} role="presentation"><button type="button" id={`${id}-suggestion-${index}`} role="option" aria-selected={active === index} onMouseDown={(event) => event.preventDefault()} onClick={() => select(recipient)}>
            <strong>{recipient.name || recipient.email}</strong><span>{recipient.email}</span>
          </button></li>)}
        </ul>
      </div>
      <span id={`${id}-hint`} className={styles.hint}>Enter to add. You can also paste a list of addresses.</span>
    </div>
  </div>;
}
