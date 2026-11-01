"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, GripVertical, Heading2, List } from "lucide-react";
import { unifiedNoteMaxLength } from "@/lib/pipeline/client-notes";
import styles from "./ClientNotes.module.css";

type Paragraph = { key: number; text: string };
type Document = { value: string; paragraphs: Paragraph[]; separators: string[]; nextKey: number };

// Readable plain-text notation stays compatible with the shared note, recovery,
// history and older clients. Merely opening a note never rewrites its contents.
// Writing prompts inferred from actual notes, independent of legacy storage keys
// and the assessment questionnaire. They insert a heading, never a finding.
const sectionHeadings = [
  "Client report", "Observations", "Staff / case manager report", "History & timeline",
  "Medication follow-up", "Records to clarify", "Placement preferences", "Follow-up questions",
];
const commands: { kind: "heading" | "bullet"; label: string; search: string; prefix: string; icon: typeof Heading2; preset?: boolean }[] = [
  { kind: "bullet", label: "Bullet points", search: "bullet points list", prefix: "- ", icon: List },
  ...sectionHeadings.map((label) => ({ kind: "heading" as const, label, search: label.toLowerCase(), prefix: `## ${label}`, icon: Heading2, preset: true })),
  { kind: "heading", label: "Heading", search: "section title heading", prefix: "## ", icon: Heading2 },
];
function block(text: string) {
  const match = /^(## |\- (?!\[[ xX]\] ))/.exec(text);
  const prefix = match?.[0] ?? "";
  const kind = prefix === "## " ? "heading" : prefix === "- " ? "bullet" : "text";
  return { prefix, kind, text: text.slice(prefix.length) };
}

// Presentation only: blank lines separate paragraphs. Preserve every character,
// including uneven blank lines, single line breaks and leading/trailing spaces.
function read(value: string): Document {
  const parts = value.split(/(\n{2,})/);
  const paragraphs = parts.filter((_, index) => index % 2 === 0).map((text, key) => ({ key, text }));
  return { value, paragraphs, separators: parts.filter((_, index) => index % 2 === 1), nextKey: paragraphs.length };
}
function write(document: Document) {
  return document.paragraphs.map((paragraph, index) => paragraph.text + (document.separators[index] ?? "")).join("");
}

export default function ClientNoteEditor({ id, value, disabled, onChange, onBlur }: {
  id: string; value: string; disabled: boolean;
  onChange: (value: string) => void; onBlur: () => void;
}) {
  const [document, setDocument] = useState(() => read(value));
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [slash, setSlash] = useState<{ key: number; query: string; selected: number } | null>(null);
  const fields = useRef(new Map<number, HTMLTextAreaElement>());
  const menus = useRef(new Map<number, HTMLDetailsElement>());
  const page = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const focus = useRef<{ key: number; offset: number } | null>(null);
  // External updates/conflict resolution replace the rendered document. Local
  // typing keeps stable paragraph identities, cursor positions and native inputs.
  if (document.value !== value) { setDocument(read(value)); if (slash) setSlash(null); }

  const commit = (next: Document) => {
    if (disabled) return;
    next.value = write(next);
    if (next.value.length > unifiedNoteMaxLength) return;
    setDocument(next);
    if (next.value !== document.value) onChange(next.value);
  };
  const update = (key: number, text: string) => commit({ ...document, paragraphs: document.paragraphs.map((paragraph) => paragraph.key === key ? { ...paragraph, text } : paragraph) });
  const choices = slash ? commands.filter((command) => command.search.includes(slash.query.toLowerCase())) : [];
  const choose = (command: typeof commands[number]) => {
    if (!slash || disabled) return;
    const key = slash.key;
    const paragraph = document.paragraphs.find((item) => item.key === key);
    if (!paragraph || block(paragraph.text).text !== `/${slash.query}`) { setSlash(null); return; }
    if (document.value.length - paragraph.text.length + command.prefix.length + (command.preset ? 2 : 0) > unifiedNoteMaxLength) return;
    if (command.preset) {
      const index = document.paragraphs.indexOf(paragraph);
      const paragraphs = [...document.paragraphs];
      const separators = [...document.separators];
      paragraphs.splice(index, 1, { ...paragraph, text: command.prefix }, { key: document.nextKey, text: "" });
      separators.splice(index, 0, "\n\n");
      focus.current = { key: document.nextKey, offset: 0 };
      commit({ ...document, paragraphs, separators, nextKey: document.nextKey + 1 });
    } else {
      focus.current = { key, offset: 0 };
      update(key, command.prefix);
    }
    setSlash(null);
  };
  const splitPastedParagraph = (key: number) => {
    const index = document.paragraphs.findIndex((paragraph) => paragraph.key === key);
    if (index < 0) return;
    const parts = read(document.paragraphs[index].text);
    if (parts.paragraphs.length < 2) return;
    let nextKey = document.nextKey;
    const paragraphs = [...document.paragraphs];
    paragraphs.splice(index, 1, ...parts.paragraphs.map((paragraph, offset) => ({ ...paragraph, key: offset === 0 ? key : nextKey++ })));
    const separators = [...document.separators];
    separators.splice(index, 0, ...parts.separators);
    commit({ ...document, paragraphs, separators, nextKey });
  };
  const move = (key: number, to: number) => {
    const from = document.paragraphs.findIndex((paragraph) => paragraph.key === key);
    if (disabled || from < 0 || to < 0 || to >= document.paragraphs.length || to === from) return;
    const paragraphs = [...document.paragraphs];
    const [paragraph] = paragraphs.splice(from, 1);
    paragraphs.splice(to, 0, paragraph);
    commit({ ...document, paragraphs });
    setAnnouncement(`Paragraph ${to + 1} of ${paragraphs.length}`);
    const menu = menus.current.get(key);
    if (menu) menu.open = false;
    requestAnimationFrame(() => menus.current.get(key)?.querySelector("summary")?.focus());
  };

  const order = document.paragraphs.map((paragraph) => paragraph.key).join(",");
  useLayoutEffect(() => {
    const host = page.current;
    if (!host) return;
    const next = new Map<string, number>();
    for (const row of host.querySelectorAll<HTMLElement>("[data-note-paragraph]")) {
      const key = row.dataset.noteParagraph!;
      const top = row.offsetTop;
      const previous = positions.current.get(key);
      next.set(key, top);
      if (previous === undefined || previous === top || window.matchMedia("(prefers-reduced-motion: reduce)").matches) continue;
      row.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "none" }], {
        duration: Number.parseFloat(getComputedStyle(host).getPropertyValue("--duration-move")),
        easing: getComputedStyle(host).getPropertyValue("--ease-open").trim(),
      });
    }
    positions.current = next;
  }, [order]);
  useLayoutEffect(() => {
    if (focus.current) {
      const field = fields.current.get(focus.current.key);
      field?.focus();
      field?.setSelectionRange(focus.current.offset, focus.current.offset);
      focus.current = null;
    }
  }, [order, document.value]);

  return <div ref={page} className={styles.paragraphs} data-note-editor
    onBlur={(event) => {
      const target = event.relatedTarget;
      if (target instanceof Element && (target.closest("[data-client-notes]") === page.current?.closest("[data-client-notes]") || target.closest("[data-note-commands]")?.id === `${id}-commands`)) return;
      onBlur();
    }}
    onPointerDown={(event) => {
      if (disabled || event.button !== 0 || event.target !== event.currentTarget) return;
      const last = document.paragraphs.at(-1);
      const field = last ? fields.current.get(last.key) : undefined;
      event.preventDefault();
      field?.focus({ preventScroll: true });
      field?.setSelectionRange(field.value.length, field.value.length);
    }}>
    {document.paragraphs.map((paragraph, index) => {
      const current = block(paragraph.text);
      return <div key={paragraph.key} className={styles.paragraph} data-note-paragraph={paragraph.key} data-block-kind={current.kind}
      data-dragging={dragging === paragraph.key || undefined}
      data-drop={over === paragraph.key && dragging !== paragraph.key ? (document.paragraphs.findIndex((item) => item.key === dragging) < index ? "after" : "before") : undefined}
      onDragOver={(event) => { if (!disabled && dragging !== null) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(paragraph.key); } }}
      onDrop={(event) => { if (!disabled && dragging !== null) { event.preventDefault(); move(dragging, index); setDragging(null); setOver(null); } }}>
      {!disabled && document.paragraphs.length > 1 ? <details ref={(element) => { if (element) menus.current.set(paragraph.key, element); else menus.current.delete(paragraph.key); }} className={styles.paragraphMenu}
        onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary aria-label={`Move paragraph ${index + 1}`} title="Drag paragraph · arrow keys to reorder" draggable={document.paragraphs.length > 1}
          onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); move(paragraph.key, index + (event.key === "ArrowUp" ? -1 : 1)); } }}
          onDragStart={(event) => { event.dataTransfer.setData("text/plain", String(paragraph.key)); event.dataTransfer.effectAllowed = "move"; setDragging(paragraph.key); }}
          onDragEnd={() => { setDragging(null); setOver(null); }}><GripVertical size={16} aria-hidden="true" /></summary>
        <div className={styles.paragraphOptions}>
          <button type="button" disabled={index === 0} onClick={() => move(paragraph.key, index - 1)}><ArrowUp size={16} aria-hidden="true" />Move up</button>
          <button type="button" disabled={index === document.paragraphs.length - 1} onClick={() => move(paragraph.key, index + 1)}><ArrowDown size={16} aria-hidden="true" />Move down</button>
        </div>
      </details> : null}
      <div className={styles.blockContent}>
      {current.kind === "bullet" ? <span className={styles.marker} aria-hidden="true">•</span> : null}
      <ParagraphField id={`${id}-${paragraph.key}`} label={index === 0 ? "Notes" : `Notes paragraph ${index + 1}`} value={current.text} disabled={disabled}
        activeOption={slash?.key === paragraph.key && choices.length ? `${id}-command-${Math.min(slash.selected, choices.length - 1)}` : undefined}
        menuId={slash?.key === paragraph.key && choices.length ? `${id}-commands` : undefined}
        maxLength={unifiedNoteMaxLength - (document.value.length - current.text.length)}
        fieldRef={(element) => { if (element) fields.current.set(paragraph.key, element); else fields.current.delete(paragraph.key); }}
        onChange={(text) => {
          update(paragraph.key, current.prefix + text);
          setSlash(/^\/[a-z ]{0,30}$/i.test(text) ? { key: paragraph.key, query: text.slice(1), selected: 0 } : null);
        }} onBlur={(event) => {
          if (!(event.relatedTarget instanceof Element) || event.relatedTarget.closest("[data-note-commands]")?.id !== `${id}-commands`) setSlash(null);
          splitPastedParagraph(paragraph.key);
        }}
        onKeyDown={(event) => {
          if (disabled || event.nativeEvent.isComposing) return;
          if (slash?.key === paragraph.key) {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setSlash(null); return; }
            if (choices.length && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              event.preventDefault();
              setSlash({ ...slash, selected: (slash.selected + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length }); return;
            }
            if (choices.length && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); choose(choices[slash.selected % choices.length]); return; }
          }
          const field = event.currentTarget;
          const { selectionStart: start, selectionEnd: end } = field;
          const paragraphs = [...document.paragraphs];
          const separators = [...document.separators];
          if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            setSlash(null);
            if (current.prefix && !current.text) { update(paragraph.key, ""); return; }
            const prefix = current.kind === "heading" ? "" : current.prefix;
            if (document.value.length - (end - start) + 2 + prefix.length > unifiedNoteMaxLength) return;
            paragraphs.splice(index, 1, { ...paragraph, text: current.prefix + current.text.slice(0, start) }, { key: document.nextKey, text: prefix + current.text.slice(end) });
            separators.splice(index, 0, "\n\n");
            focus.current = { key: document.nextKey, offset: 0 };
            commit({ ...document, paragraphs, separators, nextKey: document.nextKey + 1 });
          } else if (event.key === "Backspace" && start === 0 && end === 0 && current.prefix) {
            event.preventDefault(); update(paragraph.key, current.text);
          } else if (event.key === "Backspace" && start === 0 && end === 0 && index > 0) {
            event.preventDefault();
            const previous = paragraphs[index - 1];
            focus.current = { key: previous.key, offset: block(previous.text).text.length };
            paragraphs.splice(index - 1, 2, { ...previous, text: previous.text + paragraph.text });
            separators.splice(index - 1, 1);
            commit({ ...document, paragraphs, separators });
          }
        }} />
      </div>
    </div>; })}
    {slash && choices.length ? <BlockMenu id={`${id}-commands`} optionPrefix={`${id}-command`} anchor={fields.current.get(slash.key)} choices={choices} selected={slash.selected} choose={choose}
      select={(selected) => setSlash({ ...slash, selected })} dismiss={() => setSlash(null)} /> : null}
    <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
  </div>;
}

