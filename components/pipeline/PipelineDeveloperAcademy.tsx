"use client";

import {
  BookOpen,
  CheckCircle2,
  FlaskConical,
  GitBranch,
  GraduationCap,
  LibraryBig,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";

import AcademyCurriculumView from "@/components/pipeline/academy/AcademyCurriculumView";
import AcademyJourneyLibrary from "@/components/pipeline/academy/AcademyJourneyLibrary";
import AcademyLabsView from "@/components/pipeline/academy/AcademyLabsView";
import AcademyMasteryView from "@/components/pipeline/academy/AcademyMasteryView";
import AcademyRepositoryAtlas from "@/components/pipeline/academy/AcademyRepositoryAtlas";
import {
  academyActivityIds,
  academyActivityKey,
  academyModules,
  academyTotalMinutes,
  academyTracks,
  getAcademyModule,
} from "@/lib/academy/academy-curriculum";
import {
  emptyAcademyProgress,
  mergeAcademyProgress,
  normalizeAcademyProgress,
  type AcademyProgress,
  type AcademyProgressRecord,
} from "@/lib/academy/academy-progress-contract";
import {
  academyOverallProgress,
  isAcademyActivityComplete,
  nextAcademyActivity,
} from "@/lib/academy/academy-progress";
import type { AcademyActivity, AcademyModule } from "@/lib/academy/academy-types";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";

type AcademyView = "curriculum" | "journeys" | "repository" | "labs" | "mastery";
type SyncStatus = "saved" | "saving" | "browser" | "error";

const academyViews: readonly {
  id: AcademyView;
  label: string;
  icon: typeof BookOpen;
}[] = [
  { id: "curriculum", label: "Curriculum", icon: BookOpen },
  { id: "journeys", label: "Journeys", icon: GitBranch },
  { id: "repository", label: "Repository", icon: LibraryBig },
  { id: "labs", label: "Labs", icon: FlaskConical },
  { id: "mastery", label: "Mastery", icon: GraduationCap },
];

export default function PipelineDeveloperAcademy({
  learnerName,
  progressStorageKey,
  initialProgress,
}: {
  learnerName: string;
  progressStorageKey: string;
  initialProgress: AcademyProgressRecord;
}) {
  const [view, setView] = useState<AcademyView>("curriculum");
  const [progress, setProgress] = useState(() => normalizeAcademyProgress(initialProgress.progress));
  const [record, setRecord] = useState(initialProgress);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(initialProgress.persistence === "browser" ? "browser" : "saved");
  const [confirmReset, setConfirmReset] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const progressRef = useRef(progress);
  const revisionRef = useRef(initialProgress.revision);
  const persistenceRef = useRef(initialProgress.persistence);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const stored = readLocalProgress(progressStorageKey);
    const serverProgress = normalizeAcademyProgress(initialProgress.progress);
    const next = initialProgress.persistence === "browser" || initialProgress.revision === 0
      ? mergeAcademyProgress(serverProgress, stored)
      : serverProgress;
    progressRef.current = next;
    startTransition(() => setProgress(next));
    writeLocalProgress(progressStorageKey, next);
    setHydrated(true);
  }, [initialProgress, progressStorageKey]);

  const updateLocal = (next: AcademyProgress) => {
    const normalized = normalizeAcademyProgress(next);
    progressRef.current = normalized;
    writeLocalProgress(progressStorageKey, normalized);
    startTransition(() => setProgress(normalized));
    return normalized;
  };

  const putProgress = (candidate: AcademyProgress, expectedRevision: number) => (
    fetchPipelineJson<AcademyProgressRecord>("/api/academy/progress", {
      method: "PUT",
      body: JSON.stringify({ expectedRevision, progress: candidate }),
    }, { maxResponseBytes: 400_000 })
  );

  const applyServerRecord = (saved: AcademyProgressRecord) => {
    revisionRef.current = saved.revision;
    persistenceRef.current = saved.persistence;
    const reconciled = mergeAcademyProgress(saved.progress, progressRef.current);
    updateLocal(reconciled);
    setRecord({ ...saved, progress: reconciled });
    setSyncStatus("saved");
  };

  const saveProgress = async (snapshot: AcademyProgress) => {
    try {
      const saved = await putProgress(snapshot, revisionRef.current);
      applyServerRecord(saved);
    } catch (error) {
      if (error instanceof PipelineApiError && error.status === 409) {
        const current = conflictRecord(error.payload);
        if (current) {
          try {
            const merged = mergeAcademyProgress(current.progress, progressRef.current);
            revisionRef.current = current.revision;
            const saved = await putProgress(merged, current.revision);
            applyServerRecord(saved);
            return;
          } catch {
            setSyncStatus("error");
            return;
          }
        }
      }
      if (error instanceof PipelineApiError && error.status === 503) {
        persistenceRef.current = "browser";
        setRecord((current) => ({ ...current, persistence: "browser" }));
        setSyncStatus("browser");
        return;
      }
      setSyncStatus("error");
    }
  };

  const queueSave = (candidate = progressRef.current) => {
    const snapshot = normalizeAcademyProgress(candidate);
    if (persistenceRef.current === "browser") {
      setSyncStatus("browser");
      return;
    }
    setSyncStatus("saving");
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveProgress(snapshot));
  };

  const selectActivity = (module: AcademyModule, activity: AcademyActivity) => {
    setConfirmReset(false);
    const next = updateLocal({
      ...progressRef.current,
      activeModuleId: module.id,
      activeActivityId: activity.id,
    });
    queueSave(next);
  };

  const openModule = (moduleId: string, requestedActivity?: AcademyActivity) => {
    const academyModule = getAcademyModule(moduleId);
    if (!academyModule) return;
    const activity = requestedActivity
      ?? academyModule.activities.find((candidate) => !isAcademyActivityComplete(progressRef.current, academyModule.id, candidate.id))
      ?? academyModule.activities[0];
    setView("curriculum");
    selectActivity(academyModule, activity);
  };

  const changeEvidence = (module: AcademyModule, activity: AcademyActivity, text: string) => {
    const key = academyActivityKey(module.id, activity.id);
    updateLocal({
      ...progressRef.current,
      evidence: {
        ...progressRef.current.evidence,
        [key]: { text, updatedAt: new Date().toISOString() },
      },
    });
  };

  const completeActivity = (module: AcademyModule, activity: AcademyActivity) => {
    const destination = nextAcademyActivity(module, activity);
    const next = updateLocal({
      ...progressRef.current,
      completedActivityIds: [...new Set([
        ...progressRef.current.completedActivityIds,
        academyActivityKey(module.id, activity.id),
      ])],
      activeModuleId: destination?.module.id ?? module.id,
      activeActivityId: destination?.activity.id ?? activity.id,
    });
    queueSave(next);
  };

  const resetProgress = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    const next = updateLocal(emptyAcademyProgress());
    queueSave(next);
  };

  const overall = academyOverallProgress(progress);

  return (
    <main data-academy-page="true" data-academy-hydrated={hydrated ? "true" : "false"} aria-busy={!hydrated} className={`h-full min-h-0 overflow-y-auto bg-[#f6f8f7] text-[#171a18] ${hydrated ? "" : "pointer-events-none"}`}>
      <div className="mx-auto w-full max-w-[1680px] px-4 pb-14 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <header className="border border-[#cbd5d1] bg-white">
          <div className="grid gap-5 px-5 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-8 lg:py-6">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 border border-[#b9d4cb] bg-[#eef7f4] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.11em] text-[#0c705f]"><ShieldCheck size={12} aria-hidden="true" /> Private owner program</span>
                <SyncBadge status={syncStatus} persistence={record.persistence} />
              </div>
              <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.045em] text-[#141715] sm:text-[36px]">Master the system you own.</h1>
              <p className="mt-2 max-w-[850px] text-[13px] leading-6 text-[#5c6662]">{learnerName}, this is the source-grounded path from TypeScript fundamentals to safe production ownership of Pipeline. It is built from the current repository, its clinical workflows, and its operating controls.</p>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-[#cbd5d1] bg-[#cbd5d1] sm:grid-cols-4">
              <HeaderMetric value={`${Math.round(academyTotalMinutes() / 60)}h`} label="program" />
              <HeaderMetric value={academyModules.length} label="modules" />
              <HeaderMetric value={academyActivityIds.length} label="activities" />
              <HeaderMetric value={`${overall.percent}%`} label="complete" />
            </div>
          </div>

          <div className="flex items-end overflow-x-auto border-t border-[#d8dfdc] bg-[#f1f4f3] px-2 pt-2 sm:px-4" role="tablist" aria-label="Academy sections">
            {academyViews.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button key={item.id} type="button" role="tab" aria-selected={active} disabled={!hydrated} onClick={() => { setView(item.id); setConfirmReset(false); }} className={`relative -mb-px flex h-12 min-w-[134px] shrink-0 items-center justify-center gap-2 border border-b-0 px-4 text-[11px] font-black ${active ? "z-10 border-[#cbd5d1] bg-white text-[#1f2623]" : "border-transparent bg-transparent text-[#6a7470] hover:bg-[#e8ecea] hover:text-[#38413d]"}`}>
                  <Icon size={14} aria-hidden="true" />{item.label}
                </button>
              );
            })}
            <div className="ml-auto hidden pb-2 pl-4 xl:block"><span className="text-[9px] font-black uppercase tracking-[0.1em] text-[#828b87]">{academyTracks.length} tracks · {overall.completedModules}/{academyModules.length} modules mastered</span></div>
          </div>
        </header>

        <AcademyViewPanel view={view} progress={progress} record={record} onSelect={selectActivity} onEvidenceChange={changeEvidence} onEvidenceCommit={() => queueSave()} onComplete={completeActivity} onOpenModule={openModule} />

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-[#d3dcd8] bg-white px-4 py-3">
          <div className="flex items-center gap-2 text-[9px] font-bold leading-4 text-[#737d79]"><CheckCircle2 size={14} className="text-[#0f8b73]" aria-hidden="true" />Academy notes are learning evidence only. Never enter PHI, credentials, secrets, production identifiers, or packet content.</div>
          <button type="button" onClick={resetProgress} className={`inline-flex h-9 items-center gap-2 border px-3 text-[9px] font-black ${confirmReset ? "border-[#c85b4d] bg-[#fff0ed] text-[#9c3f34]" : "border-[#d2dad7] text-[#727b78] hover:border-[#9eb5ad] hover:text-[#36413d]"}`}><RotateCcw size={12} aria-hidden="true" />{confirmReset ? "Press again to reset all evidence" : "Reset learning record"}</button>
        </footer>
      </div>
    </main>
  );
}

