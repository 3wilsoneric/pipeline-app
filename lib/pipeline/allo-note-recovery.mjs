const RESPONSIBLE_PERSON_LABEL = "responsible person";
const SUMMARY_LABEL = "summary";

const emptyNarrativeValues = new Set([
  "n/a",
  "na",
  "none",
  "none provided",
  "not provided",
  "unknown",
]);

/**
 * ALLO's rendered canvas DOM places legacy Summary content immediately before
 * the visual Summary heading. Recover only that bounded form region; never
 * infer narrative from arbitrary unscoped canvas text.
 */
export function recoverLegacyCanvasAssessmentCandidate(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;

  const summaryIndex = blocks.findIndex((block) => normalizedLabel(block?.text) === SUMMARY_LABEL);
  if (summaryIndex < 1) return null;

  let responsiblePersonIndex = -1;
  for (let index = 0; index < summaryIndex; index += 1) {
    if (normalizedLabel(blocks[index]?.text) === RESPONSIBLE_PERSON_LABEL) responsiblePersonIndex = index;
  }
  if (responsiblePersonIndex < 0 || responsiblePersonIndex >= summaryIndex - 1) return null;

  const narrativeBlocks = blocks.slice(responsiblePersonIndex + 1, summaryIndex).filter((block) => {
    const text = normalizedText(block?.text);
    return text && block?.block_type !== "heading" && block?.block_type !== "input";
  });
  const meaningfulBlocks = narrativeBlocks.filter((block) => !emptyNarrativeValues.has(normalizedLabel(block.text)));
  const body = meaningfulBlocks.map((block) => normalizedText(block.text)).filter(Boolean).join("\n");
  if (!isMeaningfulNarrative(body)) return null;

  return {
    proposedValue: `[ALLO Summary]\n${body}`,
    sourceBlockIds: meaningfulBlocks.map((block) => block.source_block_id).filter(Boolean),
    mappingConfidence: 0.82,
  };
}

function isMeaningfulNarrative(value) {
  if (value.length >= 80) return true;
  return /\b(?:adl|aggress|ah|ambulatory|anxi|diagnos|halluc|medicat|mood|sleep|substance|suicid|vh)\b/i.test(value);
}

function normalizedLabel(value) {
  return normalizedText(value)
    .toLocaleLowerCase("en-US")
    .replace(/[.:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}
