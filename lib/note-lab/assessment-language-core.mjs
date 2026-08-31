export const ASSESSMENT_LANGUAGE_TAXONOMY_VERSION = "assessment_language_v4";

const fieldRules = [
  rule("prior_awol_failed_placements", 5, [/\b(?:awol|eloped?|left without|unauthorized absence)\b/i, /\b(?:placement|facility|board and care|b&c)\b/i]),
  rule("prior_placements", 5, [/\b(?:prior|previous|formerly|previously lived|was placed|came from)\b/i, /\b(?:facility|board and care|b&c|state hospital|sro|group home|snf|housing)\b/i, /\b(?:ended|discharged|left|evicted|duration|months?|years?)\b/i], true),
  rule("prior_5150_5250_holds", 3, [/\b(?:5150|5250|involuntary hold|psychiatric hold)\b/i]),
  rule("crisis_er_utilization", 5, [/\b(?:emergency room|emergency department|\ber\b|crisis stabilization|crisis visit)\b/i, /\b(?:visit|transport|admitted|discharged|times?)\b/i]),
  rule("secondary_diagnoses", 5, [/\b(?:secondary|additional|other) diagnos(?:is|es)\b/i, /\b(?:per|record|chart|psychiatrist|clinician)\b/i]),
  rule("cognition_orientation", 3, [/\b(?:alert and oriented|oriented|aware)\s*(?:x\s*)?[1-4]\b/i, /\b(?:memory|attention|cognition|orientation)\b/i]),
  rule("linear_conversation_details", 5, [/\b(?:linear|coherent|tangential|circumstantial|disorganized|word salad|thought process)\b/i, /\b(?:conversation|speech|interview|response)\b/i]),
  rule("current_symptoms", 5, [/\b(?:mood|affect|psychosis|paranoi|delusion|depress|anxi|mania|symptom)\w*\b/i, /\b(?:current(?:ly)?|during (?:the )?interview|today|presented)\b/i, /\b(?:reports?|denies|endorses|observed)\b/i], true),
  rule("dress_assistance_details", 5, [/\b(?:dress|dressing|clothing)\b/i, /\b(?:assist|cue|prompt|independent|dependent)\w*\b/i]),
  rule("bathing_assistance_details", 5, [/\b(?:bath|bathing|shower)\b/i, /\b(?:assist|cue|prompt|independent|dependent)\w*\b/i]),
  rule("adl_needs", 5, [/\b(?:adl|activities of daily living|grooming|hygiene|toileting|continence|self[- ]care)\b/i, /\b(?:assist|cue|prompt|independent|dependent|needs?)\w*\b/i]),
  rule("mobility", 5, [/\b(?:ambulatory|mobility|walker|wheelchair|transfer|gait|fall risk)\b/i, /\b(?:assist|device|independent|non[- ]ambulatory|steady|unsteady)\w*\b/i]),
  rule("language_barrier_details", 3, [/\b(?:language barrier|interpreter|translation|limited english|spanish[- ]speaking|nonverbal)\b/i]),
  rule("peer_interaction_notes", 5, [/\b(?:peer|roommate|roomates?|other residents?)\b/i, /\b(?:interaction|gets along|conflict|argument|fight|isolat|social)\w*\b/i]),
  rule("staff_interaction_notes", 5, [/\b(?:staff|nurs(?:e|es)|doctor|case manager|social worker)\b/i, /\b(?:interaction|direction|redirect|cooperat|argument|respectful)\w*\b/i]),
  rule("programming_notes", 5, [/\b(?:programming|groups?|milieu|treatment program)\b/i, /\b(?:attends?|participat(?:e|es|ing)|refuses?|engages?)\s+(?:in\s+)?(?:groups?|programming|activities)|prompt(?:ed|ing)?\s+to\s+attend\b/i]),
  rule("forensic_involvement_details", 3, [/\b(?:forensic|not guilty by reason|ngri|incompetent to stand trial|court diversion)\b/i]),
  rule("arrest_last_two_years_details", 5, [/\b(?:arrest|charge|jail|warrant|arson)\w*\b/i, /\b(?:last|within|ago|date|year|month|recent)\b/i]),
  rule("court_requirements", 3, [/\b(?:court requirement|court order|registration requirement|pc\s*290|hearing requirement)\b/i]),
  rule("court_dates", 5, [/\b(?:court|hearing)\b/i, /\b(?:date|scheduled|calendar|upcoming)\b/i]),
  rule("probation_parole_justice", 3, [/\b(?:probation|parole|probation officer|parole officer|justice supervision)\b/i]),
  rule("medications_at_intake", 6, [/\b(?:medication list|current medications?|meds at intake|mar lists?|prescribed)\b/i, /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml)\b/i]),
  rule("prn_patterns", 5, [/\bprn\b/i, /\b(?:request|use|given|administer|effective|frequency|times?)\w*\b/i]),
  rule("substance_effect_on_baseline", 6, [/\b(?:meth|methamphetamine|alcohol|cannabis|marijuana|cocaine|opioid|fentanyl|substance use)\b/i, /\b(?:psychosis|symptom|baseline|housing|function|behavior|arrest|sleep|impact|effect)\w*\b/i]),
  rule("substance_use_insight_details", 5, [/\b(?:insight|recognizes?|acknowledges?|denies a problem|does not believe)\b/i, /\b(?:substance|meth|alcohol|drug use)\b/i]),
  rule("treatment_history", 3, [/\b(?:rehab|residential treatment|outpatient treatment|detox|aa meetings?|na meetings?|substance treatment program)\b/i]),
  rule("triggers", 3, [/\b(?:triggered by|triggers? include|antecedent|usually after|when .{0,40}(?:upset|frustrated|redirected))\b/i]),
  rule("physical_altercation_details", 6, [/\b(?:physical altercation|fight|hit|punched|kicked|struck)\b/i, /\b(?:peer|roommate|staff|incident|injury|intervention)\b/i]),
  rule("last_assault_details", 6, [/\b(?:assault|attacked|threatened with)\b/i, /\b(?:most recent|last|ago|date|injury|police)\b/i]),
  rule("elopement_risk", 5, [/\b(?:elopement|eloped|awol|leave without|exit[- ]seeking)\b/i, /\b(?:risk|recent|attempt|supervision|precaution)\w*\b/i]),
  rule("aggression_risk", 5, [/\b(?:aggress|violent|threaten|property destruction)\w*\b/i, /\b(?:risk|current|recent|frequency|trigger)\w*\b/i]),
  rule("last_self_harm_incident", 6, [/\b(?:self[- ]harm|suicide attempt|cutting|overdose)\b/i, /\b(?:most recent|last|ago|date|incident|injury)\b/i]),
  rule("current_self_harm_details", 6, [/\b(?:current|today|now|present)\b/i, /\b(?:suicid|self[- ]harm|plan|intent|means)\w*\b/i]),
  rule("current_safety_measures", 3, [/\b(?:safety plan|observation level|one[- ]to[- ]one|1:1 observation|suicide precautions?|means restriction)\b/i]),
  rule("si_hi_history", 6, [/\b(?:si|hi|suicidal ideation|homicidal ideation)\b/i, /\b(?:history|current|denies|reports|plan|intent)\w*\b/i]),
  rule("auditory_hallucination_triggers", 6, [/\b(?:auditory hallucinations?|\bah\b|voices?)\b/i, /\b(?:trigger|worse when|usually after|associated with)\b/i]),
  rule("auditory_hallucination_nature", 5, [/\b(?:auditory hallucinations?|\bah\b|hearing voices?|command hallucinations?)\b/i, /\b(?:reports|denies|says|content|frequency|daily|weekly)\w*\b/i]),
  rule("visual_hallucination_recent", 6, [/\b(?:visual hallucinations?|\bvh\b|seeing things?)\b/i, /\b(?:most recent|last|today|ago|recent)\b/i]),
  rule("visual_hallucination_details", 5, [/\b(?:visual hallucinations?|\bvh\b|seeing things?)\b/i, /\b(?:reports|denies|describes|frequency|daily|weekly)\w*\b/i]),
  rule("olfactory_hallucination_details", 3, [/\b(?:olfactory hallucinations?|smells? (?:that|others|no one)|phantom smell)\b/i]),
  rule("tactile_hallucination_details", 3, [/\b(?:tactile hallucinations?|crawling on (?:the )?skin|being touched when)\b/i]),
  rule("gustatory_hallucination_details", 3, [/\b(?:gustatory hallucinations?|phantom taste|taste that others)\b/i]),
  rule("hallucination_coping_strategies", 5, [/\b(?:voices?|hallucinations?|\bah\b|\bvh\b)\b/i, /\b(?:cope|coping|ignore|music|distraction|grounding|talk to staff)\w*\b/i]),
  rule("hallucination_distress_impairment", 5, [/\b(?:voices?|hallucinations?|\bah\b|\bvh\b)\b/i, /\b(?:distress|fear|upset|impair|bother|severity)\w*\b/i]),
  rule("hallucination_functional_impact", 5, [/\b(?:voices?|hallucinations?|\bah\b|\bvh\b)\b/i, /\b(?:sleep|adl|function|participat|self[- ]care|safety)\w*\b/i]),
  rule("hallucination_treatment_history", 5, [/\b(?:voices?|hallucinations?|\bah\b|\bvh\b)\b/i, /\b(?:medication|treatment|therapy|improved|response to|helped|less frequent)\w*\b/i]),
  rule("diabetic_details", 3, [/\b(?:diabet|insulin|blood glucose|blood sugar|a1c)\w*\b/i]),
  rule("special_diet_details", 3, [/\b(?:special diet|renal diet|diabetic diet|low sodium|texture modified|pureed|thickened liquids?)\b/i]),
  rule("skin_integrity_details", 3, [/\b(?:skin integrity|wound|pressure ulcer|pressure injury|open area|skin breakdown)\b/i]),
  rule("physical_health_measures", 5, [/\b(?:monitor|follow[- ]up|equipment|oxygen|cpap|catheter|colostomy|ileostomy|wound care|blood glucose|vitals?)\w*\b/i, /\b(?:physical health|medical condition|diabet|copd|seizure|cardiac|wound|nursing support|oxygen|cpap|catheter|ostomy)\w*\b/i]),
  rule("physical_health_diagnoses", 5, [/\b(?:medical|physical health) diagnos(?:is|es)\b/i, /\b(?:per|record|chart|physician)\b/i]),
  rule("family_involvement", 5, [/\b(?:family|mother|father|sister|brother|daughter|son|spouse)\b/i, /\b(?:contact|visit|support|involved|assist|estranged)\w*\b/i]),
  rule("friendships_social_connections", 5, [/\b(?:friend|social connection|support network|community contact)\w*\b/i, /\b(?:contact|visit|support|reliable|isolat)\w*\b/i]),
  rule("prior_living_situation", 3, [/\b(?:previously lived|prior living|before admission|before hospitalization|last lived)\b/i]),
  rule("housing_history", 5, [/\b(?:homeless|housing history|unhoused|shelter|stable housing|evicted)\b/i, /\b(?:months?|years?|history|since|prior)\b/i]),
  rule("benefits_income_status", 5, [/\b(?:ssi|ssdi|benefits|income|payee)\b/i, /\b(?:active|suspended|pending|paused|reinstat|receiv)\w*\b/i]),
  rule("preferred_facility_characteristics", 5, [/\b(?:prefers?|wants?|facility preference|private room|location preference)\b/i, /\b(?:facility|placement|room|community|setting)\b/i]),
  rule("placement_preferences_concerns", 5, [/\b(?:placement|facility|community|room|setting)\b/i, /\b(?:concern|does not want|declines|barrier|worr(?:y|ied))\b/i]),
  rule("discharge_planning_goals", 5, [/\b(?:discharge|transition|placement planning)\b/i, /\b(?:goal|plan|wants?|return|move)\b/i]),
  rule("behavioral_history", 6, [/\b(?:behavior|outburst|agitat|redirect|property destruction|verbal aggression)\w*\b/i, /\b(?:history|pattern|frequency|current|recent|staff reports?)\w*\b/i]),
];

