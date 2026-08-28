import type { PipelineActor, PipelineSyntheticRole } from "./pipeline-actors";
import { syntheticPipelineActor } from "./pipeline-actors";

export const productDemoScenarioVersion = "product-demo-v1";

export const productDemoCommunities = [
  "San Pablo",
  "Santa Clarita",
  "Turlock",
  "Victoria's House",
  "JC Wallace",
] as const;

export const productDemoStages = [
  "New",
  "Packet Needed",
  "Packet Review",
  "Assessment",
] as const;

export type ProductDemoPersona =
  | "operations_lead"
  | "intake_coordinator"
  | "assessor"
  | "executive_viewer";

export type ProductDemoActor = {
  actor: PipelineActor;
  persona: ProductDemoPersona;
};

export type ProductDemoCase = {
  sequence: number;
  community: (typeof productDemoCommunities)[number];
  targetStage: (typeof productDemoStages)[number];
  priority: "urgent" | "high" | "standard";
  receivedDate: string;
  month: string;
  county: string;
  source: string;
  documentStatus: "Missing" | "Uploaded" | "Reviewed";
  hasMedicationContext: boolean;
  assessor: PipelineActor;
  creator: PipelineActor;
  openAssessment: boolean;
  startAssessment: boolean;
};

export type ProductDemoScenario = {
  version: string;
  nonPhi: true;
  actors: ProductDemoActor[];
  operationsLeads: PipelineActor[];
  intakeCoordinators: PipelineActor[];
  assessors: PipelineActor[];
  executiveViewers: PipelineActor[];
  cases: ProductDemoCase[];
  months: string[];
};

const personaPlan: ReadonlyArray<{
  persona: ProductDemoPersona;
  role: PipelineSyntheticRole;
  count: number;
  indexStart: number;
}> = [
  { persona: "operations_lead", role: "admin", count: 5, indexStart: 2_000 },
  { persona: "intake_coordinator", role: "assessment_coordinator", count: 20, indexStart: 3_000 },
  { persona: "assessor", role: "reviewer", count: 60, indexStart: 4_000 },
  { persona: "executive_viewer", role: "viewer", count: 15, indexStart: 5_000 },
];

export function createProductDemoScenario(anchor = new Date()): ProductDemoScenario {
  const actors = personaPlan.flatMap(({ persona, role, count, indexStart }) => (
    Array.from({ length: count }, (_, index) => ({
      actor: syntheticPipelineActor(role, indexStart + index),
      persona,
    }))
  ));
  const byPersona = (persona: ProductDemoPersona) => actors
    .filter((entry) => entry.persona === persona)
    .map((entry) => entry.actor);
  const operationsLeads = byPersona("operations_lead");
  const intakeCoordinators = byPersona("intake_coordinator");
  const assessors = byPersona("assessor");
  const executiveViewers = byPersona("executive_viewer");
  const months = [0, -1, -2].map((offset) => monthKey(anchor, offset));
  const cases = Array.from({ length: 100 }, (_, index): ProductDemoCase => {
    const targetStage = stageForIndex(index);
    const monthOffset = index < 50 ? 0 : index < 80 ? -1 : -2;
    const creator = intakeCoordinators[index % intakeCoordinators.length];
    const assessor = assessors[index % assessors.length];
    if (!creator || !assessor) throw new Error("The product demo actor plan is incomplete.");

    return {
      sequence: index + 1,
      community: productDemoCommunities[index % productDemoCommunities.length],
      targetStage,
      priority: index % 10 === 0 ? "urgent" : index % 4 === 0 ? "high" : "standard",
      receivedDate: dateInMonth(anchor, monthOffset, (index % 24) + 1),
      month: monthKey(anchor, monthOffset),
      county: ["Los Angeles", "Contra Costa", "Stanislaus", "San Joaquin"][index % 4] ?? "Los Angeles",
      source: ["LA County email", "County referral portal", "Hospital discharge team"][index % 3] ?? "County referral portal",
      documentStatus: targetStage === "New" || targetStage === "Packet Needed"
        ? "Missing"
        : targetStage === "Packet Review"
          ? "Uploaded"
          : "Reviewed",
      hasMedicationContext: index % 5 !== 0,
      creator,
      assessor,
      openAssessment: targetStage === "Assessment" && index >= 88,
      startAssessment: targetStage === "Assessment" && index >= 92,
    };
  });

  return {
    version: productDemoScenarioVersion,
    nonPhi: true,
    actors,
    operationsLeads,
    intakeCoordinators,
    assessors,
    executiveViewers,
    cases,
    months,
  };
}

export function productDemoCaseInput(item: ProductDemoCase) {
  const number = String(item.sequence).padStart(3, "0");
  return {
    name: `Synthetic Referral ${number}`,
    date: item.receivedDate,
    stage: "New",
    community: item.community,
    county: item.county,
    source: item.source,
    priority: item.priority,
    tags: [
      "product-demo",
      productDemoScenarioVersion,
      item.community.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    ],
    documentName: item.documentStatus === "Missing" ? "packet-pending.pdf" : `synthetic-packet-${number}.pdf`,
    documentStatus: item.documentStatus,
    owner: item.assessor.name,
    note: "Synthetic product demonstration referral. Contains no PHI.",
    currentMedications: item.hasMedicationContext
      ? "Synthetic medication context available for assessment rehearsal."
      : "",
    dob: "1970-01-01",
    phone: "",
    email: "",
    payer: "",
  };
}

function stageForIndex(index: number): ProductDemoCase["targetStage"] {
  if (index < 10) return "New";
  if (index < 30) return "Packet Needed";
  if (index < 60) return "Packet Review";
  return "Assessment";
}

function monthKey(anchor: Date, monthOffset: number) {
  const date = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthOffset, 1));
  return date.toISOString().slice(0, 7);
}

function dateInMonth(anchor: Date, monthOffset: number, day: number) {
  const date = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthOffset, day));
  return date.toISOString().slice(0, 10);
}
