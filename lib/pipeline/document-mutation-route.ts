import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { isDocumentId } from "@/lib/extraction/document-assets";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { readJsonBody } from "@/lib/extraction/contracts";
import { requireMutableReferralAccess } from "./referral-access";
import { requireReferralStore } from "./referral-store";
import { changeDocument, documentReferralIncludingDeleted } from "./document-lifecycle";

export async function documentMutationResponse(request: Request, documentId: string, action: "delete" | "restore") {
  const auth = await requirePipelineUser(request);
  if (!auth.ok) return auth.response;
  const originFailure = requireSameOriginMutation(request);
  if (originFailure) return originFailure;
  const store = requireReferralStore();
  if (!store.ok) return store.response;
  if (!isDocumentId(documentId)) return Response.json({ error: "File not found." }, { status: 404 });
  const body = await readJsonBody<{ confirmed?: boolean; deletion_id?: string }>(request);
  if (!body.ok) return Response.json({ error: body.message }, { status: body.status });
  if (body.value.confirmed !== true || (action === "restore" && (typeof body.value.deletion_id !== "string" || !isDocumentId(body.value.deletion_id)))) {
    return Response.json({ error: "Confirm the file change before continuing." }, { status: 400 });
  }
  const referralId = await documentReferralIncludingDeleted(documentId);
  if (!referralId) return Response.json({ error: "File not found." }, { status: 404 });
  const access = await requireMutableReferralAccess(auth.user, referralId, "files");
  if (!access.ok) return access.response;
  try {
    const result = await changeDocument(documentId, referralId, action, pipelineAuditActor(auth.user), auth.user, body.value.deletion_id);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DocumentProcessingError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
