"use client";

import { BookOpen, CheckCircle2, Compass, FlaskConical, GraduationCap, Map, RotateCcw, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";

import OperatorCertification from "@/components/pipeline/training/OperatorCertification";
import OperatorCurriculumView from "@/components/pipeline/training/OperatorCurriculumView";
import OperatorJobAids from "@/components/pipeline/training/OperatorJobAids";
import OperatorGuidedTours from "@/components/pipeline/training/OperatorGuidedTours";
import OperatorDemoEntry from "@/components/pipeline/training/OperatorDemoEntry";
import OperatorPracticeLab from "@/components/pipeline/training/OperatorPracticeLab";
import OperatorProductMap from "@/components/pipeline/training/OperatorProductMap";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import {
  OPERATOR_TRAINING_REVIEWED_AT,
  getOperatorModule,
  operatorActivityKey,
  operatorMinutesForRole,
  operatorModulesForRole,
  operatorRoleLabel,
} from "@/lib/training/operator-training-curriculum";
import { nextOperatorActivity, operatorOverallProgress } from "@/lib/training/operator-training-progress";
import {
  emptyOperatorProgress,
  mergeOperatorProgress,
  normalizeOperatorProgress,
  type OperatorProgressRecord,
  type OperatorTrainingProgress,
} from "@/lib/training/operator-training-progress-contract";
import type { OperatorActivity, OperatorModule } from "@/lib/training/operator-training-types";

type TrainingView = "path" | "guided" | "demo" | "practice" | "job-aids" | "product-map" | "certification";
type SyncStatus = "saved" | "saving" | "browser" | "error";

const views: readonly { id: TrainingView; label: string; icon: typeof BookOpen }[] = [
  { id: "path", label: "My path", icon: BookOpen },
  { id: "guided", label: "Guided tours", icon: Compass },
  { id: "demo", label: "Demo", icon: FlaskConical },
  { id: "practice", label: "Practice lab", icon: Sparkles },
  { id: "job-aids", label: "Job aids", icon: Wrench },
  { id: "product-map", label: "Product map", icon: Map },
  { id: "certification", label: "Certification", icon: GraduationCap },
];

export default function PipelineOperatorAcademy({
  learnerName,
  assignedRoles,
  progressStorageKey,
  initialProgress,
  demoUrl,
}: {
  learnerName: string;
  assignedRoles: readonly string[];
  progressStorageKey: string;
  initialProgress: OperatorProgressRecord;
  demoUrl: string | null;
}) {
  const [view, setView] = useState<TrainingView>("path");
  const [progress, setProgress] = useState(() => normalizeOperatorProgress(initialProgress.progress, assignedRoles));
  const [record, setRecord] = useState(initialProgress);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(initialProgress.persistence === "browser" ? "browser" : "saved");
  const [confirmReset, setConfirmReset] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const progressRef = useRef(progress);
  const revisionRef = useRef(initialProgress.revision);
  const persistenceRef = useRef(initialProgress.persistence);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const stored = readLocalProgress(progressStorageKey, assignedRoles);
    const serverProgress = normalizeOperatorProgress(initialProgress.progress, assignedRoles);
    const next = initialProgress.persistence === "browser" || initialProgress.revision === 0
      ? mergeOperatorProgress(serverProgress, stored, assignedRoles)
      : serverProgress;
    progressRef.current = next;
    startTransition(() => setProgress(next));
    writeLocalProgress(progressStorageKey, next);
    setHydrated(true);
  }, [assignedRoles, initialProgress, progressStorageKey]);

  const updateLocal = (next: OperatorTrainingProgress) => {
    const normalized = normalizeOperatorProgress(next, assignedRoles);
    progressRef.current = normalized;
    writeLocalProgress(progressStorageKey, normalized);
    startTransition(() => setProgress(normalized));
    return normalized;
  };

  const putProgress = (candidate: OperatorTrainingProgress, expectedRevision: number) => fetchPipelineJson<OperatorProgressRecord>("/api/training/progress", {
    method: "PUT",
    body: JSON.stringify({ expectedRevision, progress: candidate }),
  }, { maxResponseBytes: 360_000 });

  const applyServerRecord = (saved: OperatorProgressRecord) => {
    revisionRef.current = saved.revision;
    persistenceRef.current = saved.persistence;
    const reconciled = mergeOperatorProgress(saved.progress, progressRef.current, assignedRoles);
    updateLocal(reconciled);
    setRecord({ ...saved, progress: reconciled });
    setSyncStatus("saved");
  };

  const saveProgress = async (snapshot: OperatorTrainingProgress) => {
    try {
      applyServerRecord(await putProgress(snapshot, revisionRef.current));
    } catch (error) {
      if (error instanceof PipelineApiError && error.status === 409) {
        const current = parseConflictRecord(error.payload, assignedRoles);
        if (current) {
          try {
            revisionRef.current = current.revision;
            const merged = mergeOperatorProgress(current.progress, progressRef.current, assignedRoles);
            applyServerRecord(await putProgress(merged, current.revision));
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
    const snapshot = normalizeOperatorProgress(candidate, assignedRoles);
    if (persistenceRef.current === "browser") {
      setSyncStatus("browser");
      return;
    }
    setSyncStatus("saving");
    saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(() => saveProgress(snapshot));
  };

  const selectActivity = (module: OperatorModule, activity: OperatorActivity) => {
    setConfirmReset(false);
    const next = updateLocal({ ...progressRef.current, activeModuleId: module.id, activeActivityId: activity.id });
    queueSave(next);
  };

  const openModule = (moduleId: string) => {
    const trainingModule = getOperatorModule(moduleId);
    if (!trainingModule) return;
    setView("path");
    selectActivity(trainingModule, trainingModule.activities.find((activity) => !progressRef.current.completedActivityIds.includes(operatorActivityKey(trainingModule.id, activity.id))) ?? trainingModule.activities[0]);
  };

  const changeEvidence = (module: OperatorModule, activity: OperatorActivity, text: string) => {
    const key = operatorActivityKey(module.id, activity.id);
    updateLocal({ ...progressRef.current, evidence: { ...progressRef.current.evidence, [key]: { text, updatedAt: new Date().toISOString() } } });
  };

  const completeActivity = (module: OperatorModule, activity: OperatorActivity) => {
    const destination = nextOperatorActivity(progressRef.current, module, activity);
    const next = updateLocal({
      ...progressRef.current,
      completedActivityIds: [...new Set([...progressRef.current.completedActivityIds, operatorActivityKey(module.id, activity.id)])],
      activeModuleId: destination?.module.id ?? module.id,
      activeActivityId: destination?.activity.id ?? activity.id,
    });
    queueSave(next);
  };

  const recordScenarioAttempt = (scenarioId: string, passed: boolean) => {
    const current = progressRef.current.scenarioResults[scenarioId];
    const next = updateLocal({
      ...progressRef.current,
      scenarioResults: { ...progressRef.current.scenarioResults, [scenarioId]: { attempts: (current?.attempts ?? 0) + 1, passed: Boolean(current?.passed || passed), updatedAt: new Date().toISOString() } },
    });
    queueSave(next);
  };

  const recordConfidence = (moduleId: string, value: number) => {
    const next = updateLocal({ ...progressRef.current, confidence: { ...progressRef.current.confidence, [moduleId]: value } });
    queueSave(next);
  };

  const resetProgress = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    const next = updateLocal(emptyOperatorProgress(progressRef.current.role));
    queueSave(next);
  };

  const overall = operatorOverallProgress(progress);
  const roleModules = operatorModulesForRole(progress.role);
  const roleHours = Math.round((operatorMinutesForRole(progress.role) / 60) * 10) / 10;

  return (
    <main data-operator-academy="true" data-training-hydrated={hydrated ? "true" : "false"} aria-busy={!hydrated} className={`h-full min-h-0 overflow-y-auto bg-[#f6f8f7] text-[#171a18] ${hydrated ? "" : "pointer-events-none"}`}>
      <div className="mx-auto w-full max-w-[1680px] px-4 pb-14 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <header className="border border-[#cbd5d1] bg-white">
          <div className="grid gap-5 px-5 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-8 lg:py-6">
            <div><div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 border border-[#b9d4cb] bg-[#eef7f4] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.11em] text-[#0c705f]"><ShieldCheck size={12} aria-hidden="true" /> Pipeline Learning Center</span><SyncBadge status={syncStatus} persistence={record.persistence} /></div><h1 className="mt-3 text-[30px] font-semibold tracking-[-0.045em] text-[#141715] sm:text-[36px]">Practice the work before it counts.</h1><p className="mt-2 max-w-[850px] text-[13px] leading-6 text-[#5c6662]">{learnerName}, your {operatorRoleLabel(progress.role).toLowerCase()} path teaches the real referral-to-assessment workflow, the decisions that require judgment, and the recovery steps that keep records safe.</p></div>
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-[#cbd5d1] bg-[#cbd5d1] sm:grid-cols-4"><HeaderMetric value={`${roleHours}h`} label="role path" /><HeaderMetric value={roleModules.length} label="modules" /><HeaderMetric value={`${overall.passedScenarios}/${overall.scenarios}`} label="scenarios" /><HeaderMetric value={`${overall.percent}%`} label="complete" /></div>
          </div>
          <div className="flex items-end overflow-x-auto border-t border-[#d8dfdc] bg-[#f1f4f3] px-2 pt-2 sm:px-4" role="tablist" aria-label="Learning Center sections">{views.map((item) => { const Icon = item.icon; const active = view === item.id; return <button key={item.id} type="button" role="tab" aria-selected={active} disabled={!hydrated} onClick={() => { setView(item.id); setConfirmReset(false); }} className={`relative -mb-px flex h-12 min-w-[142px] shrink-0 items-center justify-center gap-2 border border-b-0 px-4 text-[11px] font-black ${active ? "z-10 border-[#cbd5d1] bg-white text-[#1f2623]" : "border-transparent bg-transparent text-[#6a7470] hover:bg-[#e8ecea]"}`}><Icon size={14} aria-hidden="true" />{item.label}</button>; })}<div className="ml-auto hidden pb-2 pl-4 xl:block"><span className="text-[9px] font-black uppercase tracking-[0.1em] text-[#828b87]">Reviewed {OPERATOR_TRAINING_REVIEWED_AT} · versioned curriculum</span></div></div>
        </header>

        <TrainingViewPanel view={view} progress={progress} record={record} demoUrl={demoUrl} onSelect={selectActivity} onEvidenceChange={changeEvidence} onEvidenceCommit={() => queueSave()} onComplete={completeActivity} onConfidence={recordConfidence} onScenarioAttempt={recordScenarioAttempt} onOpenModule={openModule} onOpenPractice={() => setView("practice")} onOpenGuided={() => setView("guided")} />

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-[#d3dcd8] bg-white px-4 py-3"><div className="flex items-center gap-2 text-[9px] font-bold leading-4 text-[#737d79]"><CheckCircle2 size={14} className="text-[#0f8b73]" aria-hidden="true" />Learning evidence must be synthetic. Never enter PHI, credentials, packet content, meeting links, or production identifiers.</div><button type="button" onClick={resetProgress} className={`inline-flex h-9 items-center gap-2 border px-3 text-[9px] font-black ${confirmReset ? "border-[#c85b4d] bg-[#fff0ed] text-[#9c3f34]" : "border-[#d2dad7] text-[#727b78] hover:border-[#9eb5ad]"}`}><RotateCcw size={12} aria-hidden="true" />{confirmReset ? "Press again to reset your record" : "Reset learning record"}</button></footer>
      </div>
    </main>
  );
}

function TrainingViewPanel({ view, progress, record, demoUrl, onSelect, onEvidenceChange, onEvidenceCommit, onComplete, onConfidence, onScenarioAttempt, onOpenModule, onOpenPractice, onOpenGuided }: { view: TrainingView; progress: OperatorTrainingProgress; record: OperatorProgressRecord; demoUrl: string | null; onSelect: (module: OperatorModule, activity: OperatorActivity) => void; onEvidenceChange: (module: OperatorModule, activity: OperatorActivity, text: string) => void; onEvidenceCommit: () => void; onComplete: (module: OperatorModule, activity: OperatorActivity) => void; onConfidence: (moduleId: string, value: number) => void; onScenarioAttempt: (scenarioId: string, passed: boolean) => void; onOpenModule: (moduleId: string) => void; onOpenPractice: () => void; onOpenGuided: () => void }) {
  if (view === "path") return <div className="mt-5"><OperatorCurriculumView progress={progress} onSelect={onSelect} onEvidenceChange={onEvidenceChange} onEvidenceCommit={onEvidenceCommit} onComplete={onComplete} onConfidence={onConfidence} /></div>;
  if (view === "guided") return <div className="mt-5"><OperatorGuidedTours progress={progress} /></div>;
  if (view === "demo") return <div className="mt-5"><OperatorDemoEntry demoUrl={demoUrl} /></div>;
  if (view === "practice") return <div className="mt-5"><OperatorPracticeLab progress={progress} onAttempt={onScenarioAttempt} /></div>;
  if (view === "job-aids") return <div className="mt-5"><OperatorJobAids role={progress.role} /></div>;
  if (view === "product-map") return <div className="mt-5"><OperatorProductMap onOpenModule={onOpenModule} /></div>;
  return <div className="mt-5"><OperatorCertification progress={progress} record={record} onOpenModule={onOpenModule} onOpenPractice={onOpenPractice} onOpenGuided={onOpenGuided} /></div>;
}

function SyncBadge({ status, persistence }: { status: SyncStatus; persistence: OperatorProgressRecord["persistence"] }) {
  const label = status === "saving" ? "Saving" : status === "error" ? "Save needs retry" : status === "browser" ? "Saved in this browser" : `Saved to ${persistence === "postgres" ? "workspace" : "local store"}`;
  return <span role="status" className={`inline-flex border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${status === "error" ? "border-[#d9aaa2] bg-[#fff0ed] text-[#9b4136]" : status === "browser" ? "border-[#dfca97] bg-[#fff8e8] text-[#825a10]" : "border-[#cfd8d5] bg-[#f7f9f8] text-[#68726e]"}`}>{label}</span>;
}
function HeaderMetric({ value, label }: { value: string | number; label: string }) { return <div role="group" aria-label={`${value} ${label}`} className="min-w-[92px] bg-white px-3 py-3 text-center"><div className="text-[17px] font-black text-[#202623]">{value}</div><div className="mt-0.5 text-[8px] font-black uppercase tracking-[0.09em] text-[#7a837f]">{label}</div></div>; }
function readLocalProgress(key: string, roles: readonly string[]) { if (typeof window === "undefined") return emptyOperatorProgress(normalizeOperatorProgress({}, roles).role); try { const raw = window.localStorage.getItem(key); return raw ? normalizeOperatorProgress(JSON.parse(raw), roles) : emptyOperatorProgress(normalizeOperatorProgress({}, roles).role); } catch { return emptyOperatorProgress(normalizeOperatorProgress({}, roles).role); } }
function writeLocalProgress(key: string, progress: OperatorTrainingProgress) { if (typeof window === "undefined") return; try { window.localStorage.setItem(key, JSON.stringify(progress)); } catch { /* Durable state remains authoritative when browser storage is unavailable. */ } }
function parseConflictRecord(payload: unknown, roles: readonly string[]): OperatorProgressRecord | null {
  const candidate = conflictCandidate(payload);
  if (!candidate) return null;
  const revision = Number(candidate.revision);
  if (!Number.isInteger(revision) || revision < 0) return null;
  return { revision, progress: normalizeOperatorProgress(candidate.progress, roles), updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null, persistence: conflictPersistence(candidate.persistence) };
}
function conflictCandidate(payload: unknown): Record<string, unknown> | null { if (!payload || typeof payload !== "object" || !("current" in payload)) return null; const current = payload.current; if (!current || typeof current !== "object" || !("revision" in current) || !("progress" in current)) return null; return current as Record<string, unknown>; }
function conflictPersistence(value: unknown): OperatorProgressRecord["persistence"] { if (value === "postgres" || value === "local_file") return value; return "browser"; }
