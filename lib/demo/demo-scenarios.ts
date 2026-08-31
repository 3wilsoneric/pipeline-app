import type { AssessmentToolData } from "@/lib/assessment/assessment-tool-schema";
import type { PipelineCommunity } from "@/lib/pipeline/community-config";

export const pipelineDemoScenarioVersion = "pipeline-demo-v1";
export const pipelineDemoTag = "pipeline-demo";

export type PipelineDemoScenarioId =
  | "new-intake"
  | "assessment-preparation"
  | "assessment-interview"
  | "assessment-complex";

export type PipelineDemoScenario = {
  id: PipelineDemoScenarioId;
  sequence: number;
  title: string;
  phase: string;
  duration: string;
  summary: string;
  community: PipelineCommunity;
  launch: "new_referral" | "assessment";
  assessmentState?: "unscheduled" | "in_progress";
  assessmentData?: Partial<AssessmentToolData>;
};

export const pipelineDemoScenarios: readonly PipelineDemoScenario[] = [
  {
    id: "new-intake",
    sequence: 1,
    title: "New referral",
    phase: "Intake",
    duration: "5-8 min",
    summary: "Blank referral for practicing packet intake and required fields.",
    community: "San Pablo",
    launch: "new_referral",
  },
  {
    id: "assessment-preparation",
    sequence: 2,
    title: "Assessment preparation",
    phase: "Pre-assessment",
    duration: "5-10 min",
    summary: "Assigned referral with an unscheduled assessment and intake medication context.",
    community: "Santa Clarita",
    launch: "assessment",
    assessmentState: "unscheduled",
  },
  {
    id: "assessment-interview",
    sequence: 3,
    title: "Assessment interview",
    phase: "Assessment",
    duration: "20-30 min",
    summary: "Scheduled assessment opened in interview mode with every section available.",
    community: "Turlock",
    launch: "assessment",
    assessmentState: "in_progress",
  },
  {
    id: "assessment-complex",
    sequence: 4,
    title: "Conflicting information",
    phase: "Assessment exception",
    duration: "15-20 min",
    summary: "Assessment with conflicting client, collateral, and record statements.",
    community: "Victoria's House",
    launch: "assessment",
    assessmentState: "in_progress",
    assessmentData: {
      current_symptoms: "During this synthetic interview, the client reports sleeping well and denies current distress. The synthetic referral record describes disrupted sleep two weeks earlier; current frequency is not yet verified with collateral.",
      cognition_orientation: "The client is oriented to person, place, date, and situation during the synthetic interview. Responses are linear. Remote history is incomplete and requires record verification.",
      behavioral_history: "The synthetic packet describes verbal escalation during an earlier placement. The client reports no recent episodes. Exact date, trigger, and outcome remain to be confirmed with the referring team.",
      triggers: "Crowded common areas are reported by the client as a possible trigger. Frequency, observable warning signs, and effective staff response are not yet confirmed.",
      family_involvement: "The client identifies one family support but has not confirmed current contact frequency or permission to involve that person in planning.",
      additional_information: "Synthetic exercise only. The assessor must preserve source differences and identify the next verification action.",
    },
  },
] as const;

export function getPipelineDemoScenario(id: string) {
  return pipelineDemoScenarios.find((scenario) => scenario.id === id) ?? null;
}

export function buildPipelineDemoReferral(
  scenario: PipelineDemoScenario,
  actorName: string,
  now = new Date(),
) {
  const timestamp = now.toISOString();
  const suffix = timestamp.replace(/[-:.TZ]/g, "").slice(0, 14);
  return {
    name: `Synthetic ${scenario.phase} ${suffix}`,
    date: timestamp.slice(0, 10),
    stage: "New" as const,
    community: scenario.community,
    county: scenario.community === "Santa Clarita" ? "Los Angeles" : "Synthetic County",
    source: "Synthetic county referral email",
    priority: scenario.id === "assessment-complex" ? "high" as const : "standard" as const,
    tags: [pipelineDemoTag, pipelineDemoScenarioVersion, scenario.id],
    documentName: `synthetic-${scenario.id}-packet.pdf`,
    documentStatus: scenario.launch === "assessment" ? "Reviewed" as const : "Missing" as const,
    owner: actorName,
    note: "Synthetic Pipeline demo record. Contains no PHI and must never be used for real care or placement decisions.",
    createdAt: timestamp,
    dob: "1988-02-14",
    gender: "Not specified for synthetic exercise",
    responsiblePerson: "Synthetic county coordinator",
    currentMedications: "Synthetic medication context supplied at intake; medication name, dose, route, and schedule require assessor verification.",
    requirements: [],
    phone: "",
    email: "",
    payer: "",
  };
}
