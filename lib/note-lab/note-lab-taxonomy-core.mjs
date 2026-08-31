export const NOTE_LAB_TAXONOMY_VERSION = "note_taxonomy_v1";

export const noteLabTopicDefinitions = [
  { id: "referral_context", label: "Referral context" },
  { id: "mental_status", label: "Mental status" },
  { id: "psychiatric_symptoms", label: "Psychiatric symptoms" },
  { id: "medication", label: "Medication" },
  { id: "functional_status", label: "Function and ADLs" },
  { id: "medical_health", label: "Medical health" },
  { id: "substance_use", label: "Substance use" },
  { id: "risk_legal", label: "Risk and legal" },
  { id: "behavior_interpersonal", label: "Behavior and relationships" },
  { id: "social_placement", label: "Social and placement" },
  { id: "assessment_decision", label: "Assessment decision" },
];

export const noteLabWritingSignalDefinitions = [
  { id: "source_attribution", label: "Source attribution" },
  { id: "uncertainty_preserved", label: "Uncertainty preserved" },
  { id: "direct_observation", label: "Direct observation" },
  { id: "chronology", label: "Chronology" },
  { id: "action_plan", label: "Action or plan" },
  { id: "structured_domains", label: "Structured domain labels" },
  { id: "quoted_language", label: "Quoted language" },
  { id: "numeric_detail", label: "Numeric detail" },
  { id: "possible_problematic_wording", label: "Possible problematic wording" },
];

const topicMatchers = {
  referral_context: [
    /\breferr(?:al|ed|ent|ing)\b/i,
    /\b(?:county|responsible person|contact person|date received)\b/i,
    /\b(?:face sheet|packet|referral source)\b/i,
  ],
  mental_status: [
    /\b(?:alert|oriented|aware)\s*(?:x\s*)?[1-4]\b/i,
    /\b(?:coherent|linear|thought process|mental status|mse|insight|judg(?:e)?ment|cognition)\b/i,
    /\b(?:mood|affect|speech|appearance)\b/i,
  ],
  psychiatric_symptoms: [
    /\b(?:schizophren|bipolar|psychosis|psychotic|depress|anxi|manic|mania)\w*\b/i,
    /\b(?:hallucinat|delusion|paranoi|auditory|visual|ah|vh)\w*\b/i,
    /\b(?:diagnos|symptom|suicid|homicid|si|hi)\w*\b/i,
  ],
  medication: [
    /\b(?:meds?|medication|prescription|dose|dosage|milligram|mg|prn|po)\b/i,
    /\b(?:refus|adher|compliant|noncompliant|side effect|injection)\w*\b/i,
    /\b(?:pharmacy|mar|med list|medication list)\b/i,
  ],
  functional_status: [
    /\b(?:adl|activities of daily living|ambulatory|mobility|walker|wheelchair)\b/i,
    /\b(?:bathing|grooming|dressing|toileting|continence|incontinence|independent)\b/i,
    /\b(?:sleep|roommate|roomates?|assistance|skin intact)\b/i,
  ],
  medical_health: [
    /\b(?:allerg|diabet|seizure|wound|skin|tb test|tuberculosis|medical condition)\w*\b/i,
    /\b(?:diet|vitals?|pain|infection|hospitalization|nka)\b/i,
    /\b(?:hearing|vision|dental|continence)\b/i,
  ],
  substance_use: [
    /\b(?:substance|meth|methamphetamine|alcohol|marijuana|cannabis|cocaine|heroin|opioid|fentanyl)\w*\b/i,
    /\b(?:sober|sobriety|withdrawal|tobacco|cigarette|smok(?:e|es|ing))\b/i,
    /\b(?:drug use|etoh|sud)\b/i,
  ],
  risk_legal: [
    /\b(?:arrest|arson|assault|violence|violent|aggress|awol|warrant|probation|parole)\w*\b/i,
    /\b(?:conservator|conserved|court|forensic|legal|lps|minute order)\w*\b/i,
    /\b(?:suicid|homicid|self[- ]harm|danger to|fire setting|elopement)\w*\b/i,
  ],
  behavior_interpersonal: [
    /\b(?:fight|argument|peer|roommate|roomates?|staff|redirect|cooperat|agitat)\w*\b/i,
    /\b(?:behavior|interpersonal|conflict|follow(?:s|ing)? directions)\b/i,
    /\b(?:gets along|supportive of peers|outburst)\b/i,
  ],
  social_placement: [
    /\b(?:homeless|housing|placement|board and care|b&c|facility|state hospital|sro)\b/i,
    /\b(?:family|social worker|case manager|caregiver|support system|payee)\b/i,
    /\b(?:ssi|benefits|income|employment|discharge planner)\b/i,
  ],
  assessment_decision: [
    /\b(?:accept|accepted|reject|rejected|approve|approved|admission|admit)\w*\b/i,
    /\b(?:appropriate|recommend|decision|barrier|pending|follow[- ]up|schedule)\w*\b/i,
    /\b(?:next step|disposition|level of care|eligible|readiness)\b/i,
  ],
};

