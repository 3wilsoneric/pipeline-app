"use client";

import { ArrowLeft, ArrowRight, Check, FileText, LocateFixed, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import AssessmentWorkspace from "@/components/pipeline/AssessmentWorkspace";
import { ChartSection, EditablePacketField, initialFields } from "@/components/pipeline/ReferralPacketCanvas";
import { ReferralLifecycleBoard } from "@/components/pipeline/ReferralWorkflowTracker";
import { DecisionCard } from "@/components/pipeline/ReferralWorkflowPanelPresentation";
import ReferralAdmissionPanel from "@/components/pipeline/ReferralAdmissionPanel";
import ReferralDocumentUpload from "@/components/pipeline/ReferralDocumentUpload";
import { CompleteAssessmentChart, HandoffClinicalSummary } from "@/components/pipeline/AssessmentChartWorkspace";
import { PipelineShellProvider, usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { buildAssessmentSummaryReport } from "@/lib/assessment/assessment-summary";
import { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";
import { ageFromCalendarDate } from "@/lib/pipeline/calendar-date";
import { pipelineCommunities } from "@/lib/pipeline/community-config";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import type { LabeledReferralFile } from "@/lib/pipeline/referral-document-labels";
import type { AssessmentRecommendation, Referral, ReferralCanvasFieldKey } from "@/lib/pipeline/referral-types";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { createTutorialReferral, prepareTutorialStep, tutorialBoardItem, tutorialDecision, tutorialReferralSteps, tutorialStepHelp, tutorialStepInstruction, tutorialWorkflow, type TutorialReferral } from "@/lib/training/tutorial-referral";
import styles from "./TutorialReferralPractice.module.css";

export default function TutorialReferralPractice({ initialStep, returnTo }: { initialStep: number; returnTo?: string }) {
  const [step, setStep] = useState(initialStep);
  const [state, setState] = useState(() => prepareTutorialStep(createTutorialReferral(), initialStep));
  const current = useRef(state);
  const [files, setFiles] = useState<LabeledReferralFile[]>([]);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sampleNotice, setSampleNotice] = useState(initialStep > 2 ? "Earlier steps use sample information." : "");
  const page = useRef<HTMLDivElement>(null);
  const help = useRef<HTMLDetailsElement>(null);
  const shell = usePipelineShell();
  const { beforeNavigationRef } = shell;
  const instruction = tutorialReferralSteps[step];

  const change = useCallback((update: (value: TutorialReferral) => TutorialReferral) => {
    current.current = update(current.current);
    setState(current.current);
  }, []);
  const onAssessmentChange = useCallback((assessment: PipelineAssessmentRecord, action?: "scheduled") => {
    change((value) => action === "scheduled" ? prepareTutorialStep({ ...value, assessment }, 3) : { ...value, assessment });
    if (action === "scheduled") { setStep(3); setSampleNotice(""); }
  }, [change]);
  const updateReferral = (patch: Partial<Referral>) => change((value) => ({ ...value, referral: { ...value.referral, ...patch }, assessment: {
    ...value.assessment,
    ...(patch.name !== undefined ? { resident_name: patch.name } : {}),
    ...(patch.dob !== undefined ? { date_of_birth: patch.dob } : {}),
    ...(patch.community !== undefined ? { community: patch.community } : {}),
    ...(patch.currentMedications !== undefined ? { medications_at_intake: patch.currentMedications.split("\n").map((line) => line.trim()).filter(Boolean) } : {}),
  } }));

  async function moveTo(next: number) {
    if (busy) return;
    setBusy(true);
    try {
      await beforeNavigationRef.current?.();
      const previous = current.current;
      const prepared = prepareTutorialStep(previous, next);
      const supplied = [
        [previous.assessment.scheduled_start_at, prepared.assessment.scheduled_start_at],
        [previous.assessment.signed_at, prepared.assessment.signed_at],
        [previous.referral.admissionDecision, prepared.referral.admissionDecision],
        [previous.referral.plannedAdmissionDate, prepared.referral.plannedAdmissionDate],
      ].some(([before, after]) => !before && Boolean(after));
      change(() => prepared);
      setStep(next);
      setError("");
      setSampleNotice(supplied ? "Skipped actions use sample information. Your edits are kept." : "");
      page.current?.scrollTo({ top: 0 });
    } catch {
      setError("The sample edit could not be kept. Try again, or restart the tutorial.");
    } finally { setBusy(false); }
  }

  function close() {
    // Only return to this application's main workspace, never an external URL.
    const destination = returnTo?.startsWith("/?") || returnTo === "/" ? returnTo : "/";
    window.location.assign(toPipelinePath(destination));
  }

  async function restart() {
    if (busy) return;
    setBusy(true);
    try {
      await beforeNavigationRef.current?.();
      change(() => createTutorialReferral());
      setFiles([]); setStep(0); setGeneration((value) => value + 1); setSampleNotice(""); setError("");
    } finally { setBusy(false); }
  }

  function finishSigning() {
    // The assessment calls this only after it has flushed and signed the sample.
    setStep(5); setSampleNotice(""); setError("");
    page.current?.scrollTo({ top: 0 });
  }

  const target = () => findTutorialTarget(page.current?.parentElement, instruction.target);
  function locate() {
    const element = target();
    if (!element) { setError("The control is not visible. Check the open help for this step."); if (help.current) help.current.open = true; return; }
    if (instruction.target === "assessment-schedule-fields" && element.matches('[data-guide-target~="assessment-schedule-open"]')) setError("Scheduling is closed. Select Schedule interview to reopen it.");
    else if (instruction.target === "home-board-card" && element.matches('[data-guide-target="home-board-stage"]')) {
      const stage = tutorialBoardItem(state).board.stage;
      setError(`Choose ${stage === "decision" ? "Decision" : stage === "received" ? "Referral received" : "In progress"} in Referral stage to show the card.`);
    } else setError("");
    focusTutorialTarget(element);
  }

  useEffect(() => {
    let highlighted: HTMLElement | null = null;
    const highlight = () => {
      const element = findTutorialTarget(page.current?.parentElement, tutorialReferralSteps[step].target);
      if (element === highlighted) return;
      highlighted?.removeAttribute("data-tutorial-highlight");
      highlighted = element;
      highlighted?.setAttribute("data-tutorial-highlight", "true");
    };
    const observer = new MutationObserver(highlight);
    if (page.current?.parentElement) observer.observe(page.current.parentElement, { childList: true, subtree: true });
    highlight();
    return () => { observer.disconnect(); highlighted?.removeAttribute("data-tutorial-highlight"); };
  }, [step, generation]);

  const branchEnded = state.underReview || state.referral.admissionDecision?.outcome === "declined";
  const nextStep = (branchEnded || state.sentAt) && step === 5 ? 8 : step + 1;
  const navigation = (next: number) => void moveTo(next);
  return <PipelineShellProvider value={{ ...shell, contentRef: page }}><section className={styles.session} aria-label="Fictional referral tutorial" data-testid="tutorial-referral-session">
    <header className={styles.header}>
      <div><strong>Referral walkthrough</strong><span>Fictional client. Nothing saved or sent to Pipeline.</span></div>
      <div className={styles.tools}>
        <button type="button" onClick={() => void restart().catch(() => setError("Restart failed. Try again."))} disabled={busy} aria-label="Restart tutorial" title="Restart with the original sample"><RotateCcw size={19} /></button>
        <button type="button" onClick={close} aria-label="Close tutorial" title="Return to your work"><X size={22} /></button>
      </div>
    </header>
    <div className={styles.layout}>
      <aside className={styles.guide} aria-label="Tutorial steps" data-testid="guided-coach-panel">
        <label htmlFor="tutorial-step">Step {step + 1} of {tutorialReferralSteps.length}</label>
        <details key={step} ref={help} className={styles.help}><summary>Stuck on this step?</summary><dl>{tutorialStepHelp(state, step).map(({ problem, action }) => <div key={problem}><dt>{problem}</dt><dd>{action}</dd></div>)}</dl></details>
        <select id="tutorial-step" value={step} disabled={busy} onChange={(event) => navigation(Number(event.target.value))}>
          {tutorialReferralSteps.map((item, index) => <option key={item.title} value={index}>{index + 1}. {item.title}</option>)}
        </select>
        <div className={styles.instruction} aria-live="polite" aria-atomic="true"><h1 className="sr-only">{instruction.title}</h1><p>{tutorialStepInstruction(state, step)}</p></div>
        <button type="button" onClick={locate} className={styles.locate}><LocateFixed size={16} />Show me where</button>
        {sampleNotice ? <p className={styles.notice}>{sampleNotice}</p> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <footer className={styles.navigation} role="navigation" aria-label="Tutorial navigation">
          <button type="button" className={styles.previous} onClick={() => navigation(step - 1)} disabled={step === 0 || busy} aria-label="Previous tutorial step" title="Previous tutorial step"><ArrowLeft size={18} /></button>
          <button type="button" className={styles.next} onClick={() => step === 8 ? close() : navigation(nextStep)} disabled={busy}>{step === 8 ? "Return to work" : `Next: ${tutorialReferralSteps[nextStep].title}`}<ArrowRight size={18} /></button>
        </footer>
      </aside>
      <div className={styles.page} key={`page-${generation}`}><div ref={page} className={styles.preview}>
        <TutorialStepContent step={step} generation={generation} state={state} files={files} onFiles={setFiles} onChange={change} onReferralChange={updateReferral} onAssessmentChange={onAssessmentChange} onSigned={finishSigning} navigate={navigation} />
      </div></div>
    </div>
  </section></PipelineShellProvider>;
}

function findTutorialTarget(root: HTMLElement | null | undefined, target: string) {
  const visible = (selector: string) => Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? []).find((element) => element.getClientRects().length > 0) ?? null;
  return visible(`[data-guide-target~="${target}"]`)
    ?? (target === "assessment-schedule-fields" ? visible('[data-guide-target~="assessment-schedule-open"]') : null)
    ?? (target === "assessment-section-nav" ? visible('select[aria-label="Assessment section"]') : null)
    ?? (target === "home-board-card" ? visible('[data-guide-target="home-board-stage"]') : null);
}

function focusTutorialTarget(element: HTMLElement) {
  element.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  const control = element.matches("button,input,select,textarea") ? element : element.querySelector<HTMLElement>("button,input,select,textarea");
  if (control) { control.focus({ preventScroll: true }); return; }
  if (!element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
    element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
  }
  element.focus({ preventScroll: true });
}

function TutorialStepContent({ step, generation, state, files, onFiles, onChange, onReferralChange, onAssessmentChange, onSigned, navigate }: {
  step: number; generation: number; state: TutorialReferral; files: LabeledReferralFile[];
  onFiles: (files: LabeledReferralFile[]) => void; onChange: (update: (value: TutorialReferral) => TutorialReferral) => void;
  onReferralChange: (patch: Partial<Referral>) => void; onAssessmentChange: (assessment: PipelineAssessmentRecord, action?: "scheduled") => void; onSigned: () => void; navigate: (step: number) => void;
}) {
  const { beforeNavigationRef } = usePipelineShell();
  if (step === 0 || step === 8) {
    const item = tutorialBoardItem(state);
    return <section className={styles.content} data-guide-target="tutorial-board"><h2>{step === 8 ? "Your updated board" : "My referrals"}</h2><ReferralLifecycleBoard key={step} items={[item]} initialStage={item.board.stage ?? "received"} showOwner={false} onOpenPacket={() => navigate(state.assessment.signed_at ? 5 : 3)} /></section>;
  }
  if (step === 1) return <TutorialIntake referral={state.referral} files={files} onFiles={onFiles} onChange={onReferralChange} onCreate={() => navigate(2)} />;
  if ([2, 3, 4].includes(step)) return <AssessmentWorkspace key={`${generation}-${step}`}
    trainingAssessmentMode={step === 2 ? "schedule" : "interview"}
    trainingAssessmentSection="functional_adl"
    initialTrainingAssessment={state.assessment} onTrainingAssessmentChange={onAssessmentChange} readOnly={Boolean(state.sentAt)}
    beforeWorkspaceNavigationRef={beforeNavigationRef}
    startQuestionnaire={step === 3} assessmentReview={step === 4} chartReview={step === 4}
    referral={state.referral} workspaceTitle={state.referral.name}
    onOpenWorkspace={() => navigate(1)} onReviewAssessment={() => navigate(4)}
    onOpenAssessment={() => navigate(3)} onContinueToWorkflow={onSigned} />;
  if (step === 5) return <TutorialDecision state={state} onChange={onChange} onContinue={() => navigate(6)} />;
  if (step === 6) return <TutorialPacket state={state} files={files} onSend={() => onChange((value) => {
    const sentAt = new Date().toISOString();
    return { ...value, sentAt, assessment: { ...value.assessment, meet_client_sent_at: sentAt } };
  })} onRecipientChange={(packetRecipient) => onChange((value) => ({ ...value, packetRecipient }))} onEdit={() => navigate(3)} />;
  return <TutorialAdmission state={state} onChange={onReferralChange} navigate={navigate} />;
}

function TutorialAdmission({ state, onChange, navigate }: { state: TutorialReferral; onChange: (patch: Partial<Referral>) => void; navigate: (step: number) => void }) {
  return <section className={styles.content} data-guide-target="tutorial-admission"><h2>Client handoff</h2>{state.underReview || state.referral.admissionDecision?.outcome === "declined" ? <p>No admission is needed for this outcome.</p> : <ReferralAdmissionPanel referral={state.referral} packetSentAt={state.sentAt} admissionDate={state.referral.plannedAdmissionDate ?? ""} disabled={false} onAdmissionDateChange={(plannedAdmissionDate) => onChange({ plannedAdmissionDate })} onSaveAdmissionDate={() => navigate(6)} />}</section>;
}

const intakeGroups: { title: string; target: string; keys: ReferralCanvasFieldKey[] }[] = [
  { title: "Client information", target: "intake-identity", keys: ["name", "dob", "gender"] },
  { title: "Referral details", target: "intake-routing", keys: ["owner", "community", "referent", "phone", "email"] },
];
const referralField = { referent: "source", summary: "note" } as const;

function TutorialIntake({ referral, files, onFiles, onChange, onCreate }: { referral: Referral; files: LabeledReferralFile[]; onFiles: (files: LabeledReferralFile[]) => void; onChange: (patch: Partial<Referral>) => void; onCreate: () => void }) {
  return <div className={styles.content}>
    <div className={styles.pageHeading}><h2>{referral.name}</h2><button type="button" className={styles.action} onClick={onCreate}>Create referral<ArrowRight size={16} /></button></div>
    <details className={styles.documents} open><summary>Referral documents</summary>
      <SampleFiles referral={referral} />
      <ReferralDocumentUpload queued={files} files={[]} filesLoading={false} filesError="" onRetryFiles={() => undefined} onAdd={(added) => onFiles([...files, ...added])} onRemove={(file) => onFiles(files.filter((item) => item.file !== file))} uploading={false} />
    </details>
    {intakeGroups.map((group) => <div key={group.title} data-guide-target={group.target}><ChartSection title={group.title} complete={group.keys.filter((key) => Boolean(referral[(referralField as Record<string, keyof Referral>)[key] ?? key as keyof Referral])).length} total={group.keys.length}>
      <div className={styles.fields}>{group.keys.map((key) => {
        const property = (referralField as Record<string, keyof Referral>)[key] ?? key as keyof Referral;
        return <EditablePacketField key={key} fieldKey={key} field={{ ...initialFields[key], label: key === "owner" ? "Assessor" : initialFields[key].label, value: String(referral[property] ?? "") }}
          options={key === "owner" ? ["Practice assessor"] : key === "community" ? pipelineCommunities : key === "gender" ? ["Male", "Female", "Nonbinary", "Other"] : undefined}
          detail={key === "dob" ? `Age ${ageFromCalendarDate(referral.dob) ?? "not known"}` : undefined} onFocus={() => undefined} onChange={(value) => onChange({ [property]: value })} />;
      })}</div>
    </ChartSection></div>)}
    <div className={styles.notes}>{(["note", "currentMedications"] as const).map((key) => <label key={key}>{key === "note" ? "Referral summary" : "Current medications"}<textarea rows={4} value={referral[key]} onChange={(event) => onChange({ [key]: event.target.value })} /></label>)}</div>
    <p role="status" className={styles.saved}><Check size={16} />Sample changes kept in this tutorial</p>
  </div>;
}

function SampleFiles({ referral }: { referral: Referral }) {
  return <div className={styles.sampleFiles}>
    <details><summary><FileText size={18} />Sample face sheet</summary><dl><dt>Client</dt><dd>{referral.name}</dd><dt>Date of birth</dt><dd>{referral.dob}</dd><dt>Requested community</dt><dd>{referral.community}</dd><dt>Source</dt><dd>{referral.source}</dd></dl></details>
    <details><summary><FileText size={18} />Sample medication list</summary><p>{referral.currentMedications || "No medications recorded."}</p></details>
    <details><summary><FileText size={18} />Sample referral summary</summary><p>{referral.note}</p></details>
  </div>;
}

function TutorialDecision({ state, onChange, onContinue }: { state: TutorialReferral; onChange: (update: (value: TutorialReferral) => TutorialReferral) => void; onContinue: () => void }) {
  const [recommendation, setRecommendation] = useState<{ outcome: AssessmentRecommendation["outcome"] | ""; reasonCode: string; reasonNote: string }>({ outcome: state.underReview ? "needs_more_information" : "", reasonCode: "", reasonNote: "" });
  return <section className={styles.content} data-guide-target="tutorial-decision"><h2>Decision for {state.referral.name}</h2>
    <DecisionCard workflow={tutorialWorkflow(state)} busy="" recommendation={recommendation} onRecommendationChange={(patch) => setRecommendation((value) => ({ ...value, ...patch }))} onSubmitDecision={() => onChange((value) => ({ ...value, underReview: recommendation.outcome === "needs_more_information", referral: { ...value.referral, admissionDecision: recommendation.outcome === "needs_more_information" ? undefined : tutorialDecision(value, recommendation.outcome === "decline" ? "declined" : "accepted", recommendation.reasonNote) } }))} />
    {state.referral.admissionDecision?.outcome === "accepted" ? <div className={styles.admissionDate}><label htmlFor="tutorial-admit-date">Planned admission date<input id="tutorial-admit-date" type="date" value={state.referral.plannedAdmissionDate ?? ""} onChange={(event) => onChange((value) => ({ ...value, referral: { ...value.referral, plannedAdmissionDate: event.target.value } }))} /></label><button type="button" onClick={onContinue} className={styles.action}>Review email &amp; packet<ArrowRight size={17} /></button></div> : null}
    {state.referral.admissionDecision && !state.sentAt && !state.referral.actualAdmissionDate ? <button type="button" onClick={() => onChange((value) => ({ ...value, referral: { ...value.referral, admissionDecision: undefined } }))} className={styles.textButton}>Change sample decision</button> : null}
  </section>;
}

const packetViews = ["summary", "chart", "files"] as const;

function TutorialPacket({ state, files, onSend, onEdit, onRecipientChange }: { state: TutorialReferral; files: LabeledReferralFile[]; onSend: () => void; onEdit: () => void; onRecipientChange: (value: string) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [view, setView] = useState<"summary" | "chart" | "files">("summary");
  const report = buildAssessmentSummaryReport(state.assessment, state.referral);
  const email = renderMeetClientEmail(report.meetClient, "Practice assessor", "tutorial-only", ["Sample face sheet", "Sample medication list", "Assessment chart"], undefined, { logoUrl: "/brand/alamo-health-management.png" });
  if (state.underReview || state.referral.admissionDecision?.outcome === "declined") return <section className={styles.content} data-guide-target="tutorial-packet"><h2>No admission packet</h2><p>This referral is {state.underReview ? "under review" : "denied"}. Return to Decision to try acceptance.</p></section>;
  return <section className={styles.content}>
    <div className={styles.pageHeading}><h2>Email &amp; packet</h2><button type="button" className={styles.textButton} onClick={onEdit}>{state.sentAt ? "View assessment" : "Edit assessment"}</button></div>
    <label className={styles.recipient}>To<input data-guide-target="tutorial-packet" type="email" value={state.packetRecipient} readOnly={Boolean(state.sentAt)} onChange={(event) => { onRecipientChange(event.target.value); setConfirmed(false); }} /></label>
    <p className={styles.subject}>Meet the Client: {state.referral.name}</p>
    <div className={styles.tabs} role="tablist" aria-label="Packet preview" onKeyDown={(event) => {
      const index = packetViews.indexOf(view);
      const next = ({ ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 } as Record<string, number>)[event.key];
      if (next === undefined) return;
      event.preventDefault(); setView(packetViews[next]);
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    }}>{packetViews.map((tab) => <button type="button" key={tab} id={`sample-packet-tab-${tab}`} role="tab" aria-selected={view === tab} aria-controls="sample-packet-panel" tabIndex={view === tab ? 0 : -1} onClick={() => setView(tab)}>{({ summary: "Meet the Client", chart: "Assessment chart", files: "Files" })[tab]}</button>)}</div>
    <div role="tabpanel" id="sample-packet-panel" aria-labelledby={`sample-packet-tab-${view}`} tabIndex={0}>
      {view === "summary" ? <><iframe title="Sample Meet the Client email" srcDoc={email.html} sandbox="" referrerPolicy="no-referrer" className={styles.email} /><HandoffClinicalSummary report={report} /></> : null}
      {view === "chart" ? <CompleteAssessmentChart report={report} /> : null}
      {view === "files" ? <><SampleFiles referral={state.referral} /><ul>{files.map((item, index) => <li key={index}>{item.file.name}</li>)}</ul></> : null}
    </div>
    <p className={styles.outlookNote}>In a real workspace, preview the handoff, confirm recipients and the admission date, then use the available email option. Check its status before retrying.</p>
    <footer className={styles.send}>
      {state.sentAt ? <p role="status"><Check size={17} />Simulated send complete. No email was sent.</p> : <>{!state.referral.plannedAdmissionDate ? <p role="status">Add a planned admission date in Decision before simulating send. You can still preview the packet now.</p> : null}<label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Recipients checked</label><button type="button" className={styles.action} disabled={!state.referral.plannedAdmissionDate || !confirmed || !state.packetRecipient.trim()} onClick={onSend}>Simulate send<ArrowRight size={17} /></button></>}
    </footer>
  </section>;
}