function AcademyViewPanel({ view, progress, record, onSelect, onEvidenceChange, onEvidenceCommit, onComplete, onOpenModule }: { view: AcademyView; progress: AcademyProgress; record: AcademyProgressRecord; onSelect: (module: AcademyModule, activity: AcademyActivity) => void; onEvidenceChange: (module: AcademyModule, activity: AcademyActivity, text: string) => void; onEvidenceCommit: () => void; onComplete: (module: AcademyModule, activity: AcademyActivity) => void; onOpenModule: (moduleId: string, activity?: AcademyActivity) => void }) {
  if (view === "curriculum") return <div className="mt-5"><AcademyCurriculumView progress={progress} onSelect={onSelect} onEvidenceChange={onEvidenceChange} onEvidenceCommit={onEvidenceCommit} onComplete={onComplete} /></div>;
  if (view === "journeys") return <div className="mt-5"><AcademyJourneyLibrary onOpenModule={onOpenModule} /></div>;
  if (view === "repository") return <div className="mt-5"><AcademyRepositoryAtlas onOpenModule={onOpenModule} /></div>;
  if (view === "labs") return <div className="mt-5"><AcademyLabsView progress={progress} onOpenLab={(module, activity) => onOpenModule(module.id, activity)} /></div>;
  return <div className="mt-5"><AcademyMasteryView progress={progress} record={record} onOpenModule={onOpenModule} /></div>;
}