const sectionBias = {
  referral: "referral_context",
  medication: "medication",
  post_assessment: "assessment_decision",
};

export function splitLabeledNoteSections(value) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const pattern = /\[ALLO\s+([^\]]+)\]\s*\n([\s\S]*?)(?=\n{2,}\[ALLO\s+[^\]]+\]|$)/gi;
  const sections = [];
  for (const match of normalized.matchAll(pattern)) {
    const section = normalizeNoteSection(match[1]);
    const text = match[2]?.trim();
    if (section && text) sections.push({ section, text });
  }
  return sections.length > 0 ? sections : [{ section: "assessment", text: normalized }];
}

export function normalizeNoteSection(value) {
  const normalized = String(value ?? "").toLocaleLowerCase("en-US")
    .replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const rule = noteSectionRules.find(({ pattern }) => pattern.test(normalized));
  return rule?.section ?? null;
}

const noteSectionRules = [
  { pattern: /\bpost\b.*\bassessment\b|\bassessment\b.*\bpost\b/u, section: "post_assessment" },
  { pattern: /\bpre\b.*\bassessment\b|\bassessment\b.*\bpre\b/u, section: "pre_assessment" },
  { pattern: /referral/u, section: "referral" },
  { pattern: /med/u, section: "medication" },
  { pattern: /interview/u, section: "interview" },
  { pattern: /summary/u, section: "summary" },
  { pattern: /assessment/u, section: "assessment" },
];

export function classifyNoteText(value, section = null) {
  const text = String(value ?? "").normalize("NFKC");
  const ranked = rankNoteTopics(text, section);
  const topicTags = ranked.map(([topic]) => topic);
  const scope = noteScope(ranked, topicTags.length);
  const primaryTopic = ranked[0]?.[0] ?? "referral_context";
  const { format, labeledLineCount } = noteFormat(text);

  return {
    taxonomyVersion: NOTE_LAB_TAXONOMY_VERSION,
    primaryTopic,
    topicTags,
    scope,
    comparisonType: scope === "multi_domain" ? "multi_domain" : primaryTopic,
    format,
    signals: writingSignals(text, labeledLineCount),
  };
}

function rankNoteTopics(text, section) {
  const topicScores = Object.fromEntries(noteLabTopicDefinitions.map((topic) => [topic.id, 0]));
  for (const topic of noteLabTopicDefinitions) {
    topicScores[topic.id] = topicMatchers[topic.id].reduce(
      (score, matcher) => score + (matcher.test(text) ? 1 : 0),
      0,
    );
  }
  const biasedTopic = sectionBias[section];
  if (biasedTopic) topicScores[biasedTopic] += 2;
  return Object.entries(topicScores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"));
}

function noteScope(ranked, topicCount) {
  const topScore = ranked[0]?.[1] ?? 0;
  const secondScore = ranked[1]?.[1] ?? 0;
  return topicCount >= 3 && secondScore >= Math.max(2, topScore * 0.7)
    ? "multi_domain"
    : "focused";
}

function noteFormat(text) {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const bulletCount = lines.filter((line) => /^(?:[-*•]|\d+[.)])\s+/.test(line)).length;
  const labeledLineCount = lines.filter((line) => /^[A-Za-z][A-Za-z /&-]{1,30}:\s*\S/.test(line)).length;
  const format = bulletCount >= 2 && labeledLineCount >= 2
    ? "mixed"
    : bulletCount >= 2 ? "bulleted"
      : labeledLineCount >= 3 ? "structured" : "narrative";
  return { format, labeledLineCount };
}

function writingSignals(text, labeledLineCount) {
  return writingSignalMatchers
    .filter((matcher) => matcher.matches(text, labeledLineCount))
    .map((matcher) => matcher.signal);
}

