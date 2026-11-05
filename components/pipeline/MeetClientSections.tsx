"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { meetClientIdentityRows, meetClientSections, meetClientSectionText } from "@/lib/notifications/meet-client-email-template";
import { meetClientBodyLimit, meetClientSectionOrder, type MeetClientMessage, type MeetClientSectionId, type MeetClientSectionFormat } from "@/lib/notifications/meet-client-message";
import styles from "./MeetClientSections.module.css";
import PipelineIllustration, { type PipelineIllustrationKind } from "./PipelineIllustration";

const sectionPictures: Record<MeetClientSectionId, PipelineIllustrationKind> = {
  coordination: "calendar", bio: "client", medications: "medication", safety: "safety",
  diet: "diet", billing: "report", support: "connections", message: "conversation",
};

export default function MeetClientSections({ summary, message, editable, onOrderChange, editing = false, onTextChange, onFormatChange, activeSection }: {
  summary: MeetClientSummary; message: MeetClientMessage; editable: boolean;
  onOrderChange: (order: MeetClientSectionId[], moved?: MeetClientSectionId) => void;
  activeSection?: MeetClientSectionId | "subject";
  editing?: boolean;
  onTextChange?: (id: MeetClientSectionId, text: string | undefined) => void;
  onFormatChange?: (id: MeetClientSectionId, format: MeetClientSectionFormat) => void;
}) {
  const sections = meetClientSections(summary, message);
  const original = meetClientSections(summary, { ...message, sectionFormats: undefined, sectionText: undefined });
  const [dragging, setDragging] = useState<MeetClientSectionId | null>(null);
  const [over, setOver] = useState<MeetClientSectionId | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const handles = useRef(new Map<MeetClientSectionId, HTMLElement>());
  const blocks = useRef<HTMLDivElement>(null);
  const previousPositions = useRef(new Map<string, number>());
  const sectionOrder = sections.map((section) => section.id).join("|");
  // Carelog's reorder motion: the saved order takes effect immediately; only its visual position animates.
  useLayoutEffect(() => {
    const host = blocks.current;
    if (!host) return;
    const next = new Map<string, number>();
    for (const block of host.querySelectorAll<HTMLElement>("[data-message-section]")) {
      const key = block.dataset.messageSection!;
      const top = block.offsetTop;
      const previous = previousPositions.current.get(key);
      next.set(key, top);
      if (previous === undefined || Math.abs(previous - top) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) continue;
      block.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "none" }], {
        duration: Number.parseFloat(getComputedStyle(host).getPropertyValue("--duration-move")),
        easing: getComputedStyle(host).getPropertyValue("--ease-open").trim(),
      });
    }
    previousPositions.current = next;
  }, [sectionOrder]);
  const move = (id: MeetClientSectionId, target: MeetClientSectionId) => {
    if (!editable || id === target) return;
    const order = [...meetClientSectionOrder(message)];
    const from = order.indexOf(id), to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    if (blocks.current) {
      const origin = blocks.current.getBoundingClientRect().top;
      for (const block of blocks.current.querySelectorAll<HTMLElement>("[data-message-section]")) {
        previousPositions.current.set(block.dataset.messageSection!, block.getBoundingClientRect().top - origin);
        block.getAnimations().forEach((animation) => animation.cancel());
      }
    }
    order.splice(from, 1); order.splice(to, 0, id);
    onOrderChange(order, id);
    const visible = order.filter((key) => sections.some((section) => section.id === key));
    setAnnouncement(`${visible.indexOf(id) + 1} / ${visible.length} · ${sections.find((section) => section.id === id)?.title}`);
    const handle = handles.current.get(id);
    if (handle?.parentElement instanceof HTMLDetailsElement) handle.parentElement.open = false;
    requestAnimationFrame(() => handles.current.get(id)?.focus());
  };
  return <div className={`${styles.document} ${editing ? styles.editing : ""}`}>
    <h2 className={styles.title}>Meet the Client</h2>
    <dl className={styles.identity}>{meetClientIdentityRows(summary).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div ref={blocks} className={styles.blocks}>
      {sections.map((section, index) => <section key={section.id} data-message-section={section.id} className={styles.block}
        data-active={activeSection === section.id || undefined}
        data-dragging={dragging === section.id || undefined}
        data-drop={over === section.id && dragging !== section.id ? (sections.findIndex((item) => item.id === dragging) < index ? "after" : "before") : undefined}
        onDragOver={(event) => { if (editable && dragging) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(section.id); } }}
        onDrop={(event) => { if (editable && dragging) { event.preventDefault(); move(dragging, section.id); setDragging(null); setOver(null); } }}>
        {editable && sections.length > 1 ? <details className={styles.moveMenu}
          onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; handles.current.get(section.id)?.focus(); } }}>
          <summary aria-label={`Move ${section.title}`} title={`Move ${section.title}`} draggable
            ref={(element) => { if (element) handles.current.set(section.id, element); else handles.current.delete(section.id); }}
            onDragStart={(event) => { event.dataTransfer.setData("text/plain", section.id); event.dataTransfer.effectAllowed = "move"; setDragging(section.id); }}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            onKeyDown={(event) => { if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); const target = sections[index + (event.key === "ArrowUp" ? -1 : 1)]; if (target) move(section.id, target.id); } }}><GripVertical size={22} aria-hidden="true" /></summary>
          <div className={styles.moveOptions}>
            <button type="button" disabled={index === 0} onClick={() => move(section.id, sections[index - 1].id)}><ArrowUp size={18} aria-hidden="true" />Move up</button>
            <button type="button" disabled={index === sections.length - 1} onClick={() => move(section.id, sections[index + 1].id)}><ArrowDown size={18} aria-hidden="true" />Move down</button>
            {editing && message.sectionText?.[section.id] !== undefined && section.id !== "message" ? <button type="button" className={styles.sectionAction} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); onTextChange?.(section.id, undefined); }}>Use assessment text</button> : null}
            {editing && section.id === "message" && message.body == null ? <button type="button" className={styles.sectionAction} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); onTextChange?.("message", undefined); }}>Remove note</button> : null}
          </div>
        </details> : null}
        <div className={styles.sectionHeader}>
        {!editing && section.id === "bio" && index === 0 ? null : <h3><PipelineIllustration kind={sectionPictures[section.id]} size={40} /><span>{section.title}</span></h3>}
        {editing ? <div className={styles.editTools}>
            <label>Format <select aria-label={`Format ${section.title}`} disabled={!editable} value={message.sectionFormats?.[section.id] ?? "default"}
              onChange={(event) => onFormatChange?.(section.id, event.target.value as MeetClientSectionFormat)}>
              <option value="default">Default</option><option value="paragraphs">Paragraphs</option><option value="bullets">Bulleted list</option>
            </select></label>
          </div> : null}
        </div>
        {editing ? <SectionField className={styles.sectionEditor} aria-label={`Edit ${section.title}`} readOnly={!editable} spellCheck lang="en-US" autoCorrect="off" autoCapitalize="off"
            data-editor-field={section.id}
            maxLength={meetClientBodyLimit} value={message.sectionText?.[section.id] ?? meetClientSectionText(original.find(item => item.id === section.id) ?? section)}
            onChange={(event) => onTextChange?.(section.id, event.target.value)} />
        : section.kind === "items" ? <dl className={styles.facts}>{section.items.map((item, i) => <div key={`${item.label}:${i}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          : section.kind === "list" ? <ul>{section.values.map((value, i) => <li key={i}>{value}</li>)}</ul>
          : <p className={styles.message}>{section.text}</p>}
      </section>)}
    </div>
    <p className={styles.srOnly} role="status" aria-live="polite">{announcement}</p>
  </div>;
}


function SectionField(props: React.ComponentProps<"textarea">) {
  const field = useRef<HTMLTextAreaElement>(null);
  // Match the existing ClientNoteEditor sizing pattern. A single document scrolls;
  // text never disappears behind a second scrollbar inside a clinical section.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element || !element.clientWidth) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [props.value]);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === element.clientWidth) return;
      width = element.clientWidth;
      if (!width) return;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight + 2}px`;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <textarea {...props} ref={field} rows={2} />;
}
