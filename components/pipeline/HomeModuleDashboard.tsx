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
  Plus,
  RotateCcw,
  Search,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import HomeDialog from "@/components/pipeline/HomeDialog";

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
    id: "search",
    title: "Search",
    detail: "Find a client, workspace, or document.",
    icon: Search,
    wide: true,
  },
  {
    id: "recent-work",
    title: "Recent work",
    detail: "Pick up where you left off, including unfinished intake.",
    icon: RotateCcw,
    wide: true,
  },
  {
    id: "current-work",
    title: "My work",
    detail: "Assigned referrals that require your next action.",
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
  initialEditing = false,
  onFinishEditing,
  onSearchVisibilityChange,
}: {
  viewerId: string;
  modules: Record<PipelineHomeModuleId, ReactNode>;
  initialEditing?: boolean;
  onFinishEditing?: () => void;
  onSearchVisibilityChange: (visible: boolean) => void;
}) {
  const [layout, setLayout] = useState(defaultPipelineHomeDashboardLayout);
  const [layoutReady, setLayoutReady] = useState(false);
  const [editing, setEditing] = useState(initialEditing);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [draggedModuleId, setDraggedModuleId] = useState<PipelineHomeModuleId | null>(null);
  const [saveStatus, setSaveStatus] = useState("");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void loadHomeDashboardLayout(viewerId).then((savedLayout) => {
      if (cancelled) return;
      setLayout({ ...savedLayout, locked: true });
      setLayoutReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [viewerId]);

  const searchVisible = layout.module_ids.includes("search");
  useEffect(() => onSearchVisibilityChange(searchVisible), [searchVisible, onSearchVisibilityChange]);

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
        if (saveRevision.current === revision) setSaveStatus("Home could not sync. Make another layout change to retry.");
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
    setLibraryOpen(false);
    onFinishEditing?.();
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
      {editing ? (
        <div className="mb-3 flex min-h-11 items-center justify-end gap-3">
          <span className="mr-auto text-[11px] font-bold text-[#65706b]">Arrange Home</span>
        <div className="flex items-center gap-2">
          <span className="sr-only" aria-live="polite">{saveStatus}</span>
          <button
            type="button"
            disabled={!layoutReady}
            onClick={() => setLibraryOpen(true)}
            className="flex h-10 items-center gap-2 px-3 text-[11px] font-black text-[#176f60] hover:bg-[#f0f7f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
          >
            <Plus size={16} aria-hidden="true" /> Add module
          </button>
          <button
            type="button"
            aria-pressed={editing}
            onClick={finishEditing}
            className="flex h-10 items-center gap-2 bg-[#0f8b73] px-4 text-[11px] font-black text-white hover:bg-[#0b725f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
          >
            <Check size={15} aria-hidden="true" /> Done
          </button>
        </div>
        </div>
      ) : <span className="sr-only" aria-live="polite">{saveStatus}</span>}

      {layout.module_ids.length === 0 ? (
        <div className="border border-dashed border-[#b8c9c3] bg-[#f7faf9] px-6 py-14 text-center">
          <LibraryBig size={24} className="mx-auto text-[#4b756a]" aria-hidden="true" />
          <h2 className="mt-3 text-[15px] font-black text-[#202723]">Build your Home</h2>
          <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-[#69716c]">Add the modules you want to see here.</p>
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
                } ${editing ? "border border-dashed border-[#8eb2a7] bg-[#fbfdfc] p-2 motion-safe:transition-[opacity,transform]" : ""}`}
              >
                {editing && layoutReady ? (
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
                      title="Drag or use arrow keys to rearrange"
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
          onAdd={(moduleIds) => {
            updateLayout({ ...layout, module_ids: [...new Set([...layout.module_ids, ...moduleIds])] }, "Modules added");
            setLibraryOpen(false);
          }}
          onReset={() => {
            updateLayout(defaultPipelineHomeDashboardLayout(), "Default modules restored");
            setLibraryOpen(false);
          }}
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
  onAdd: (moduleIds: PipelineHomeModuleId[]) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<PipelineHomeModuleId[]>([]);

  return (
    <HomeDialog label="Home module library" title="Add modules" onClose={onClose}>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {pipelineHomeModuleIds.map((moduleId) => {
            const definition = definitionsById[moduleId];
            const Icon = definition.icon;
            const added = selected.includes(moduleId);
            return (
              <label key={moduleId} className={`flex min-h-32 items-start gap-3 border p-4 focus-within:ring-2 focus-within:ring-[#0f8b73] ${added ? "border-[#dce4e1] bg-[#f7f9f8]" : pending.includes(moduleId) ? "cursor-pointer border-[#0f8b73] bg-[#edf7f4]" : "cursor-pointer border-[#b8cec7] bg-white hover:bg-[#f7fbf9]"}`}>
                <Icon size={20} className="mt-1 shrink-0 text-[#0e7966]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{definition.title}</span>
                  <span className="mt-1 block text-[13px] leading-5 text-[#68716c]">{definition.detail}</span>
                  {added ? <span className="mt-2 block text-[11px] font-semibold text-[#47766a]">On Home</span> : null}
                </span>
                <input
                  type="checkbox"
                  aria-label={definition.title}
                  disabled={added}
                  checked={added || pending.includes(moduleId)}
                  onChange={(event) => setPending((current) => event.target.checked ? [...current, moduleId] : current.filter((id) => id !== moduleId))}
                  className="mt-1 h-5 w-5 shrink-0 accent-[#0f8b73]"
                />
              </label>
            );
          })}
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe5e2] bg-white px-5 py-3">
          <button type="button" onClick={onReset} className="min-h-11 px-1 text-[12px] font-semibold text-[#5c6762] hover:underline">Restore defaults</button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onClose} className="min-h-11 px-3 text-[13px] font-semibold text-[#5c6762]">Cancel</button>
            <button type="button" disabled={pending.length === 0} onClick={() => onAdd(pending)} className="min-h-11 bg-[#0f8b73] px-4 text-[13px] font-bold text-white hover:bg-[#0b725f] disabled:cursor-not-allowed disabled:bg-[#e7edeb] disabled:text-[#647069]">
              {pending.length ? `Add ${pending.length} ${pending.length === 1 ? "module" : "modules"}` : "Select modules"}
            </button>
          </div>
        </div>
    </HomeDialog>
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
