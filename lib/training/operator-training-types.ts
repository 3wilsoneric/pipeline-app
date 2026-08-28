export type OperatorRole = "admin" | "assessment_coordinator" | "reviewer" | "viewer";

export type OperatorTrainingTrackId =
  | "orientation"
  | "intake"
  | "documents"
  | "pre-assessment"
  | "assessment"
  | "decision"
  | "coordination"
  | "operations"
  | "recovery"
  | "certification";

export type OperatorTrainingLevel = "essential" | "role" | "advanced" | "lead";

export type OperatorActivityKind =
  | "briefing"
  | "guided-practice"
  | "scenario"
  | "knowledge-check";

export type OperatorTrainingCheck = {
  prompt: string;
  options: readonly [string, string, string];
  answer: 0 | 1 | 2;
  explanation: string;
};

export type OperatorProductLocation = {
  label: string;
  href: string;
  source: string;
};

export type OperatorPractice = {
  title: string;
  setup: string;
  steps: readonly string[];
  evidencePrompt: string;
  acceptanceCriteria: readonly string[];
};

export type OperatorModuleDefinition = {
  id: string;
  trackId: OperatorTrainingTrackId;
  number: number;
  level: OperatorTrainingLevel;
  title: string;
  summary: string;
  minutes: number;
  audiences: readonly OperatorRole[];
  prerequisites: readonly string[];
  objectives: readonly string[];
  criticalActions: readonly string[];
  neverDo: readonly string[];
  locations: readonly OperatorProductLocation[];
  practice: OperatorPractice;
  check: OperatorTrainingCheck;
};

export type OperatorTrainingTrack = {
  id: OperatorTrainingTrackId;
  number: number;
  title: string;
  shortTitle: string;
  summary: string;
  outcome: string;
};

export type OperatorActivity = {
  id: string;
  moduleId: string;
  kind: OperatorActivityKind;
  title: string;
  minutes: number;
  summary: string;
  instructions: readonly string[];
  locations: readonly OperatorProductLocation[];
  evidencePrompt?: string;
  acceptanceCriteria?: readonly string[];
  check?: OperatorTrainingCheck;
};

export type OperatorModule = OperatorModuleDefinition & {
  activities: readonly OperatorActivity[];
};

export type OperatorScenarioChoice = {
  label: string;
  safe: boolean;
  rationale: string;
};

export type OperatorScenario = {
  id: string;
  title: string;
  domain: string;
  risk: "routine" | "important" | "critical";
  prompt: string;
  context: readonly string[];
  audiences: readonly OperatorRole[];
  moduleIds: readonly string[];
  choices: readonly [OperatorScenarioChoice, OperatorScenarioChoice, OperatorScenarioChoice];
  debrief: readonly string[];
};

export type OperatorJobAid = {
  id: string;
  title: string;
  whenToUse: string;
  audiences: readonly OperatorRole[];
  location: OperatorProductLocation;
  steps: readonly string[];
  stopAndEscalate: readonly string[];
};

export type OperatorCapability = {
  id: string;
  title: string;
  purpose: string;
  owner: string;
  location: OperatorProductLocation;
  upstream: readonly string[];
  downstream: readonly string[];
  moduleIds: readonly string[];
};
