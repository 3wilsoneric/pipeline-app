"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  BriefcaseBusiness,
  CalendarClock,
  CalendarPlus,
  Check,
  GripVertical,
  LibraryBig,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  UserPlus,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  defaultPipelineHomeDashboardLayout,
  isPipelineHomeModuleId,
  pipelineHomeModuleIds,
  type PipelineHomeDashboardLayout,
  type PipelineHomeModuleId,
} from "@/lib/pipeline/home-dashboard-layout";
import {
  loadHomeDashboardLayout,
  saveHomeDashboardLayout,
} from "@/lib/pipeline/home-dashboard-layout-client";

type HomeModuleDefinition = {
  id: PipelineHomeModuleId;
  title: string;
  detail: string;
  icon: LucideIcon;
  wide?: boolean;
};

const homeModuleDefinitions: HomeModuleDefinition[] = [
  {
    id: "current-work",
    title: "Active referrals",
    detail: "Your live intake-to-decision workload and stage counts.",
    icon: BriefcaseBusiness,
    wide: true,
  },
  {
    id: "new-assignments",
    title: "New assignments",
    detail: "Referrals assigned since your last visit.",
    icon: UserPlus,
  },
  {
    id: "upcoming-assessments",
    title: "Upcoming assessments",
    detail: "Scheduled assessments in the next seven days.",
    icon: CalendarClock,
  },
  {
    id: "scheduling-queue",
    title: "Assessments to schedule",
    detail: "Assessment-ready referrals that still need a time.",
    icon: CalendarPlus,
  },
];

const definitionsById = Object.fromEntries(
  homeModuleDefinitions.map((definition) => [definition.id, definition]),
) as Record<PipelineHomeModuleId, HomeModuleDefinition>;