function ParagraphField({ fieldRef, ...props }: {
  id: string; label: string; value: string; disabled: boolean; maxLength: number;
  activeOption?: string; menuId?: string;
  fieldRef: (element: HTMLTextAreaElement | null) => void;
  onChange: (value: string) => void; onBlur: (event: React.FocusEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [props.value]);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === element.clientWidth) return;
      width = element.clientWidth;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <textarea ref={(element) => { field.current = element; fieldRef(element); }} id={props.id} aria-label={props.label} value={props.value}
    aria-haspopup="listbox" aria-controls={props.menuId} aria-activedescendant={props.activeOption}
    disabled={props.disabled} maxLength={props.maxLength} placeholder="Type notes" spellCheck className={styles.field} rows={1}
    onChange={(event) => props.onChange(event.target.value)} onBlur={props.onBlur} onKeyDown={props.onKeyDown} />;
}

function BlockMenu({ id, optionPrefix, anchor, choices, selected, choose, select, dismiss }: {
  id: string; optionPrefix: string; anchor?: HTMLTextAreaElement;
  choices: readonly typeof commands[number][]; selected: number; choose: (command: typeof commands[number]) => void;
  select: (index: number) => void; dismiss: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor || !menu.current) return;
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      menu.current.style.maxHeight = `${Math.min(320, bottom - top - 16)}px`;
      const height = menu.current.offsetHeight;
      menu.current.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.current.offsetWidth - 8))}px`;
      menu.current.style.top = `${Math.max(top + 8, rect.bottom + height + 8 <= bottom ? rect.bottom + 4 : Math.min(rect.top - height - 4, bottom - height - 8))}px`;
    };
    place();
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place); };
  }, [anchor, choices.length]);
  useLayoutEffect(() => { menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [selected]);
  return createPortal(<div ref={menu} id={id} className={styles.commands} data-note-commands role="listbox" aria-label="Note blocks" tabIndex={0} aria-activedescendant={`${optionPrefix}-${selected}`}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchor) dismiss(); }}
    onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); select((selected + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length); }
      else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(choices[selected]); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); anchor?.focus(); }
    }} onPointerDown={(event) => event.preventDefault()}>
    {choices.map((command, index) => <button key={command.label} id={`${optionPrefix}-${index}`} type="button" role="option" aria-selected={index === selected} tabIndex={-1}
      onClick={() => choose(command)}><command.icon size={18} aria-hidden="true" />{command.label}</button>)}
  </div>, window.document.body);
}
