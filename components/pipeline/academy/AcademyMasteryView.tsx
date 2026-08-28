"use client";

import { Check, Circle, GraduationCap, LockKeyhole, ShieldCheck } from "lucide-react";

import atlasJson from "@/lib/academy/academy-atlas.generated.json";
import {
  academyCompetencies,
  academyModules,
  academyTotalMinutes,
  academyTracks,
  getAcademyModule,
} from "@/lib/academy/academy-curriculum";
import {
  academyOverallProgress,
  academyTrackProgress,
  isAcademyModuleComplete,
} from "@/lib/academy/academy-progress";
import type { AcademyProgress, AcademyProgressRecord } from "@/lib/academy/academy-progress-contract";
import type { AcademyAtlas } from "@/lib/academy/academy-types";

const atlas = atlasJson as AcademyAtlas;

export default function AcademyMasteryView({
  progress,
  record,
  onOpenModule,
}: {
  progress: AcademyProgress;
  record: Pick<AcademyProgressRecord, "persistence" | "updatedAt">;
  onOpenModule: (moduleId: string) => void;
}) {
  const overall = academyOverallProgress(progress);
  const evidenceCount = Object.keys(progress.evidence).length;
  const capstone = getAcademyModule("vertical-change-capstone")!;
  const capstoneReady = capstone.prerequisites.every((moduleId) => {
    const prerequisiteModule = getAcademyModule(moduleId);
    return prerequisiteModule ? isAcademyModuleComplete(progress, prerequisiteModule) : false;
  });

  return (
    <section aria-labelledby="academy-mastery-title" className="space-y-6">
      <header className="border-b border-[#d6dfdc] pb-5">
        <div className="text-[10px] font-black uppercase tracking-[0.15em] text-[#0c705f]">Competency and evidence</div>
        <h2 id="academy-mastery-title" className="mt-1.5 text-[28px] font-semibold tracking-[-0.035em] text-[#151817]">Mastery console</h2>
        <p className="mt-2 max-w-[780px] text-[13px] leading-6 text-[#5f6865]">Completion records exposure. Mastery requires source traces, applied evidence, safe change behavior, operational judgment, and teach-back.</p>
      </header>

      <div className="grid gap-px overflow-hidden border border-[#cbd5d1] bg-[#cbd5d1] sm:grid-cols-2 xl:grid-cols-5">
        <Metric value={`${overall.percent}%`} label="activity completion" />
        <Metric value={`${overall.completedModules}/${academyModules.length}`} label="modules mastered" />
        <Metric value={`${overall.tracksComplete}/${academyTracks.length}`} label="tracks mastered" />
        <Metric value={evidenceCount} label="evidence records" />
        <Metric value={`${Math.round(academyTotalMinutes() / 60)}h`} label="guided program" />
      </div>

      <section className="border border-[#ccd6d2] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dce3e0] px-5 py-4">
          <div><h3 className="text-[15px] font-black text-[#252b28]">Track progression</h3><p className="mt-1 text-[10px] text-[#747e7a]">A track closes only when every source trace, lab, and checkpoint is recorded.</p></div>
          <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#707a76]">{record.persistence === "browser" ? "Browser fallback" : `Durable ${record.persistence.replace("_", " ")}`} · {record.updatedAt ? new Date(record.updatedAt).toLocaleString() : "not synced"}</div>
        </div>
        <div className="grid gap-px bg-[#e0e6e3] md:grid-cols-2">
          {academyTracks.map((track) => {
            const status = academyTrackProgress(progress, track.id);
            return (
              <article key={track.id} className="bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0c705f]">Track {track.number}</div><h4 className="mt-1 text-[13px] font-black text-[#2b312e]">{track.title}</h4></div><span className="text-[13px] font-black text-[#2c3330]">{status.percent}%</span></div>
                <div className="mt-3 h-1.5 bg-[#e5eae8]"><div className="h-full bg-[#0f8b73]" style={{ width: `${status.percent}%` }} /></div>
                <div className="mt-2 text-[9px] font-bold text-[#7a837f]">{status.completedModules}/{status.modules} modules · {status.completed}/{status.activities} activities</div>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3"><h3 className="text-[16px] font-black text-[#252b28]">Competency gates</h3><p className="mt-1 text-[11px] leading-5 text-[#6c7672]">These standards define what it means to own Pipeline, beyond navigating its files.</p></div>
        <div className="grid gap-3 xl:grid-cols-2">
          {academyCompetencies.map((competency) => {
            const modules = competency.moduleIds.map((moduleId) => getAcademyModule(moduleId)).filter(Boolean);
            const mastered = modules.length > 0 && modules.every((academyModule) => academyModule && isAcademyModuleComplete(progress, academyModule));
            return (
              <article key={competency.id} className="border border-[#cfd8d5] bg-white px-5 py-5">
                <div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center border ${mastered ? "border-[#8fc2b2] bg-[#ebf7f2] text-[#0c705f]" : "border-[#d1d9d6] bg-[#f5f7f6] text-[#77807d]"}`}>{mastered ? <Check size={17} aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}</span><div><h4 className="text-[14px] font-black text-[#252b28]">{competency.title}</h4><p className="mt-1 text-[11px] leading-5 text-[#5e6864]">{competency.standard}</p></div></div>
                <div className="mt-4 text-[9px] font-black uppercase tracking-[0.1em] text-[#737d79]">Required proof</div>
                <ul className="mt-2 space-y-1.5">{competency.proof.map((proof) => <li key={proof} className="flex gap-2 text-[10px] leading-4 text-[#59635f]"><Circle size={7} fill="currentColor" className="mt-1 shrink-0 text-[#0f8b73]" aria-hidden="true" />{proof}</li>)}</ul>
                <div className="mt-4 flex flex-wrap gap-1.5">{modules.map((academyModule) => academyModule ? <button key={academyModule.id} type="button" onClick={() => onOpenModule(academyModule.id)} className="border border-[#c8d8d3] bg-[#f5f9f7] px-2 py-1 text-[9px] font-black text-[#176b78] hover:border-[#176b78]">{academyModule.number}. {academyModule.title}</button> : null)}</div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={`grid gap-5 border px-6 py-6 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center ${capstoneReady ? "border-[#88bfae] bg-[#eff8f4]" : "border-[#d9c797] bg-[#fff9eb]"}`}>
        <span className={`flex h-12 w-12 items-center justify-center border bg-white ${capstoneReady ? "border-[#83b9a8] text-[#0c705f]" : "border-[#d3bd82] text-[#865b11]"}`}>{capstoneReady ? <GraduationCap size={24} aria-hidden="true" /> : <LockKeyhole size={22} aria-hidden="true" />}</span>
        <div><div className="text-[10px] font-black uppercase tracking-[0.11em] text-[#6e765f]">Ownership capstone</div><h3 className="mt-1 text-[18px] font-black text-[#252b28]">{capstoneReady ? "You are ready to begin the vertical change capstone." : "Build the prerequisites before changing production behavior."}</h3><p className="mt-1.5 text-[11px] leading-5 text-[#626b67]">The capstone requires a bounded change dossier, characterization, focused implementation, assurance evidence, rollout, rollback, and teach-back.</p></div>
        <button type="button" onClick={() => onOpenModule(capstone.id)} className="h-11 border border-[#0f8b73] bg-white px-4 text-[10px] font-black text-[#0c705f] hover:bg-[#e8f5f0]">{capstoneReady ? "Open capstone" : "Preview capstone"}</button>
      </section>

      <div className="border border-[#d5ddda] bg-[#f7f9f8] px-5 py-4 text-[10px] leading-5 text-[#65706b]">
        Repository accountability: <strong className="text-[#2b3330]">{atlas.totals.coveredFiles.toLocaleString()} of {atlas.totals.files.toLocaleString()} maintained files</strong> are mapped to a curriculum owner. The generated atlas fingerprint is <code className="font-mono text-[9px] text-[#176b78]">{atlas.fingerprint.slice(0, 16)}</code>.
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return <div className="bg-white px-4 py-4"><div className="text-[20px] font-black text-[#202623]">{value}</div><div className="mt-1 text-[9px] font-black uppercase tracking-[0.09em] text-[#7a837f]">{label}</div></div>;
}
