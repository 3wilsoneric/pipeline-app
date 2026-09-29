"use client";

import { useState } from "react";

export function AssessmentHistoryTimeline({ id, label, value, disabled, onChange }: {
  id: string;
  label: string;
  value: readonly string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const source = value.join("\n");
  const [editing, setEditing] = useState({ source, rows: [...value] });
  const rows = editing.source === source ? editing.rows : [...value];

  const update = (next: string[]) => {
    const saved = next.map((item) => item.trim()).filter(Boolean);
    setEditing({ source: saved.join("\n"), rows: next });
    onChange(saved);
  };

  return <div id={id} role="group" aria-label={label} className="space-y-2">
    {rows.length ? rows.map((row, index) => <div key={index} className="flex items-start gap-2">
      <label htmlFor={`${id}-${index}`} className="sr-only">{label} event {index + 1}</label>
      <input id={`${id}-${index}`} type="text" value={row} maxLength={2000} disabled={disabled}
        onChange={(event) => update(rows.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
        placeholder="Approximate date — what happened — outcome"
        className="min-h-11 min-w-0 flex-1 rounded-input border border-line bg-white px-3 py-2 text-value text-ink outline-none placeholder:text-ink-muted focus:border-focus disabled:bg-surface" />
      <button type="button" disabled={disabled} onClick={() => update(rows.filter((_, itemIndex) => itemIndex !== index))}
        aria-label={`Remove ${label.toLowerCase()} event ${index + 1}`}
        className="min-h-11 rounded-input border border-line px-3 text-label text-ink-muted hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50">Remove</button>
    </div>) : <p className="text-meta text-ink-muted">No events added. A timeline is optional.</p>}
    {!disabled && rows.length < 200 ? <button type="button" onClick={() => setEditing({ source, rows: [...rows, ""] })}
      className="min-h-10 rounded-input border border-line bg-paper px-3 text-label font-semibold text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus">+ Add event</button> : null}
  </div>;
}
