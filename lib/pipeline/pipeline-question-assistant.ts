import { fuzzyTokenMatches, normalizeSearchText, tokenizeSearchText } from "@/lib/pipeline/fuzzy-search";
import type { PipelineSiteScreen } from "@/lib/pipeline/site-search";

export type PipelineQuestionSearchMode =
  | "my_work"
  | "unassigned"
  | "ready_to_schedule"
  | "scheduled_assessments"
  | "files";

export type PipelineQuestionAction =
  | { type: "navigate"; label: string; screen: PipelineSiteScreen }
  | { type: "search"; label: string; mode: PipelineQuestionSearchMode };

export type PipelineQuestionIntent = {
  id: string;
  title: string;
  prompt: string;
  answer: string;
  steps: string[];
  action: PipelineQuestionAction;
};

export type PipelineQuestionInterpretation =
  | {
      kind: "answer";
      query: string;
      intent: PipelineQuestionIntent;
      alternatives: PipelineQuestionIntent[];
    }
  | {
      kind: "clarify";
      query: string;
      options: PipelineQuestionIntent[];
    }
  | {
      kind: "unsupported";
      query: string;
      options: PipelineQuestionIntent[];
    };

type SearchableIntent = PipelineQuestionIntent & {
  phrases: string[];
  keywords: string[];
};

