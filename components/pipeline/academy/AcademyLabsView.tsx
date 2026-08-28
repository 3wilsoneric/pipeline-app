"use client";

import { ArrowRight, Check, ClipboardCheck, FlaskConical, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";

import {
  academyActivityKey,
  academyModules,
  academyTracks,
  getAcademyTrack,
} from "@/lib/academy/academy-curriculum";
import { academyEvidenceFor, evidenceMeetsMinimum } from "@/lib/academy/academy-progress";
import type { AcademyProgress } from "@/lib/academy/academy-progress-contract";
import type { AcademyActivity, AcademyModule } from "@/lib/academy/academy-types";

type LabStatus = "all" | "ready" | "completed" | "needs-evidence";
type AcademyLab = { module: AcademyModule; activity: AcademyActivity };

export default function AcademyLabsView({
  progress,
  onOpenLab,
}: {
  progress: AcademyProgress;
  onOpenLab: (module: AcademyModule, activity: AcademyActivity) => void;
}) {
  const [query, setQuery] = useState("");
  const [trackId, setTrackId] = useState("all");
  const [status, setStatus] = useState<LabStatus>("all");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const labs = academyModules.map((module) => ({
    module,
    activity: module.activities.find((activity) => activity.kind === "lab")!,
  }));
  const filtered = labs.filter((lab) => labMatchesFilters(lab, progress, trackId, status, deferredQuery));
  const completed = labs.filter(({ module, activity }) => (
    progress.completedActivityIds.includes(academyActivityKey(module.id, activity.id))
  )).length;

  return (
    <section aria-labelledby="academy-labs-title" className="space-y-5">
      <header className="grid gap-4 border-b border-[#d6dfdc] pb-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.15em] text-[#9b6417]">Applied engineering work</div>
          <h2 id="academy-labs-title" className="mt-1.5 text-[28px] font-semibold tracking-[-0.035em] text-[#151817]">Lab workbench</h2>
          <p className="mt-2 max-w-[760px] text-[13px] leading-6 text-[#5f6865]">
            Thirty-six source-grounded exercises move from tracing existing behavior to operating and changing it safely. Evidence is private learning material, never a place for PHI or credentials.
          </p>
        </div>
        <div className="border border-[#cbd5d1] bg-white px-5 py-3 text-right">
          <div className="text-[20px] font-black text-[#202623]">{completed}/{labs.length}</div>
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#7a837f]">labs completed</div>
        </div>
      </header>

      <div className="grid gap-2 border border-[#d1dad6] bg-white p-3 lg:grid-cols-[minmax(260px,1fr)_240px_190px]">
        <label className="relative block">
          <span className="sr-only">Search labs</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#74807b]" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search scenarios or modules" className="h-11 w-full border border-[#cbd4d1] bg-[#fbfcfb] pl-9 pr-3 text-[12px] font-semibold text-[#252a28] outline-none focus:border-[#0f8b73] focus:ring-2 focus:ring-[#d8eee6]" />
        </label>
        <select aria-label="Filter labs by track" value={trackId} onChange={(event) => setTrackId(event.target.value)} className="h-11 border border-[#cbd4d1] bg-[#fbfcfb] px-3 text-[11px] font-black text-[#3e4743] outline-none focus:border-[#0f8b73]">
          <option value="all">All tracks</option>
          {academyTracks.map((track) => <option key={track.id} value={track.id}>{track.number}. {track.title}</option>)}
        </select>
        <select aria-label="Filter labs by status" value={status} onChange={(event) => setStatus(event.target.value as LabStatus)} className="h-11 border border-[#cbd4d1] bg-[#fbfcfb] px-3 text-[11px] font-black text-[#3e4743] outline-none focus:border-[#0f8b73]">
          <option value="all">All statuses</option>
          <option value="needs-evidence">Needs evidence</option>
          <option value="ready">Evidence ready</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {filtered.map((lab) => <AcademyLabCard key={academyActivityKey(lab.module.id, lab.activity.id)} lab={lab} progress={progress} onOpenLab={onOpenLab} />)}
      </div>
      {filtered.length === 0 ? <div className="border border-dashed border-[#cbd5d1] bg-white px-6 py-14 text-center text-[12px] font-bold text-[#6d7773]">No labs match these filters.</div> : null}
    </section>
  );
}

function AcademyLabCard({ lab: { module, activity }, progress, onOpenLab }: { lab: AcademyLab; progress: AcademyProgress; onOpenLab: (module: AcademyModule, activity: AcademyActivity) => void }) {
  const complete = progress.completedActivityIds.includes(academyActivityKey(module.id, activity.id));
  const evidence = academyEvidenceFor(progress, module.id, activity.id);
  const evidenceReady = evidenceMeetsMinimum(evidence);
  const track = getAcademyTrack(module.trackId);
  const status = labStatusPresentation(complete, evidenceReady);
  const StatusIcon = status.icon;
  return (
    <article className="flex min-h-[250px] flex-col border border-[#cfd8d5] bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-[#e0e6e3] px-5 py-4">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.11em] text-[#7a837f]">Track {track?.number} · Module {module.number} · {activity.minutes} min</div>
          <h3 className="mt-1.5 text-[16px] font-black leading-5 text-[#242a27]">{activity.title}</h3>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.07em] ${status.className}`}>
          <StatusIcon size={11} aria-hidden="true" />{status.label}
        </span>
      </div>
      <div className="flex flex-1 flex-col px-5 py-4">
        <p className="text-[12px] leading-5 text-[#59635f]">{activity.summary}</p>
        <div className="mt-4 border-l-2 border-l-[#d5b56f] bg-[#fffaf0] px-3 py-2.5 text-[10px] leading-4 text-[#6e5b36]">{activity.evidencePrompt}</div>
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <div className="text-[9px] font-bold text-[#7b8581]">{evidence.length ? `${evidence.trim().length} evidence characters` : "No evidence recorded"}</div>
          <button type="button" onClick={() => onOpenLab(module, activity)} className="inline-flex h-10 items-center gap-2 bg-[#176b78] px-4 text-[10px] font-black text-white hover:bg-[#115b66]">
            {complete ? "Review lab" : "Open lab"}<ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

function labMatchesFilters({ module, activity }: AcademyLab, progress: AcademyProgress, trackId: string, status: LabStatus, query: string) {
  const complete = progress.completedActivityIds.includes(academyActivityKey(module.id, activity.id));
  const evidenceReady = evidenceMeetsMinimum(academyEvidenceFor(progress, module.id, activity.id));
  return matchesTrack(module, trackId)
    && matchesLabStatus(status, complete, evidenceReady)
    && matchesLabQuery(module, activity, query);
}

function matchesTrack(module: AcademyModule, trackId: string) {
  return trackId === "all" || module.trackId === trackId;
}

function matchesLabStatus(status: LabStatus, complete: boolean, evidenceReady: boolean) {
  if (status === "completed") return complete;
  if (status === "ready") return evidenceReady && !complete;
  if (status === "needs-evidence") return !evidenceReady && !complete;
  return true;
}

function matchesLabQuery(module: AcademyModule, activity: AcademyActivity, query: string) {
  if (!query) return true;
  return [module.title, activity.title, activity.summary].some((value) => value.toLowerCase().includes(query));
}

function labStatusPresentation(complete: boolean, evidenceReady: boolean) {
  if (complete) return { icon: Check, label: "Completed", className: "border-[#9ac9ba] bg-[#ebf7f2] text-[#0c705f]" };
  if (evidenceReady) return { icon: ClipboardCheck, label: "Evidence ready", className: "border-[#9fc4cd] bg-[#eef8fa] text-[#176b78]" };
  return { icon: FlaskConical, label: "In queue", className: "border-[#ddc895] bg-[#fff8e8] text-[#865b11]" };
}
