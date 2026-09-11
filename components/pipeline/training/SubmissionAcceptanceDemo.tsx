"use client";

import { Check, CheckCircle2, Circle, ClipboardCheck, LockKeyhole, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";

type RehearsalState = "ready" | "submitted" | "accepted";

export default function SubmissionAcceptanceDemo({ preparedBy }: { preparedBy: string }) {
  const [state, setState] = useState<RehearsalState>("ready");
  const submitted = state !== "ready";
  const accepted = state === "accepted";

  return (
    <section data-submittal-acceptance-demo="true" className="min-h-full bg-[#f6f8f7]">
      <header className="border-b border-[#d8dfdc] bg-white px-5 py-5 sm:px-8">
        <div className="text-[9px] font-black uppercase tracking-[0.11em] text-[#0c705f]">Synthetic workflow rehearsal</div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[25px] font-black tracking-[-0.035em] text-[#18201d]">Submittal and acceptance</h2>
            <p className="mt-1 text-[11px] leading-5 text-[#66716c]">The assessor submits a signed recommendation. The supervisor reviews and records the decision.</p>
          </div>
          <span className="inline-flex items-center gap-2 text-[10px] font-black text-[#2c6e5d]"><ShieldCheck size={15} />Demo only · nothing is saved</span>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1180px] gap-5 px-5 py-7 lg:grid-cols-2 lg:px-8 lg:py-10">
        <WorkflowCard eyebrow="01 · Assessor" title="Submit for supervisor review" icon={<Send size={18} aria-hidden="true" />} active={!submitted} complete={submitted}>
          <dl className="mt-5 divide-y divide-[#e0e5e2] border-y border-[#e0e5e2]">
            <Fact label="Assessment" value="Signed and locked" />
            <Fact label="Recommendation" value="Accept" />
            <Fact label="Clinical rationale" value="Appropriate for placement with routine medication support." />
            <Fact label="Submitted by" value={preparedBy || "Assigned assessor"} />
          </dl>
          <p className="mt-4 flex gap-2 text-[10px] font-semibold leading-5 text-[#56625d]"><LockKeyhole size={14} className="mt-0.5 shrink-0 text-[#0c705f]" />The signed assessment revision is frozen when it is submitted.</p>
          <button type="button" disabled={submitted} onClick={() => setState("submitted")} className="mt-5 flex h-11 w-full items-center justify-center gap-2 bg-[#0f8b73] px-4 text-[10px] font-black text-white hover:bg-[#0b6d5b] disabled:bg-[#e4efeb] disabled:text-[#286a59]">
            {submitted ? <><Check size={14} />Submitted for review</> : <><Send size={14} />Submit for supervisor review</>}
          </button>
        </WorkflowCard>

        <WorkflowCard eyebrow="02 · Head supervisor" title="Review and record the decision" icon={<ClipboardCheck size={18} aria-hidden="true" />} active={submitted && !accepted} complete={accepted}>
          <div className="mt-5 border-l-2 border-[#0f8b73] bg-[#f3faf7] px-4 py-4">
            <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#176f60]">Decision readiness</div>
            <ul className="mt-3 grid gap-3 text-[10px] font-bold">
              <Readiness complete={submitted} label={submitted ? "Supervisor review is open" : "Awaiting assessor submittal"} />
              <Readiness complete={submitted} label="Signed assessment revision attached" />
              <Readiness complete={submitted} label="Accept recommendation recorded" />
              <Readiness complete={submitted} label="Decision requirements resolved" />
            </ul>
          </div>
          <label className="mt-5 block text-[10px] font-black text-[#34413c]">Decision
            <select value={submitted ? "accepted" : ""} disabled className="mt-2 h-11 w-full border border-[#cbd5d1] bg-white px-3 text-[11px] font-bold text-[#27332e] disabled:text-[#7a8580]">
              <option value="">Available after submittal</option>
              <option value="accepted">Accept</option>
            </select>
          </label>
          <button type="button" disabled={!submitted || accepted} onClick={() => setState("accepted")} className="mt-5 flex h-11 w-full items-center justify-center gap-2 bg-[#17221e] px-4 text-[10px] font-black text-white hover:bg-[#2a3933] disabled:bg-[#d8dfdc] disabled:text-[#78827e]">
            {accepted ? <><CheckCircle2 size={14} />Accepted decision recorded</> : <><CheckCircle2 size={14} />Record accepted decision</>}
          </button>
        </WorkflowCard>
      </div>

      <footer className="border-t border-[#d8dfdc] bg-white px-5 py-5 sm:px-8">
        <ol className="mx-auto grid max-w-[900px] gap-px bg-[#d8dfdc] sm:grid-cols-3">
          <StatusStep label="Assessment signed" complete />
          <StatusStep label="Awaiting supervisor review" complete={submitted} current={!submitted} />
          <StatusStep label="Accepted decision recorded" complete={accepted} current={submitted && !accepted} />
        </ol>
      </footer>
    </section>
  );
}

function WorkflowCard({ eyebrow, title, icon, active, complete, children }: { eyebrow: string; title: string; icon: React.ReactNode; active: boolean; complete: boolean; children: React.ReactNode }) {
  return <article className={`border bg-white p-5 shadow-[0_18px_50px_rgba(28,50,42,0.07)] sm:p-6 ${active ? "border-[#82b6a5] ring-1 ring-[#b8d8cd]" : "border-[#cfd8d3]"}`}><div className="flex items-start justify-between gap-4"><div><div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0c705f]">{eyebrow}</div><h3 className="mt-2 text-[18px] font-black tracking-[-0.025em] text-[#202925]">{title}</h3></div><span className={`flex h-10 w-10 shrink-0 items-center justify-center ${complete ? "bg-[#0f8b73] text-white" : active ? "bg-[#e5f3ee] text-[#0c705f]" : "bg-[#edf0ef] text-[#7a8580]"}`}>{complete ? <Check size={18} /> : icon}</span></div>{children}</article>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 py-3 sm:grid-cols-[135px_minmax(0,1fr)]"><dt className="text-[9px] font-black uppercase tracking-[0.07em] text-[#78827e]">{label}</dt><dd className="text-[11px] font-bold leading-5 text-[#33403a]">{value}</dd></div>;
}

function Readiness({ complete, label }: { complete: boolean; label: string }) {
  return <li className={`flex items-center gap-2 ${complete ? "text-[#285b50]" : "text-[#7a6650]"}`}>{complete ? <CheckCircle2 size={14} /> : <Circle size={12} />}{label}</li>;
}

function StatusStep({ label, complete, current = false }: { label: string; complete: boolean; current?: boolean }) {
  return <li className={`flex min-h-14 items-center gap-2 px-4 text-[10px] font-black ${complete ? "bg-[#edf7f3] text-[#285b50]" : current ? "bg-[#fff8e9] text-[#73591f]" : "bg-[#f7f9f8] text-[#8a928f]"}`}>{complete ? <CheckCircle2 size={14} /> : <Circle size={12} />}{label}</li>;
}
