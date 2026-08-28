"use client";

import { Check, Circle, ShieldCheck, TriangleAlert } from "lucide-react";

import { operatorActivityKey, operatorModulesForRole, operatorRoleLabel } from "@/lib/training/operator-training-curriculum";
import { scenariosForRole } from "@/lib/training/operator-training-resources";
import { guidedTutorialsForRole } from "@/lib/training/operator-guided-tutorials";
import { isOperatorModuleComplete, operatorOverallProgress } from "@/lib/training/operator-training-progress";
import type { OperatorProgressRecord, OperatorTrainingProgress } from "@/lib/training/operator-training-progress-contract";

export default function OperatorCertification({ progress, record, onOpenModule, onOpenPractice, onOpenGuided }: { progress: OperatorTrainingProgress; record: OperatorProgressRecord; onOpenModule: (moduleId: string) => void; onOpenPractice: () => void; onOpenGuided: () => void }) {
  const modules = operatorModulesForRole(progress.role);
  const scenarios = scenariosForRole(progress.role);
  const overall = operatorOverallProgress(progress);
  const lowConfidence = modules.filter((module) => (progress.confidence[module.id] ?? 0) < 4);
  const incompleteModules = modules.filter((module) => !isOperatorModuleComplete(progress, module));
  const unpassedScenarios = scenarios.filter((scenario) => !progress.scenarioResults[scenario.id]?.passed);
  const tutorials = guidedTutorialsForRole(progress.role);
  const incompleteTutorials = tutorials.filter((tutorial) => progress.tutorialResults[tutorial.id]?.status !== "completed");
  const evidenceModules = modules.filter((module) => module.activities.some((activity) => activity.evidencePrompt && progress.evidence[operatorActivityKey(module.id, activity.id)]));
  const eligible = !incompleteModules.length && !unpassedScenarios.length && !incompleteTutorials.length && !lowConfidence.length;
  return (
    <section className="border border-[#cbd5d1] bg-white">
      <header className="grid gap-5 border-b border-[#d8dfdc] px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center"><div><span className="text-[9px] font-black uppercase tracking-[0.11em] text-[#0c705f]">{operatorRoleLabel(progress.role)}</span><h2 className="mt-2 text-[25px] font-black tracking-[-0.03em] text-[#191d1b]">Role readiness record</h2><p className="mt-2 max-w-[760px] text-[11px] leading-5 text-[#66716d]">Readiness requires completed instruction, correct decisions in every assigned scenario, confidence of 4 or higher, and supervisor-observed practice. The application records preparation; a supervisor owns final sign-off.</p></div><div className={`border px-5 py-5 text-center ${eligible ? "border-[#87b9a9] bg-[#edf8f4]" : "border-[#d7c69e] bg-[#fff9ec]"}`}><div className={`mx-auto flex h-12 w-12 items-center justify-center border ${eligible ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#c19947] bg-white text-[#8a641b]"}`}>{eligible ? <ShieldCheck size={24} aria-hidden="true" /> : <TriangleAlert size={22} aria-hidden="true" />}</div><div className="mt-3 text-[15px] font-black text-[#26302c]">{eligible ? "Ready for observed sign-off" : "Preparation in progress"}</div><div className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#78817e]">Curriculum {progress.curriculumVersion}</div></div></header>
      <div className="grid gap-px bg-[#d8dfdc] sm:grid-cols-2 lg:grid-cols-5"><Metric label="Path" value={`${overall.completedModules}/${overall.modules}`} ready={!incompleteModules.length} /><Metric label="Scenarios" value={`${overall.passedScenarios}/${overall.scenarios}`} ready={!unpassedScenarios.length} /><Metric label="Guided tours" value={`${tutorials.length - incompleteTutorials.length}/${tutorials.length}`} ready={!incompleteTutorials.length} /><Metric label="Evidence" value={evidenceModules.length} ready={evidenceModules.length > 0} /><Metric label="Confidence" value={`${modules.length - lowConfidence.length}/${modules.length}`} ready={!lowConfidence.length} /></div>
      <div className="grid gap-6 px-5 py-6 sm:px-7 md:grid-cols-2 xl:grid-cols-4">
        <RequirementList title="Modules to finish" empty="All role modules complete" items={incompleteModules.slice(0, 8).map((module) => ({ id: module.id, label: module.title, action: () => onOpenModule(module.id) }))} />
        <RequirementList title="Scenarios to pass" empty="All assigned scenarios passed" items={unpassedScenarios.slice(0, 8).map((scenario) => ({ id: scenario.id, label: scenario.title, action: onOpenPractice }))} />
        <RequirementList title="Guided tours to finish" empty="All role tours complete" items={incompleteTutorials.slice(0, 8).map((tutorial) => ({ id: tutorial.id, label: tutorial.title, action: onOpenGuided }))} />
        <RequirementList title="Confidence below 4" empty="All modules rated ready" items={lowConfidence.slice(0, 8).map((module) => ({ id: module.id, label: module.title, action: () => onOpenModule(module.id) }))} />
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dfdc] bg-[#f7f9f8] px-5 py-4 sm:px-7"><span className="text-[9px] font-bold text-[#707a76]">Last saved: {record.updatedAt ? new Date(record.updatedAt).toLocaleString() : "Not yet synced"}</span><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#0c705f]">Supervisor observation remains required</span></footer>
    </section>
  );
}

function Metric({ label, value, ready }: { label: string; value: string | number; ready: boolean }) { return <div className="bg-white px-5 py-4"><div className="flex items-center justify-between"><span className="text-[9px] font-black uppercase tracking-[0.09em] text-[#747e7a]">{label}</span>{ready ? <Check size={14} className="text-[#0f8b73]" aria-hidden="true" /> : <Circle size={11} className="text-[#a1aaa6]" aria-hidden="true" />}</div><div className="mt-2 text-[20px] font-black text-[#222825]">{value}</div></div>; }
function RequirementList({ title, empty, items }: { title: string; empty: string; items: readonly { id: string; label: string; action: () => void }[] }) { return <section><h3 className="text-[10px] font-black uppercase tracking-[0.1em] text-[#5d6763]">{title}</h3>{items.length ? <div className="mt-3 space-y-1">{items.map((item) => <button key={item.id} type="button" onClick={item.action} className="flex min-h-10 w-full items-center justify-between border border-[#d6ddda] bg-white px-3 text-left text-[10px] font-bold text-[#4f5955] hover:border-[#94b5aa]">{item.label}<span className="text-[#0f8b73]">Open</span></button>)}</div> : <div className="mt-3 flex min-h-12 items-center gap-2 border border-[#bcd5cc] bg-[#f0f8f5] px-3 text-[10px] font-bold text-[#0c705f]"><Check size={13} aria-hidden="true" />{empty}</div>}</section>; }
