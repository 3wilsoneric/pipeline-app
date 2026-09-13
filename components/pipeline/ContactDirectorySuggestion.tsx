"use client";

import { useEffect, useId, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { contactDisplayName, type ContactRecord } from "@/lib/pipeline/contact-types";

export default function ContactDirectorySuggestion({ label, value, placeholder, kind, maxLength, referralId, onChange }: {
  label: string;
  value: string;
  placeholder?: string;
  kind: "organization" | "person";
  maxLength: number;
  referralId?: number;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [matches, setMatches] = useState<ContactRecord[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState("");
  const open = focused && !dismissed && matches.length > 0;

  useEffect(() => {
    if (!focused || dismissed || value.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: value.trim().slice(0, 160), limit: "12" });
      if (referralId) params.set("referral_id", String(referralId));
      setStatus("Searching directory...");
      void fetchPipelineJson<{ contacts: ContactRecord[] }>(`/api/contacts?${params}`, { cache: "no-store", signal: controller.signal })
        .then(({ contacts }) => {
          if (controller.signal.aborted) return;
          const seen = new Set<string>();
          const results = contacts.filter((contact) => {
            const suggestion = directoryValue(contact, kind).trim().toLowerCase();
            if (!suggestion || directoryValue(contact, kind).length > maxLength || seen.has(suggestion)) return false;
            seen.add(suggestion);
            return true;
          });
          setMatches(results);
          setStatus(results.length ? `${results.length} directory suggestions` : "No directory matches. Your entry will be kept.");
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus("Directory unavailable. You can still enter a value.");
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [dismissed, focused, kind, maxLength, referralId, value]);

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id, open]);

  const select = (contact: ContactRecord) => {
    onChange(directoryValue(contact, kind));
    setDismissed(true);
    setMatches([]);
    setActive(-1);
    setStatus("Directory value selected.");
  };

  return (
    <div className="min-w-0">
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        className="mt-1.5 h-9 w-full min-w-0 border-0 bg-transparent p-0 text-[16px] font-bold text-[#18211d] outline-none placeholder:text-[#a0a0a0] sm:text-[14px]"
        onFocus={() => { setFocused(true); setDismissed(false); }}
        onBlur={() => { setFocused(false); setMatches([]); setActive(-1); }}
        onChange={(event) => {
          setMatches([]);
          setActive(-1);
          setStatus("");
          setDismissed(false);
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDismissed(true);
          } else if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
          } else if (open && event.key === "Enter" && active >= 0) {
            event.preventDefault();
            select(matches[active]);
          }
        }}
      />
      {open ? (
        <ul id={id} role="listbox" aria-label={`${label} suggestions`} className="pipeline-dropdown-suggestions mt-2 max-h-48 overflow-y-auto">
          {matches.map((contact, index) => (
            <li
              key={contact.id}
              id={`${id}-${index}`}
              role="option"
              aria-selected={active === index}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => select(contact)}
              className="cursor-pointer break-words text-[12px]"
            >
              <div className="font-bold text-[#18211d]">{directoryValue(contact, kind)}</div>
              <div className="mt-0.5 text-[11px] text-[#666b68]">{kind === "organization" ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") : contact.organization}</div>
            </li>
          ))}
        </ul>
      ) : null}
      <span role="status" className={directoryStatusClass(focused, status)}>{focused ? status : ""}</span>
    </div>
  );
}

function directoryValue(contact: ContactRecord, kind: "organization" | "person") {
  return kind === "organization" ? contact.organization || contactDisplayName(contact) : contactDisplayName(contact);
}

function directoryStatusClass(focused: boolean, status: string) {
  return focused && (status.startsWith("No directory") || status.startsWith("Directory unavailable")) ? "mt-1 block text-[11px] text-[#666b68]" : "sr-only";
}