const writingSignalMatchers = [
  { signal: "source_attribution", matches: (text) => /\b(?:per|according to|reported by|records indicate|client\s+(?:states|reports|denies|endorses)|case manager\s+(?:states|reports)|cm\s+(?:states|reports))\b/i.test(text) },
  { signal: "uncertainty_preserved", matches: (text) => /\b(?:reportedly|unclear|unknown|unable to verify|does not recall|doesn't remember|appears|may|possible|presumably)\b/i.test(text) },
  { signal: "direct_observation", matches: (text) => /\b(?:observed|presented|during (?:the )?interview|alert and oriented|aware\s*(?:x\s*)?[1-4]|speech (?:was|is)|affect (?:was|is))\b/i.test(text) },
  { signal: "chronology", matches: (text) => /\b(?:today|yesterday|last (?:week|month|year)|\d+\s+(?:day|week|month|year)s?\s+ago|since|prior to|currently|history of|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/i.test(text) },
  { signal: "action_plan", matches: (text) => /\b(?:plan|follow[- ]up|next step|needs? to|recommend|schedule|pending|refer to|monitor|obtain)\w*\b/i.test(text) },
  { signal: "structured_domains", matches: (_text, labeledLineCount) => labeledLineCount >= 2 },
  { signal: "quoted_language", matches: (text) => /[“”"]\S[^“”"]{2,}[“”"]/.test(text) },
  { signal: "numeric_detail", matches: (text) => /\b\d+(?:\.\d+)?\s*(?:mg|ml|hours?|days?|weeks?|months?|years?|times?)\b/i.test(text) },
  { signal: "possible_problematic_wording", matches: (text) => /\b(?:crazy|manipulative|attention[- ]seeking|difficult patient|drug[- ]seeking|noncompliant|poor historian|good historian|frequent flyer)\b/i.test(text) },
];

export function analyzeClassifiedNotes(notes) {
  const records = [...notes];
  const comparisonGroups = new Map();
  for (const note of records) {
    const key = `${note.section}:${note.classification.comparisonType}:${note.lengthBand}`;
    const group = comparisonGroups.get(key) ?? {
      section: note.section,
      comparisonType: note.classification.comparisonType,
      lengthBand: note.lengthBand,
      sampleCount: 0,
      sourceIds: new Set(),
    };
    group.sampleCount += 1;
    if (note.sourceCanvasId) group.sourceIds.add(note.sourceCanvasId);
    comparisonGroups.set(key, group);
  }
  const groups = [...comparisonGroups.values()].map((group) => ({
    section: group.section,
    comparisonType: group.comparisonType,
    lengthBand: group.lengthBand,
    sampleCount: group.sampleCount,
    sourceCount: group.sourceIds.size,
    pairable: group.sourceIds.size >= 2,
  })).sort((left, right) => right.sampleCount - left.sampleCount
    || `${left.section}:${left.comparisonType}:${left.lengthBand}`.localeCompare(
      `${right.section}:${right.comparisonType}:${right.lengthBand}`,
      "en",
    ));

  return {
    schemaVersion: 1,
    taxonomyVersion: NOTE_LAB_TAXONOMY_VERSION,
    sampleCount: records.length,
    sourceCount: new Set(records.map((note) => note.sourceCanvasId).filter(Boolean)).size,
    pairableSampleCount: groups.filter((group) => group.pairable)
      .reduce((total, group) => total + group.sampleCount, 0),
    pairableGroupCount: groups.filter((group) => group.pairable).length,
    distributions: {
      section: countBy(records, (note) => note.section),
      primaryTopic: countBy(records, (note) => note.classification.primaryTopic),
      comparisonType: countBy(records, (note) => note.classification.comparisonType),
      scope: countBy(records, (note) => note.classification.scope),
      format: countBy(records, (note) => note.classification.format),
      lengthBand: countBy(records, (note) => note.lengthBand),
      signal: countMany(records, (note) => note.classification.signals),
      topicTag: countMany(records, (note) => note.classification.topicTags),
    },
    comparisonGroups: groups,
  };
}

function countBy(records, select) {
  const counts = new Map();
  for (const record of records) {
    const key = select(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sortedCountObject(counts);
}

function countMany(records, select) {
  const counts = new Map();
  for (const record of records) {
    for (const key of new Set(select(record))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sortedCountObject(counts);
}

function sortedCountObject(counts) {
  return Object.fromEntries([...counts].sort((left, right) => right[1] - left[1]
    || String(left[0]).localeCompare(String(right[0]), "en")));
}
