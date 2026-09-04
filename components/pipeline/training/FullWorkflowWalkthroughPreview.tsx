"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileUp,
  MousePointerClick,
  ShieldCheck,
  UserCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { assessmentPracticeRules } from "@/lib/training/assessment-practice";

type WorkflowConcept = {
  id: string;
  label: string;
  title: string;
  summary: string;
  owner: string;
  rule: string;
  points: readonly { title: string; detail: string }[];
  icon: LucideIcon;
};

const concepts: readonly WorkflowConcept[] = [
  {
    id: "overview",
    label: "Overview",
    title: "One referral, one workspace",
    summary: "Every document, appointment, assessment answer, and outcome stays attached to the same referral record.",
    owner: "Supervisor starts it; the assigned assessor carries the assessment.",
    rule: "Update the source record once. Every queue, calendar, chart, and report reads from it.",
    icon: CheckCircle2,
    points: [
      { title: "Intake", detail: "Create the workspace from the incoming referral and its initial documents." },
      { title: "Assessment", detail: "Assign one assessor, schedule the interview, and complete the questionnaire over time." },
      { title: "Handoff", detail: "Review the signed record and use its chart for the authorized outcome and handoff." },
    ],
  },
  {
    id: "referral",
    label: "Referral",
    title: "The packet starts the record",
    summary: "The supervisor uploads the initial referral material, verifies identity and routing, then assigns one assessor.",
    owner: "Supervisor",
    rule: "Uploaded facts remain proposed until a person verifies them against the source document.",
    icon: FileUp,
    points: [
      { title: "Attach the source", detail: "The original packet anchors extracted and manually entered information to evidence." },
      { title: "Verify the basics", detail: "Confirm the client, referral source, county, community, and received date." },
      { title: "Assign accountability", detail: "One assignment drives permissions, queues, calendar ownership, and performance reporting." },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    title: "Scheduling creates the plan",
    summary: "The assigned assessor records one appointment inside the workspace instead of creating a detached calendar item.",
    owner: "Assigned assessor or authorized supervisor",
    rule: "The workspace and calendar share the same appointment, so a reschedule changes both views.",
    icon: CalendarDays,
    points: [
      { title: "Set complete details", detail: "Date, time, duration, method, and location or meeting link make the event usable." },
      { title: "Keep the scope clean", detail: "Calendar entries identify the assessment without exposing unnecessary clinical detail." },
      { title: "Begin deliberately", detail: "Begin assessment records who started the interview and when clinical entry became active." },
    ],
  },
  {
    id: "assessment",
    label: "Assessment",
    title: "Complete the assessment in the interview",
    summary: "Use the questionnaire to verify what carried forward, ask the direct questions, and document only what the interview and named sources support.",
    owner: "Assigned assessor; supervisors retain authorized access",
    rule: "Every opened follow-up must be answered or left visibly awaiting confirmation before signature.",
    icon: ClipboardCheck,
    points: assessmentPracticeRules,
  },
  {
    id: "complete",
    label: "Complete",
    title: "Completion creates the chart",
    summary: "The assessor resolves required gaps, confirms the saved draft, and deliberately signs the completed assessment.",
    owner: "Assigned assessor",
    rule: "The client chart is derived from the signed assessment; it is not another place to re-enter the same facts.",
    icon: UserCheck,
    points: [
      { title: "Check completeness", detail: "Missing required information is named before signature, with no artificial work items." },
      { title: "Sign once ready", detail: "Signature establishes the accountable assessment version used for review." },
      { title: "Keep provenance", detail: "Corrections, sources, timestamps, and authors remain traceable after completion." },
    ],
  },
  {
    id: "handoff",
    label: "Review",
    title: "Review closes the referral loop",
    summary: "The supervisor reviews the signed assessment and its concise client view before recording or communicating an authorized outcome.",
    owner: "Supervisor",
    rule: "Reports measure events already recorded by the workflow; they do not invent stages, ownership, or outcomes.",
    icon: ShieldCheck,
    points: [
      { title: "Review the source", detail: "Open the workspace, signed assessment, chart, and supporting files as one connected record." },
      { title: "Resolve exceptions", detail: "Return incomplete or conflicting information to the accountable assessor with a clear reason." },
      { title: "Handoff deliberately", detail: "Meet the Client and packet delivery remain human-reviewed, minimum-necessary actions." },
    ],
  },
];

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function FullWorkflowWalkthroughPreview({
  onClose,
  onStartGuide,
}: {
  onClose: () => void;
  onStartGuide?: () => void;
}) {
  const mounted = useSyncExternalStore(subscribeToClient, getClientSnapshot, getServerSnapshot);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showTransition, setShowTransition] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  if (!mounted) return null;

  const concept = concepts[activeIndex];
  const ConceptIcon = concept.icon;
  const finalConcept = activeIndex === concepts.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[140] bg-white">
      <section role="dialog" aria-modal="true" aria-label="Full Pipeline walkthrough" className="flex h-dvh min-h-0 flex-col bg-white text-[#1d2421]">
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-[#d5ddda] px-4 py-3 sm:px-7">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase text-[#0f7c68]">{showTransition ? "Concepts complete" : "Workflow concepts"}</div>
            <h2 className="mt-1 truncate text-[20px] font-black sm:text-[24px]">{showTransition ? "From concepts to the real workflow" : "How Pipeline moves a referral"}</h2>
          </div>
          <button type="button" aria-label="Close full walkthrough" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center border border-[#cbd5d1] text-[#56615c] hover:border-[#0f8b73] hover:text-[#0f7c68]">
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid min-h-full w-full max-w-[1440px] lg:grid-cols-[270px_minmax(0,1fr)]">
            <nav aria-label="Workflow concepts" className="border-b border-[#d5ddda] bg-[#fafcfb] p-3 lg:border-b-0 lg:border-r lg:p-6">
              <ol className="grid grid-cols-3 gap-1 sm:grid-cols-6 lg:block lg:space-y-1">
                {concepts.map((item, index) => {
                  const Icon = item.icon;
                  const active = index === activeIndex;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-current={active ? "step" : undefined}
                        aria-label={`Show concept ${index + 1}: ${item.label}`}
                        onClick={() => {
                          setActiveIndex(index);
                          setShowTransition(false);
                        }}
                        className={`flex min-h-12 w-full items-center justify-center gap-2 border-l-2 px-2 text-[10px] font-black sm:px-3 lg:min-h-14 lg:justify-start lg:text-[12px] ${active ? "border-[#0f8b73] bg-[#eaf5f1] text-[#0c705f]" : "border-transparent text-[#66716d] hover:bg-white hover:text-[#1f2824]"}`}
                      >
                        <Icon size={16} className="hidden shrink-0 sm:block" aria-hidden="true" />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <main className="min-w-0 px-5 py-8 sm:px-10 sm:py-12 lg:px-16 lg:py-14 xl:px-20">
              {showTransition ? (
                <div className="mx-auto max-w-[940px]">
                  <div className="flex h-14 w-14 items-center justify-center bg-[#eaf5f1] text-[#0f7c68]">
                    <MousePointerClick size={26} aria-hidden="true" />
                  </div>
                  <div className="mt-7 text-[10px] font-black uppercase text-[#0f7c68]">Up next</div>
                  <h3 className="mt-2 max-w-[760px] text-[32px] font-black leading-[38px] sm:text-[44px] sm:leading-[50px]">Follow the workflow where it happens.</h3>
                  <p className="mt-4 max-w-[790px] text-[16px] font-medium leading-7 text-[#5e6a65] sm:text-[18px]">
                    You have the operating model. The guided tour now opens the real Pipeline pages and points to the controls that move a referral forward.
                  </p>

                  <div className="mt-9 grid gap-7 border-y border-[#d7dfdc] py-7 sm:grid-cols-2 sm:gap-10">
                    <section aria-labelledby="bridge-carries-forward">
                      <h4 id="bridge-carries-forward" className="text-[11px] font-black uppercase text-[#0f7c68]">What carries forward</h4>
                      <p className="mt-3 text-[16px] font-black leading-6 text-[#26302c]">One workspace. One accountable assessor. Source-backed information.</p>
                    </section>
                    <section aria-labelledby="bridge-changes-now">
                      <h4 id="bridge-changes-now" className="text-[11px] font-black uppercase text-[#0f7c68]">What changes now</h4>
                      <p className="mt-3 text-[16px] font-black leading-6 text-[#26302c]">You will move through live screens while the spotlight shows the next control.</p>
                    </section>
                  </div>

                  <ol className="mt-3">
                    {[
                      ["Look", "The tour opens the page where each part of the work belongs."],
                      ["Follow", "A spotlight and short instruction identify the next useful action."],
                      ["Move on", "Skip any step when you only need orientation. Pipeline never submits, signs, sends, schedules, or exports on your behalf."],
                    ].map(([title, detail], index) => (
                      <li key={title} className="grid gap-2 border-b border-[#e0e6e3] py-5 sm:grid-cols-[42px_180px_minmax(0,1fr)] sm:items-start sm:gap-5">
                        <span className="text-[11px] font-black tabular-nums text-[#0f7c68]">{String(index + 1).padStart(2, "0")}</span>
                        <strong className="text-[15px] font-black leading-5 text-[#28312d]">{title}</strong>
                        <span className="text-[14px] font-medium leading-6 text-[#66716d]">{detail}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div className="mx-auto max-w-[940px]">
                  <div className="flex h-14 w-14 items-center justify-center bg-[#eaf5f1] text-[#0f7c68]">
                    <ConceptIcon size={26} aria-hidden="true" />
                  </div>
                  <div className="mt-7 text-[10px] font-black uppercase text-[#0f7c68]">Concept {activeIndex + 1} of {concepts.length}</div>
                  <h3 className="mt-2 max-w-[760px] text-[32px] font-black leading-[38px] sm:text-[44px] sm:leading-[50px]">{concept.title}</h3>
                  <p className="mt-4 max-w-[760px] text-[16px] font-medium leading-7 text-[#5e6a65] sm:text-[18px]">{concept.summary}</p>

                  <dl className="mt-8 grid gap-5 border-y border-[#d7dfdc] py-6 sm:grid-cols-2 sm:gap-8">
                    <div>
                      <dt className="text-[10px] font-black uppercase text-[#65716c]">Who owns it</dt>
                      <dd className="mt-2 text-[14px] font-bold leading-6 text-[#26302c]">{concept.owner}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-black uppercase text-[#65716c]">System rule</dt>
                      <dd className="mt-2 text-[14px] font-bold leading-6 text-[#26302c]">{concept.rule}</dd>
                    </div>
                  </dl>

                  <ol className="mt-3">
                    {concept.points.map((point, index) => (
                      <li key={point.title} className="grid gap-2 border-b border-[#e0e6e3] py-5 sm:grid-cols-[42px_180px_minmax(0,1fr)] sm:items-start sm:gap-5">
                        <span className="text-[11px] font-black tabular-nums text-[#0f7c68]">{String(index + 1).padStart(2, "0")}</span>
                        <strong className="text-[15px] font-black leading-5 text-[#28312d]">{point.title}</strong>
                        <span className="text-[14px] font-medium leading-6 text-[#66716d]">{point.detail}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </main>
          </div>
        </div>

        <footer className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-t border-[#cfd8d4] bg-white px-4 py-3 sm:px-7">
          <button type="button" disabled={!showTransition && activeIndex === 0} onClick={() => {
            if (showTransition) {
              setShowTransition(false);
              return;
            }
            setActiveIndex((current) => Math.max(0, current - 1));
          }} className="flex h-11 items-center gap-2 px-2 text-[12px] font-black text-[#5e6964] disabled:invisible">
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
          {showTransition ? (
            <button type="button" onClick={onStartGuide ?? onClose} className="flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[12px] font-black text-white hover:bg-[#0b715e]">
              {onStartGuide ? "Start guided tour" : "Finish"} <ArrowRight size={15} aria-hidden="true" />
            </button>
          ) : finalConcept ? (
            <button type="button" onClick={() => setShowTransition(true)} className="flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[12px] font-black text-white hover:bg-[#0b715e]">
              Continue <ArrowRight size={15} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={() => setActiveIndex((current) => Math.min(concepts.length - 1, current + 1))} className="flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[12px] font-black text-white hover:bg-[#0b715e]">
              Next concept <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