export default function HomeModuleDashboard({
  viewerId,
  modules,
}: {
  viewerId: string;
  modules: Record<PipelineHomeModuleId, ReactNode>;
}) {
  const [layout, setLayout] = useState(defaultPipelineHomeDashboardLayout);
  const [editing, setEditing] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [draggedModuleId, setDraggedModuleId] = useState<PipelineHomeModuleId | null>(null);
  const [saveStatus, setSaveStatus] = useState("");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void loadHomeDashboardLayout(viewerId).then((savedLayout) => {
      if (!cancelled) setLayout({ ...savedLayout, locked: true });
    });
    return () => {
      cancelled = true;
    };
  }, [viewerId]);

  const updateLayout = useCallback((next: PipelineHomeDashboardLayout, message: string) => {
    const durableLayout = { ...next, locked: true } as PipelineHomeDashboardLayout;
    setLayout(durableLayout);
    setSaveStatus(message);
    const revision = ++saveRevision.current;
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(() => saveHomeDashboardLayout(viewerId, durableLayout));
    void saveQueue.current.then(
      () => {
        if (saveRevision.current === revision) setSaveStatus("Layout saved");
      },
      () => {
        if (saveRevision.current === revision) setSaveStatus("Saved on this device; server sync will retry next time");
      },
    );
  }, [viewerId]);

  const reorder = (moduleId: PipelineHomeModuleId, targetIndex: number) => {
    const moduleIds = moveModule(layout.module_ids, moduleId, targetIndex);
    if (moduleIds === layout.module_ids) return;
    updateLayout({ ...layout, module_ids: moduleIds }, `${definitionsById[moduleId].title} moved`);
  };

  const beginEditing = () => {
    setEditing(true);
    setSaveStatus("Home editing started");
  };

  const finishEditing = () => {
    setEditing(false);
    setSaveStatus("Home saved");
    setLibraryOpen(false);
  };

  const beginPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, moduleId: PipelineHomeModuleId) => {
    if (!editing || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggedModuleId(moduleId);
  };

  const movePointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editing || !draggedModuleId) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-home-module]");
    const targetId = target?.dataset.homeModule;
    if (!isPipelineHomeModuleId(targetId) || targetId === draggedModuleId) return;
    reorder(draggedModuleId, layout.module_ids.indexOf(targetId));
  };

  const endPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggedModuleId(null);
  };

  return (
    <section aria-label="Customizable Home" className="mt-2">
      <div className="mb-3 flex min-h-11 items-center justify-end gap-3">
        {editing ? <span className="mr-auto text-[11px] font-bold text-[#65706b]">Arrange Home</span> : null}
        <div className="flex items-center gap-2">
          <span className="sr-only" aria-live="polite">{saveStatus}</span>
          {editing ? (
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              className="flex h-10 items-center gap-2 px-3 text-[11px] font-black text-[#176f60] hover:bg-[#f0f7f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
            >
              <Plus size={16} aria-hidden="true" /> Add module
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={editing}
            onClick={editing ? finishEditing : beginEditing}
            className={`flex h-10 items-center gap-2 px-4 text-[11px] font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${
              editing
                ? "bg-[#0f8b73] text-white hover:bg-[#0b725f]"
                : "text-[#315e52] hover:bg-[#f0f7f4]"
            }`}
          >
            {editing ? <Check size={15} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
            {editing ? "Done" : "Edit Home"}
          </button>
        </div>
      </div>

      {layout.module_ids.length === 0 ? (
        <div className="border border-dashed border-[#b8c9c3] bg-[#f7faf9] px-6 py-14 text-center">
          <LibraryBig size={24} className="mx-auto text-[#4b756a]" aria-hidden="true" />
          <h2 className="mt-3 text-[15px] font-black text-[#202723]">Build your Home</h2>
          <p className="mx-auto mt-1 max-w-md text-[11px] leading-5 text-[#69716c]">Choose modules from the library. Every module connects to the same live Pipeline workflow.</p>
          <button type="button" onClick={() => { beginEditing(); setLibraryOpen(true); }} className="mt-4 h-9 bg-[#0f8b73] px-4 text-[10px] font-black uppercase tracking-[0.06em] text-white">
            Open module library
          </button>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2" data-testid="home-module-grid">
          {layout.module_ids.map((moduleId, index) => {
            const definition = definitionsById[moduleId];
            return (
              <div
                key={moduleId}
                data-home-module={moduleId}
                className={`min-w-0 ${definition.wide ? "xl:col-span-2" : ""} ${
                  draggedModuleId === moduleId ? "scale-[0.99] opacity-55" : ""
                } ${editing ? "border border-dashed border-[#8eb2a7] bg-[#fbfdfc] p-2 transition-[opacity,transform]" : ""}`}
              >
                {editing ? (
                  <div className="mb-1 flex min-h-9 items-center gap-2 border-b border-[#e2e8e5] pb-1">
                    <button
                      type="button"
                      aria-label={`Remove ${definition.title} from Home`}
                      title={`Remove ${definition.title}`}
                      onClick={() => updateLayout({ ...layout, module_ids: layout.module_ids.filter((id) => id !== moduleId) }, `${definition.title} removed`)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#b64d43] text-white hover:bg-[#993b33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9f3f36]"
                    >
                      <Minus size={15} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-black text-[#365c52]">{definition.title}</span>
                    <button
                      type="button"
                      aria-label={`Move ${definition.title}`}
                      title="Drag to rearrange"
                      onPointerDown={(event) => beginPointerDrag(event, moduleId)}
                      onPointerMove={movePointerDrag}
                      onPointerUp={endPointerDrag}
                      onPointerCancel={endPointerDrag}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                          event.preventDefault();
                          reorder(moduleId, index - 1);
                        }
                        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                          event.preventDefault();
                          reorder(moduleId, index + 1);
                        }
                      }}
                      className="flex h-8 w-10 shrink-0 touch-none cursor-grab items-center justify-center text-[#55746b] hover:bg-[#edf5f2] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
                    >
                      <GripVertical size={18} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                {modules[moduleId]}
              </div>
            );
          })}
        </div>
      )}

      {libraryOpen ? (
        <HomeModuleLibrary
          selected={layout.module_ids}
          onAdd={(moduleId) => updateLayout({ ...layout, module_ids: [...layout.module_ids, moduleId] }, `${definitionsById[moduleId].title} added`)}
          onReset={() => updateLayout(defaultPipelineHomeDashboardLayout(), "Default modules restored")}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
    </section>
  );
}

function HomeModuleLibrary({
  selected,
  onAdd,
  onReset,
  onClose,
}: {
  selected: PipelineHomeModuleId[];
  onAdd: (moduleId: PipelineHomeModuleId) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-[#102019]/30 p-0 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside role="dialog" aria-modal="true" aria-label="Home module library" className="max-h-[92dvh] w-full max-w-[680px] overflow-y-auto border border-[#cbd6d2] bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-[#dfe5e2] bg-white px-4">
          <span className="flex h-9 w-9 items-center justify-center bg-[#eaf6f2] text-[#0f7866]"><LibraryBig size={18} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <h2 className="text-[17px] font-black text-[#18211d]">Add modules</h2>
          </span>
          <button type="button" aria-label="Close module library" onClick={onClose} className="flex h-9 w-9 items-center justify-center text-[#58625d] hover:bg-[#f0f4f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"><X size={17} /></button>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {pipelineHomeModuleIds.map((moduleId) => {
            const definition = definitionsById[moduleId];
            const Icon = definition.icon;
            const added = selected.includes(moduleId);
            return (
              <article key={moduleId} className={`flex min-h-28 items-center gap-4 border p-4 ${added ? "border-[#dce4e1] bg-[#f7f9f8]" : "border-[#b8cec7] bg-white"}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-[#edf7f4] text-[#0e7966]"><Icon size={18} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <h3 className="text-[13px] font-black text-[#202723]">{definition.title}</h3>
                  <p className="mt-1 text-[10px] leading-4 text-[#68716c]">{definition.detail}</p>
                </span>
                <button
                  type="button"
                  disabled={added}
                  onClick={() => onAdd(moduleId)}
                  className="flex h-9 shrink-0 items-center gap-1.5 border border-[#97b9ae] px-3 text-[10px] font-black text-[#0c705f] hover:bg-[#edf7f4] disabled:border-[#d7ddda] disabled:bg-white disabled:text-[#8a918d]"
                >
                  {added ? "Added" : <><Plus size={12} aria-hidden="true" /> Add</>}
                </button>
              </article>
            );
          })}
        </div>
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[#dfe5e2] bg-white px-4 py-3">
          <button type="button" onClick={onReset} className="flex h-9 items-center gap-2 px-2 text-[10px] font-black uppercase tracking-[0.06em] text-[#5c6762] hover:bg-[#f3f6f5]"><RotateCcw size={13} aria-hidden="true" /> Restore defaults</button>
          <button type="button" onClick={onClose} className="h-10 bg-[#17211d] px-5 text-[11px] font-black text-white">Done</button>
        </div>
      </aside>
    </div>
  );
}

function moveModule(moduleIds: PipelineHomeModuleId[], moduleId: PipelineHomeModuleId, targetIndex: number) {
  const currentIndex = moduleIds.indexOf(moduleId);
  const boundedTarget = Math.min(moduleIds.length - 1, Math.max(0, targetIndex));
  if (currentIndex < 0 || currentIndex === boundedTarget) return moduleIds;
  const next = moduleIds.filter((id) => id !== moduleId);
  next.splice(boundedTarget, 0, moduleId);
  return next;
}
