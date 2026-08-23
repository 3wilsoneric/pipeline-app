export type StructuredNarrativeKind = "summary" | "interview";

export type StructuredNarrativeSection = {
  key: string;
  label: string;
  placeholder: string;
};

export const structuredNarrativeSections = {
  summary: [
    { key: "reason", label: "Reason for referral", placeholder: "Why the client was referred and what prompted this episode." },
    { key: "presentation", label: "Current presentation", placeholder: "Current symptoms, behavior, and level of stability." },
    { key: "concerns", label: "Clinical and safety concerns", placeholder: "Known risks, recent events, and immediate concerns." },
    { key: "strengths", label: "Strengths and goals", placeholder: "Protective factors, engagement, preferences, and goals." },
    { key: "placement", label: "Placement rationale", placeholder: "Why this level of care and community may be appropriate." },
    { key: "additional", label: "Additional context", placeholder: "Relevant detail that does not fit another section." },
  ],
  interview: [
    { key: "perspective", label: "Client perspective", placeholder: "How the client describes the situation and requested support." },
    { key: "mental-status", label: "Mental status and symptoms", placeholder: "Orientation, mood, thought process, hallucinations, and current symptoms." },
    { key: "medication", label: "Medication discussion", placeholder: "Adherence, effectiveness, side effects, refusals, and preferences." },
    { key: "functional", label: "Functional support needs", placeholder: "ADLs, prompting, mobility, supervision, and daily support." },
    { key: "preferences", label: "Preferences and goals", placeholder: "Placement preferences, personal goals, and conditions for success." },
    { key: "additional", label: "Additional notes", placeholder: "Relevant interview detail that does not fit another section." },
  ],
} as const satisfies Record<StructuredNarrativeKind, readonly StructuredNarrativeSection[]>;

export function parseStructuredNarrative(
  value: string,
  sections: readonly StructuredNarrativeSection[],
) {
  const result = Object.fromEntries(sections.map((section) => [section.key, ""])) as Record<string, string>;
  const normalized = value.trim();
  if (!normalized) return result;

  const headingMatches = sections
    .map((section) => ({ section, marker: `## ${section.label}` }))
    .map(({ section, marker }) => ({ section, index: normalized.indexOf(marker), marker }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index);

  if (!headingMatches.length) {
    result[sections.at(-1)!.key] = normalized;
    return result;
  }

  headingMatches.forEach((match, index) => {
    const start = match.index + match.marker.length;
    const end = headingMatches[index + 1]?.index ?? normalized.length;
    result[match.section.key] = normalized.slice(start, end).trim();
  });
  return result;
}

export function serializeStructuredNarrative(
  sections: readonly StructuredNarrativeSection[],
  values: Readonly<Record<string, string>>,
) {
  return sections
    .map((section) => ({ section, value: values[section.key]?.trim() ?? "" }))
    .filter(({ value }) => value)
    .map(({ section, value }) => `## ${section.label}\n${value}`)
    .join("\n\n");
}