export function splitAssessmentNarrativePassages(value) {
  const normalized = String(value ?? "").normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+(?=(?:meds?|medications?|sleep|adls?|ah|vh|substances?|programming|skin|mobility|family|legal|diagnos(?:is|es)|mood|peers?|staff|si|hi)\s*:)/gi, "\n")
    .trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n{2,}/).flatMap((block) => {
    const lines = block.split(/\n/).map(cleanLine).filter(Boolean);
    return lines.length > 1 ? lines : [lines.join(" ")];
  });
  const passages = blocks.flatMap(splitLongPassage)
    .map((passage) => passage.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter((passage) => passage.length >= 20 && wordCount(passage) >= 4);
  return [...new Set(passages)];
}

export function classifyAssessmentNarrativeField(value) {
  const text = String(value ?? "").normalize("NFKC");
  const ranked = fieldRules.map((fieldRule) => ({
    field: fieldRule.field,
    minimum: fieldRule.minimum,
    hasRequiredPattern: !fieldRule.requiredPattern || fieldRule.requiredPattern.test(text),
    score: fieldRule.patterns.reduce((total, [pattern, weight]) => total + (pattern.test(text) ? weight : 0), 0),
  })).filter((candidate) => candidate.hasRequiredPattern && candidate.score >= candidate.minimum)
    .sort((left, right) => right.score - left.score || left.field.localeCompare(right.field, "en"));
  const best = ranked[0];
  if (!best) return null;
  const runnerUp = ranked[1];
  if (runnerUp && best.score - runnerUp.score < 2) return null;
  return {
    targetField: best.field,
    confidence: best.score >= best.minimum + 3 ? "high" : "medium",
    score: best.score,
  };
}

function rule(field, minimum, patterns, requireFirst = false) {
  return {
    field,
    minimum,
    requiredPattern: requireFirst ? patterns[0] : null,
    patterns: patterns.map((pattern) => [pattern, 3]),
  };
}

function splitLongPassage(value) {
  if (wordCount(value) <= 30 || /^(?:meds?|medications?|sleep|adls?|ah|vh|substances?|programming|skin|mobility|family|legal|diagnos(?:is|es)|mood|peers?|staff|si|hi)\s*:/i.test(value)) return [value];
  const sentences = value.split(/(?<=[.!?])\s+(?=[A-Z[])/).filter(Boolean);
  if (sentences.length < 2) return [value];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && wordCount(current) >= 8 && wordCount(`${current} ${sentence}`) > 25) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function cleanLine(value) {
  return value.replace(/[\t ]+/g, " ").trim();
}

function wordCount(value) {
  return value.split(/\s+/).filter(Boolean).length;
}
