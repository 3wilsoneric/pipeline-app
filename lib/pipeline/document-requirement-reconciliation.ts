import "server-only";

import type { CompleteUploadResponse } from "@/lib/extraction/contracts";
import { requirementForDocumentCategory } from "@/lib/pipeline/document-requirements";
import type { ReferralActor } from "@/lib/pipeline/referral-store";
import { getReferralWorkflowSnapshot, patchReferralWorkItem } from "@/lib/pipeline/workflow-store";

type UploadedDocument = NonNullable<CompleteUploadResponse["documents"]>[number];

export async function reconcileUploadedDocumentRequirements(
  referralId: number,
  documents: UploadedDocument[],
  actor: ReferralActor,
) {
  for (const document of documents) {
    const requirementType = requirementForDocumentCategory(document.category);
    if (!requirementType) continue;
    let reconciled = false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = await getReferralWorkflowSnapshot(referralId);
      const requirement = snapshot?.work_items.find((item) => item.type === requirementType);
      if (!requirement || ["reviewed", "waived"].includes(requirement.status) || requirement.evidenceDocumentId) {
        reconciled = true;
        break;
      }

      const result = await patchReferralWorkItem(
        referralId,
        requirement.id,
        {
          status: "received",
          evidenceDocumentId: document.document_id,
          evidenceDocumentName: document.filename,
        },
        requirement.version ?? 1,
        actor,
      );
      if (!result) throw new Error("The uploaded document could not be linked to its checklist item.");
      if (result.ok) {
        reconciled = true;
        break;
      }
      if ("blocked" in result) {
        throw new Error(result.blockers[0]?.label ?? "The uploaded document could not update its checklist item.");
      }
    }
    if (!reconciled) throw new Error("The uploaded document could not be linked because its checklist changed in another session.");
  }
}
