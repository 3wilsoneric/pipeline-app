export type RecoverableCanvasBlock = {
  source_block_id?: string | null;
  block_type?: string | null;
  text?: string | null;
};

export type RecoveredCanvasAssessmentCandidate = {
  proposedValue: string;
  sourceBlockIds: string[];
  mappingConfidence: number;
};

export function recoverLegacyCanvasAssessmentCandidate(
  blocks: RecoverableCanvasBlock[],
): RecoveredCanvasAssessmentCandidate | null;
