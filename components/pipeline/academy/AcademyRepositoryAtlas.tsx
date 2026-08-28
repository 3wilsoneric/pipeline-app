"use client";

import { Check, Copy, FileCode2, Search, ShieldAlert } from "lucide-react";
import { useDeferredValue, useState } from "react";

import atlasJson from "@/lib/academy/academy-atlas.generated.json";
import { getAcademyModule } from "@/lib/academy/academy-curriculum";
import type { AcademyAtlas, AcademyAtlasEntry } from "@/lib/academy/academy-types";

const atlas = atlasJson as AcademyAtlas;
const visibleLimit = 120;

export default function AcademyRepositoryAtlas({ onOpenModule }: { onOpenModule: (moduleId: string) => void }) {
  const [query, setQuery] = useState("");
  const [subsystem, setSubsystem] = useState("all");
  const [runtime, setRuntime] = useState("all");
  const [risk, setRisk] = useState("all");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const subsystems = [...new Set(atlas.entries.map((entry) => entry.subsystem))].sort();
  const filtered = atlas.entries.filter((entry) => (
    (subsystem === "all" || entry.subsystem === subsystem)
    && (runtime === "all" || entry.runtime === runtime)
    && (risk === "all" || entry.risk === risk)
    && (!deferredQuery || entry.path.toLowerCase().includes(deferredQuery)
      || entry.subsystem.toLowerCase().includes(deferredQuery)
      || entry.kind.toLowerCase().includes(deferredQuery))
  ));

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      window.setTimeout(() => setCopiedPath((current) => current === path ? null : current), 1500);
    } catch {
      setCopiedPath(null);
    }
  };

  return (
    <section aria-labelledby="academy-atlas-title" className="space-y-5">
      <header className="grid gap-4 border-b border-[#d6dfdc] pb-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.15em] text-[#0c705f]">Every-file ownership map</div>
          <h2 id="academy-atlas-title" className="mt-1.5 text-[28px] font-semibold tracking-[-0.035em] text-[#151817]">Repository atlas</h2>
          <p className="mt-2 max-w-[760px] text-[13px] leading-6 text-[#5f6865]">
            Search every maintained code, test, infrastructure, asset, and documentation file. Each entry names its runtime, risk, subsystem, and curriculum owners.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-px overflow-hidden border border-[#cbd5d1] bg-[#cbd5d1] text-center">
          <Metric value={atlas.totals.files} label="files" />
          <Metric value={atlas.totals.lines.toLocaleString()} label="lines" />
          <Metric value={`${Math.round((atlas.totals.coveredFiles / atlas.totals.files) * 100)}%`} label="mapped" />
        </div>
      </header>

      <div className="grid gap-2 border border-[#d1dad6] bg-white p-3 lg:grid-cols-[minmax(260px,1fr)_220px_170px_150px]">
        <label className="relative block">
          <span className="sr-only">Search repository files</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#74807b]" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search path, subsystem, or kind"
            className="h-11 w-full border border-[#cbd4d1] bg-[#fbfcfb] pl-9 pr-3 text-[12px] font-semibold text-[#252a28] outline-none focus:border-[#0f8b73] focus:ring-2 focus:ring-[#d8eee6]"
          />
        </label>
        <Filter label="Subsystem" value={subsystem} onChange={setSubsystem} options={subsystems} />
        <Filter label="Runtime" value={runtime} onChange={setRuntime} options={["browser", "next-server", "postgres", "worker", "tooling", "documentation", "shared"]} />
        <Filter label="Risk" value={risk} onChange={setRisk} options={["critical", "high", "standard"]} />
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px] font-bold text-[#69736f]">
        <span>{filtered.length} matching files</span>
        {filtered.length > visibleLimit ? <span>Showing first {visibleLimit}; refine your search for the rest.</span> : null}
      </div>

      <div className="overflow-hidden border border-[#cbd5d1] bg-white">
        <div className="hidden grid-cols-[minmax(280px,1.4fr)_180px_110px_90px_minmax(220px,0.8fr)_44px] gap-3 border-b border-[#d8dfdd] bg-[#f2f5f4] px-4 py-2.5 text-[9px] font-black uppercase tracking-[0.12em] text-[#69736f] lg:grid">
          <span>Path</span><span>Subsystem</span><span>Runtime</span><span>Risk</span><span>Learning owners</span><span />
        </div>
        <div className="divide-y divide-[#e2e7e5]">
          {filtered.slice(0, visibleLimit).map((entry) => (
            <AtlasRow key={entry.path} entry={entry} copied={copiedPath === entry.path} onCopy={() => copyPath(entry.path)} onOpenModule={onOpenModule} />
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <FileCode2 size={24} className="mx-auto text-[#8b9691]" aria-hidden="true" />
            <p className="mt-3 text-[13px] font-black text-[#323835]">No files match these filters.</p>
            <p className="mt-1 text-[11px] text-[#707a76]">Clear a filter or search a broader path segment.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AtlasRow({
  entry,
  copied,
  onCopy,
  onOpenModule,
}: {
  entry: AcademyAtlasEntry;
  copied: boolean;
  onCopy: () => void;
  onOpenModule: (moduleId: string) => void;
}) {
  return (
    <article className="grid gap-2 px-4 py-3 lg:grid-cols-[minmax(280px,1.4fr)_180px_110px_90px_minmax(220px,0.8fr)_44px] lg:items-center lg:gap-3">
      <div className="min-w-0">
        <div className="break-all font-mono text-[10px] font-bold leading-4 text-[#244d42]">{entry.path}</div>
        <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#8a928f]">{entry.kind} · {entry.lines.toLocaleString()} lines</div>
      </div>
      <div className="text-[11px] font-bold text-[#4f5855]">{entry.subsystem}</div>
      <div className="text-[10px] font-black uppercase tracking-[0.06em] text-[#66706c]">{entry.runtime}</div>
      <div>
        <span className={`inline-flex items-center gap-1 border px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${riskTone(entry.risk)}`}>
          {entry.risk !== "standard" ? <ShieldAlert size={11} aria-hidden="true" /> : null}{entry.risk}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {entry.moduleIds.map((moduleId) => {
          const academyModule = getAcademyModule(moduleId);
          return academyModule ? (
            <button key={moduleId} type="button" onClick={() => onOpenModule(moduleId)} className="border border-[#c7d8d2] bg-[#f2f8f5] px-2 py-1 text-[9px] font-black text-[#0c705f] hover:border-[#0f8b73]">
              {academyModule.number}. {academyModule.title}
            </button>
          ) : null;
        })}
      </div>
      <button type="button" onClick={onCopy} aria-label={`Copy ${entry.path}`} className="flex h-9 w-9 items-center justify-center border border-[#d2dad7] text-[#68726e] hover:border-[#0f8b73] hover:text-[#0c705f]">
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </article>
  );
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return <div className="bg-white px-4 py-3"><div className="text-[15px] font-black text-[#1c2421]">{value}</div><div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#7a837f]">{label}</div></div>;
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full border border-[#cbd4d1] bg-[#fbfcfb] px-3 text-[11px] font-black text-[#3e4743] outline-none focus:border-[#0f8b73] focus:ring-2 focus:ring-[#d8eee6]">
        <option value="all">All {label.toLowerCase()}s</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function riskTone(risk: AcademyAtlasEntry["risk"]) {
  if (risk === "critical") return "border-[#dfb5ae] bg-[#fff1ee] text-[#9d4034]";
  if (risk === "high") return "border-[#e2ce9e] bg-[#fff8e7] text-[#835a0c]";
  return "border-[#d3dad8] bg-[#f7f9f8] text-[#6b7471]";
}
