export type AcademyTrackId =
  | "foundations"
  | "product"
  | "frontend"
  | "api-domain"
  | "data"
  | "documents-ai"
  | "clinical"
  | "security"
  | "reliability"
  | "ownership";

export type AcademyLevel = "foundation" | "practitioner" | "advanced" | "owner";

export type AcademyActivityKind =
  | "learn"
  | "source-trace"
  | "lab"
  | "knowledge-check";

export type AcademyCheck = {
  prompt: string;
  options: readonly [string, string, string];
  answer: 0 | 1 | 2;
  explanation: string;
};

export type AcademySourceRef = {
  path: string;
  purpose: string;
};

export type AcademyLab = {
  title: string;
  scenario: string;
  instructions: readonly string[];
  evidencePrompt: string;
  acceptanceCriteria: readonly string[];
  commands?: readonly string[];
};

export type AcademyModuleDefinition = {
  id: string;
  trackId: AcademyTrackId;
  number: number;
  level: AcademyLevel;
  title: string;
  summary: string;
  minutes: number;
  prerequisites: readonly string[];
  objectives: readonly string[];
  concepts: readonly string[];
  sources: readonly AcademySourceRef[];
  trace: readonly string[];
  lab: AcademyLab;
  check: AcademyCheck;
};

export type AcademyTrack = {
  id: AcademyTrackId;
  number: number;
  title: string;
  shortTitle: string;
  summary: string;
  outcome: string;
};

export type AcademyActivity = {
  id: string;
  moduleId: string;
  kind: AcademyActivityKind;
  title: string;
  minutes: number;
  summary: string;
  instructions: readonly string[];
  sources: readonly AcademySourceRef[];
  evidencePrompt?: string;
  acceptanceCriteria?: readonly string[];
  commands?: readonly string[];
  check?: AcademyCheck;
};

export type AcademyModule = AcademyModuleDefinition & {
  activities: readonly AcademyActivity[];
};

export type AcademyJourneyStep = {
  label: string;
  owner: string;
  runtime: "Browser" | "Next.js" | "PostgreSQL" | "Blob" | "Worker" | "External" | "Tooling";
  source: string;
  invariant: string;
};

export type AcademyJourney = {
  id: string;
  title: string;
  trigger: string;
  outcome: string;
  failureQuestion: string;
  moduleIds: readonly string[];
  steps: readonly AcademyJourneyStep[];
};

export type AcademyCompetency = {
  id: string;
  title: string;
  standard: string;
  proof: readonly string[];
  moduleIds: readonly string[];
};

export type AcademyAtlasRisk = "critical" | "high" | "standard";
export type AcademyAtlasRuntime =
  | "browser"
  | "next-server"
  | "postgres"
  | "worker"
  | "tooling"
  | "documentation"
  | "shared";

export type AcademyAtlasEntry = {
  path: string;
  subsystem: string;
  kind: string;
  runtime: AcademyAtlasRuntime;
  risk: AcademyAtlasRisk;
  lines: number;
  moduleIds: string[];
};

export type AcademyAtlas = {
  schemaVersion: 1;
  generatedAt: string;
  fingerprint: string;
  totals: {
    files: number;
    lines: number;
    coveredFiles: number;
  };
  entries: AcademyAtlasEntry[];
};
