"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { meetClientIdentityRows, meetClientSections, meetClientSourceSections, meetClientSectionText, meetClientSectionConflicts } from "@/lib/notifications/meet-client-email-template";
import { meetClientBodyLimit, meetClientSectionOrder, type MeetClientMessage, type MeetClientSectionId, type MeetClientSectionEdits } from "@/lib/notifications/meet-client-message";
import styles from "./MeetClientSections.module.css";
import PipelineIllustration, { type PipelineIllustrationKind } from "./PipelineIllustration";

const sectionPictures: Record<MeetClientSectionId, PipelineIllustrationKind> = {
  coordination: "calendar", bio: "client", medications: "medication", safety: "safety",
  diet: "diet", billing: "report", support: "connections", message: "conversation",
};

export default function MeetClientSections({ summary, message, editable, onOrderChange, onSectionChange, onBlur }: {
  summary: MeetClientSummary; message: MeetClientMessage; editable: boolean;
  onOrderChange: (order: MeetClientSectionId[]) => void;
  onSectionChange?: (edits: MeetClientSectionEdits) => void;
  onBlur?: () => void;
}) {
  const sections = meetClientSections(summary, message);
  const sources = meetClientSourceSections(summary, message);
  const conflicts = meetClientSectionConflicts(summary, message);
  const [editing, setEditing] = useState<MeetClientSectionId | null>(null);
  const changeSection = (id: MeetClientSectionId, text: string) => {
    const source = sources.find(section => section.id === id);
    if (!source || !onSectionChange) return;
    onSectionChange({ ...message.sectionEdits, [id]: { text, source: message.sectionEdits?.[id]?.source ?? meetClientSectionText(source) } });
  };
  const resetSection = (id: MeetClientSectionId) => {
    const edits = { ...message.sectionEdits }; delete edits[id]; onSectionChange?.(edits);
  };
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
    onOrderChange(order);
    const visible = order.filter((key) => sections.some((section) => section.id === key));
    setAnnouncement(`${visible.indexOf(id) + 1} / ${visible.length} · ${sections.find((section) => section.id === id)?.title}`);
    const handle = handles.current.get(id);
    if (handle?.parentElement instanceof HTMLDetailsElement) handle.parentElement.open = false;
    requestAnimationFrame(() => handles.current.get(id)?.focus());
  };
  return <div className={styles.document}>
    <h2 className={styles.title}>Meet the Client</h2>
    <dl className={styles.identity}>{meetClientIdentityRows(summary).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div ref={blocks} className={styles.blocks}>
      {sections.map((section, index) => <section key={section.id} data-message-section={section.id} className={styles.block}
        data-dragging={dragging === section.id || undefined}
        data-drop={over === section.id && dragging !== section.id ? (sections.findIndex((item) => item.id === dragging) < index ? "after" : "before") : undefined}
        onDragOver={(event) => { if (editable && dragging) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(section.id); } }}
        onDrop={(event) => { if (editable && dragging) { event.preventDefault(); move(dragging, section.id); setDragging(null); setOver(null); } }}>
        {editable && sections.length > 1 ? <details className={styles.moveMenu}
          onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; handles.current.get(section.id)?.focus(); } }}>
          <summary aria-label={`Move ${section.title}`} title={`Move ${section.title}`} draggable
            ref={(element) => { if (element) handles.current.set(section.id, element); else handles.current.delete(section.id); }}
            onDragStart={(event) => { event.dataTransfer.setData("text/plain", section.id); event.dataTransfer.effectAllowed = "move"; setDragging(section.id); }}
            onDragEnd={() => { setDragging(null); setOver(null); }}><GripVertical size={22} aria-hidden="true" /></summary>
          <div className={styles.moveOptions}>
            <button type="button" disabled={index === 0} onClick={() => move(section.id, sections[index - 1].id)}><ArrowUp size={18} aria-hidden="true" />Move up</button>
            <button type="button" disabled={index === sections.length - 1} onClick={() => move(section.id, sections[index + 1].id)}><ArrowDown size={18} aria-hidden="true" />Move down</button>
          </div>
        </details> : null}
        {section.id === "bio" && index === 0 ? null : <h3><PipelineIllustration kind={sectionPictures[section.id]} size={40} /><span>{section.title}</span></h3>}
        {conflicts.includes(section.id) ? <div className={styles.sourceChange} role="status">
          <strong>Chart updated</strong>
          <details><summary>Compare with the chart</summary><p>{sources.find(item => item.id === section.id) ? meetClientSectionText(sources.find(item => item.id === section.id)!) : "This section is no longer in the chart."}</p></details>
          {editable && onSectionChange ? <div className={styles.editActions}>
            {sources.some(item => item.id === section.id) ? <button type="button" onClick={() => onSectionChange({ ...message.sectionEdits, [section.id]: { ...message.sectionEdits![section.id]!, source: meetClientSectionText(sources.find(item => item.id === section.id)!) } })}>Keep my edit</button> : null}
            <button type="button" onClick={() => resetSection(section.id)}>Use chart text</button>
          </div> : null}
        </div> : null}
        {editing === section.id && editable && onSectionChange ? <label className={styles.sectionEditor}>
          <span className={styles.srOnly}>{section.title}</span>
          <textarea autoFocus aria-label={`Edit ${section.title}`} value={message.sectionEdits?.[section.id]?.text ?? meetClientSectionText(section)} maxLength={meetClientBodyLimit} rows={8}
            onChange={event => changeSection(section.id, event.target.value)} onBlur={onBlur} />
        </label> : section.kind === "items" ? <dl className={styles.facts}>{section.items.map((item, i) => <div key={`${item.label}:${i}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          : section.kind === "list" ? <ul>{section.values.map((value, i) => <li key={i}>{value}</li>)}</ul>
          : <p className={styles.message}>{section.text}</p>}
        {editable && onSectionChange && message.body == null ? <div className={styles.editActions}>
          <button type="button" aria-label={`${editing === section.id ? "Done editing" : "Edit"} ${section.title}`} onClick={() => { onBlur?.(); setEditing(editing === section.id ? null : section.id); }}>{editing === section.id ? "Done" : "Edit"}</button>
          {message.sectionEdits?.[section.id] && !conflicts.includes(section.id) ? <button type="button" onClick={() => resetSection(section.id)}>Use chart text</button> : null}
        </div> : null}
      </section>)}
    </div>
    <p className={styles.srOnly} role="status" aria-live="polite">{announcement}</p>
  </div>;
}