const questionOpeners = /^(?:how|where|what|when|who|why|which|can|could|should|help|i need|i want|im trying|i am trying)\b/i;
const workflowVocabulary = new Set([
  "assessment",
  "assessor",
  "assign",
  "assigned",
  "calendar",
  "client",
  "complete",
  "document",
  "documents",
  "file",
  "files",
  "finish",
  "intake",
  "interview",
  "missing",
  "new",
  "owner",
  "profile",
  "profiles",
  "referral",
  "report",
  "reports",
  "schedule",
  "scheduled",
  "sign",
  "start",
  "upload",
  "workspace",
  "workspaces",
]);
const ignoredQuestionWords = new Set([
  "a",
  "about",
  "after",
  "an",
  "and",
  "are",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "help",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "please",
  "should",
  "the",
  "this",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

const intents: SearchableIntent[] = [
  intent({
    id: "create-referral",
    title: "Create a referral",
    prompt: "How do I create a referral?",
    answer: "Start a new referral with the initial referral document. The supervisor reviews the intake details, selects the destination community, and assigns one assessor before handing off the workspace.",
    steps: ["Open New referral.", "Upload the face sheet or referral packet and review the intake fields.", "Choose one assessor, then create the workspace."],
    action: { type: "navigate", label: "Start a new referral", screen: "packet" },
    phrases: ["create a referral", "start a referral", "new referral", "add a referral", "initial intake"],
    keywords: ["create", "new", "referral", "intake", "face", "sheet"],
  }),
  intent({
    id: "assign-assessor",
    title: "Assign an assessor",
    prompt: "How do I assign an assessor?",
    answer: "Open the referral workspace and use Routing and assignment in Intake. The selected assessor becomes the single owner used by the queue, calendar, permissions, and reporting.",
    steps: ["Open the referral workspace.", "Choose an assessor under Routing and assignment.", "Add a handoff note if you are changing an existing assignment."],
    action: { type: "navigate", label: "Open workspaces", screen: "referrals" },
    phrases: ["assign an assessor", "assign assessor", "change the assessor", "change owner", "reassign referral", "who owns"],
    keywords: ["assign", "assigned", "assessor", "owner", "reassign", "handoff"],
  }),
  intent({
    id: "find-my-work",
    title: "Find my assigned work",
    prompt: "Where can I find my assigned work?",
    answer: "Your assigned referral workspaces are collected in My queue. The same assignment determines which assessments appear on your calendar.",
    steps: ["Open My queue to see work requiring your attention.", "Open any row to continue its referral or assessment."],
    action: { type: "search", label: "Show my assigned work", mode: "my_work" },
    phrases: ["find my assigned work", "my assigned work", "my queue", "my assessments", "what do i need to do"],
    keywords: ["my", "assigned", "work", "queue", "assessments", "tasks"],
  }),
  intent({
    id: "schedule-assessment",
    title: "Schedule an assessment",
    prompt: "How do I schedule an assessment?",
    answer: "After intake is complete and one assessor is assigned, open Assessment and schedule the interview. The appointment stays attached to the referral and appears on the assigned assessor's calendar.",
    steps: ["Open the assigned referral workspace.", "Open Assessment and choose Schedule.", "Set the date, time, duration, method, and location or link."],
    action: { type: "search", label: "Show work ready to schedule", mode: "ready_to_schedule" },
    phrases: ["schedule an assessment", "schedule assessment", "schedule the interview", "book the interview", "set interview time", "after assignment", "ready to schedule"],
    keywords: ["schedule", "scheduled", "assessment", "interview", "appointment", "date", "time"],
  }),
  intent({
    id: "begin-assessment",
    title: "Begin or continue an assessment",
    prompt: "How do I begin or continue an assessment?",
    answer: "Open the assigned referral workspace and choose Assessment. Once the interview is scheduled, Begin assessment opens the questionnaire; returning later reopens the same saved draft.",
    steps: ["Open the referral workspace.", "Choose Begin assessment for a scheduled interview.", "Continue section by section; saved answers remain on the same assessment."],
    action: { type: "search", label: "Show scheduled assessments", mode: "scheduled_assessments" },
    phrases: ["begin an assessment", "begin assessment", "start assessment", "continue assessment", "open assessment", "assessment questionnaire"],
    keywords: ["begin", "start", "continue", "open", "assessment", "questionnaire", "interview"],
  }),
  intent({
    id: "finish-assessment",
    title: "Finish an assessment",
    prompt: "How do I finish an assessment?",
    answer: "Complete the required interview questions, resolve the missing items shown in the assessment, and review the completed chart before signing. Pipeline will not treat an unfinished draft as complete.",
    steps: ["Resolve every required answer or record why it could not be obtained.", "Review the completed chart and supporting documents.", "Sign the assessment when the record is complete."],
    action: { type: "navigate", label: "Open workspaces", screen: "referrals" },
    phrases: ["finish an assessment", "complete assessment", "sign assessment", "submit assessment", "assessment complete"],
    keywords: ["finish", "complete", "sign", "submit", "assessment", "required", "missing"],
  }),
  intent({
    id: "manage-documents",
    title: "Add or find documents",
    prompt: "How do I add or find a document?",
    answer: "The initial face sheet or referral packet is added when the referral is created. Additional documents belong in that client's workspace, where each file can satisfy a named document requirement and remains openable from the client record.",
    steps: ["Open the client's workspace.", "Use Documents to add the file to the matching requirement.", "Open the file from the workspace or client profile when you need the source."],
    action: { type: "search", label: "Show uploaded documents", mode: "files" },
    phrases: ["upload a document", "add a document", "find a document", "find a file", "missing documents", "face sheet", "referral packet"],
    keywords: ["upload", "add", "find", "document", "documents", "file", "files", "packet", "face", "sheet"],
  }),
  intent({
    id: "find-workspace",
    title: "Find a referral workspace",
    prompt: "How do I find a referral workspace?",
    answer: "Use Workspaces to search by client, owner, county, community, month, or document. Filters can be combined without changing the underlying record.",
    steps: ["Open Workspaces.", "Search a name or apply the owner, county, community, or month filters.", "Open the matching row."],
    action: { type: "navigate", label: "Open workspaces", screen: "referrals" },
    phrases: ["find a referral workspace", "find a workspace", "where is a referral", "search workspaces", "filter workspaces"],
    keywords: ["find", "search", "filter", "referral", "workspace", "workspaces", "owner", "county", "community", "month"],
  }),
  intent({
    id: "find-client",
    title: "Find a client profile",
    prompt: "How do I find a client profile?",
    answer: "Use Clients for the full directory, or search by client name or resident number. A client profile brings governed census information and Pipeline workspace data together without guessing identity matches.",
    steps: ["Open Clients.", "Search the client's name or resident number.", "Open the matching profile; review both choices if identities are ambiguous."],
    action: { type: "navigate", label: "Open clients", screen: "profiles" },
    phrases: ["find a client profile", "find a client", "client profile", "resident number", "client directory"],
    keywords: ["find", "search", "client", "profile", "resident", "number", "directory", "census"],
  }),
  intent({
    id: "review-missing-data",
    title: "See what is still missing",
    prompt: "How do I see what is still missing?",
    answer: "Open the referral workspace to see required intake, assessment, and document gaps together. Fix each value in its owning section so the same stored answer updates every view.",
    steps: ["Open the referral workspace.", "Review the completion and missing-information indicators.", "Enter or correct the value in Intake, Assessment, or Documents."],
    action: { type: "navigate", label: "Open workspaces", screen: "referrals" },
    phrases: ["what is still missing", "what information is missing", "missing profile data", "data completion", "incomplete chart", "complete the chart"],
    keywords: ["missing", "incomplete", "completion", "complete", "required", "information", "data", "chart"],
  }),
  intent({
    id: "use-calendar",
    title: "Use the assessment calendar",
    prompt: "What belongs on the calendar?",
    answer: "The calendar is for assessment work: scheduled interviews and assessments that are ready to schedule. Referral receipt and admission dates remain on their records instead of becoming calendar events.",
    steps: ["Open Calendar.", "Use the assessor and community filters to narrow the schedule.", "Open an event to return to its referral workspace."],
    action: { type: "navigate", label: "Open calendar", screen: "calendar" },
    phrases: ["assessment calendar", "what belongs on the calendar", "open calendar", "calendar event", "see schedule"],
    keywords: ["calendar", "schedule", "scheduled", "event", "events", "assessment", "interview"],
  }),
  intent({
    id: "use-reports",
    title: "Review team and workflow reports",
    prompt: "Where can I see team and workflow reports?",
    answer: "Reports summarizes recorded referral flow, document coverage, assessments, assessor workload, and supervisor exceptions. Its filters and exports use stored workflow events rather than estimates.",
    steps: ["Open Reports.", "Choose the report that matches the question.", "Apply a period, assessor, community, or county filter before exporting."],
    action: { type: "navigate", label: "Open reports", screen: "operations" },
    phrases: ["team reports", "workflow reports", "assessor performance", "how many assessments", "supervisor overview", "open reports"],
    keywords: ["report", "reports", "team", "workflow", "performance", "assessor", "supervisor", "completed", "export"],
  }),
];

const fallbackIntents = ["create-referral", "find-my-work", "begin-assessment"]
  .map((id) => intents.find((candidate) => candidate.id === id))
  .filter((candidate): candidate is SearchableIntent => Boolean(candidate));

export function interpretPipelineQuestion(value: string): PipelineQuestionInterpretation | null {
  const query = value.trim();
  const normalized = normalizeSearchText(query);
  if (!normalized) return null;

  const tokens = tokenizeSearchText(query);
  const genericTopic = tokens.length <= 3 && tokens.every((token) => ignoredQuestionWords.has(token) || workflowVocabulary.has(token));
  const looksLikeQuestion = questionOpeners.test(normalized) || query.endsWith("?") || genericTopic;
  if (!looksLikeQuestion) return null;

  const contentTokens = tokens.filter((token) => !ignoredQuestionWords.has(token));
  const scored = intents
    .map((candidate) => scoreIntent(candidate, normalized, contentTokens))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.intent.title.localeCompare(right.intent.title));

  if (scored.length === 0 || scored[0].score < 4) {
    return { kind: "unsupported", query, options: fallbackIntents.map(publicIntent) };
  }

  const top = scored[0];
  const second = scored[1];
  const confident = top.phraseMatch
    || (!second && top.score >= 4)
    || (top.score >= 8 && (!second || top.score - second.score >= 3))
    || (contentTokens.length >= 2 && top.score >= 4 && (!second || top.score - second.score >= 2));
  if (confident) {
    return {
      kind: "answer",
      query,
      intent: publicIntent(top.intent),
      alternatives: scored.slice(1, 3).filter((candidate) => candidate.score >= top.score - 3).map((candidate) => publicIntent(candidate.intent)),
    };
  }

  return {
    kind: "clarify",
    query,
    options: scored.slice(0, 3).map((candidate) => publicIntent(candidate.intent)),
  };
}

export function getPipelineQuestionIntent(id: string): PipelineQuestionIntent | null {
  const found = intents.find((candidate) => candidate.id === id);
  return found ? publicIntent(found) : null;
}

function intent(value: SearchableIntent): SearchableIntent {
  return value;
}

function scoreIntent(candidate: SearchableIntent, normalizedQuery: string, contentTokens: string[]) {
  const phraseMatch = candidate.phrases.some((phrase) => normalizedQuery.includes(normalizeSearchText(phrase)));
  let score = phraseMatch ? 20 : 0;
  for (const queryToken of contentTokens) {
    const exact = candidate.keywords.some((keyword) => queryToken === keyword);
    if (exact) score += 4;
    else if (candidate.keywords.some((keyword) => assistantTokenMatches(queryToken, keyword))) score += 2;
  }
  return { intent: candidate, phraseMatch, score };
}

function assistantTokenMatches(query: string, keyword: string) {
  if (fuzzyTokenMatches(query, keyword)) return true;
  return query.length >= 6 && keyword.length >= 6 && editDistanceAtMost(query, keyword, 2);
}

function editDistanceAtMost(left: string, right: string, maximum: number) {
  if (Math.abs(left.length - right.length) > maximum) return false;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + Number(left[leftIndex - 1] !== right[rightIndex - 1]);
      const value = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return false;
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length] <= maximum;
}

function publicIntent(candidate: SearchableIntent): PipelineQuestionIntent {
  return {
    id: candidate.id,
    title: candidate.title,
    prompt: candidate.prompt,
    answer: candidate.answer,
    steps: [...candidate.steps],
    action: { ...candidate.action },
  };
}