function SyncBadge({ status, persistence }: { status: SyncStatus; persistence: AcademyProgressRecord["persistence"] }) {
  const label = status === "saving"
    ? "Saving"
    : status === "error"
      ? "Save needs retry"
      : status === "browser"
        ? "Saved in this browser"
        : `Saved to ${persistence === "postgres" ? "workspace" : "local developer store"}`;
  return <span role="status" className={`inline-flex border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${status === "error" ? "border-[#d9aaa2] bg-[#fff0ed] text-[#9b4136]" : status === "browser" ? "border-[#dfca97] bg-[#fff8e8] text-[#825a10]" : "border-[#cfd8d5] bg-[#f7f9f8] text-[#68726e]"}`}>{label}</span>;
}

function HeaderMetric({ value, label }: { value: string | number; label: string }) {
  return <div role="group" aria-label={`${value} ${label}`} className="min-w-[92px] bg-white px-3 py-3 text-center"><div className="text-[17px] font-black text-[#202623]">{value}</div><div className="mt-0.5 text-[8px] font-black uppercase tracking-[0.09em] text-[#7a837f]">{label}</div></div>;
}

function readLocalProgress(key: string) {
  if (typeof window === "undefined") return emptyAcademyProgress();
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? normalizeAcademyProgress(JSON.parse(raw)) : emptyAcademyProgress();
  } catch {
    return emptyAcademyProgress();
  }
}

function writeLocalProgress(key: string, progress: AcademyProgress) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // The durable workspace record remains authoritative when browser storage is unavailable.
  }
}

function conflictRecord(payload: unknown): AcademyProgressRecord | null {
  const candidate = conflictCandidate(payload);
  if (!candidate) return null;
  const revision = Number(candidate.revision);
  if (!Number.isInteger(revision) || revision < 0) return null;
  return {
    revision,
    progress: normalizeAcademyProgress(candidate.progress),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
    persistence: conflictPersistence(candidate.persistence),
  };
}

function conflictCandidate(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || !("current" in payload)) return null;
  const current = payload.current;
  if (!current || typeof current !== "object" || !("revision" in current) || !("progress" in current)) return null;
  return current as Record<string, unknown>;
}

function conflictPersistence(value: unknown): AcademyProgressRecord["persistence"] {
  if (value === "postgres" || value === "local_file") return value;
  return "browser";
}
