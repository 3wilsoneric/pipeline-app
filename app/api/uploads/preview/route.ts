import { randomUUID } from "node:crypto";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { getExtractionBackendMode } from "@/lib/extraction/backend-config";
import { allowedUploadContentTypes, maxUploadFileBytes } from "@/lib/extraction/contracts";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { previewLocalPacket } from "@/lib/extraction/local-packet-ingestion";
import { canEditWorkspace } from "@/lib/pipeline/referral-ownership";
import { requireMutableReferralAccess } from "@/lib/pipeline/referral-access";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization, Cookie" };
let activePreviews = 0;

export async function POST(request: Request) {
  return withApiLogging(request, "/api/uploads/preview", async () => {
    const accessFailure = await previewAccessFailure(request);
    if (accessFailure) return accessFailure;
    const contentType = request.headers.get("content-type")?.split(";")[0] ?? "";
    if (!(allowedUploadContentTypes as readonly string[]).includes(contentType)) return Response.json({ error: "Choose a PDF or supported image." }, { status: 415, headers });
    if (activePreviews >= 2) return Response.json({ error: "Other files are being read. Retry in a moment." }, { status: 429, headers: { ...headers, "Retry-After": "3" } });
    activePreviews += 1;
    try {
      const bytes = await readPreviewBytes(request);
      const result = await previewLocalPacket(bytes, contentType, `preview-${randomUUID()}`);
      return Response.json(result, { headers });
    } catch (error) {
      return Response.json({ error: error instanceof DocumentProcessingError ? error.message : "This file could not be read. Try a clearer PDF or image; you can keep entering details." }, {
        status: error instanceof DocumentProcessingError ? error.status : 422, headers,
      });
    } finally { activePreviews -= 1; }
  });
}

async function previewAccessFailure(request: Request) {
  const auth = await requirePipelineUser(request);
  if (!auth.ok) return auth.response;
  const originFailure = requireSameOriginMutation(request);
  if (originFailure) return originFailure;
  if (!canEditWorkspace(auth.user)) return Response.json({ error: "Workspace editing access is required." }, { status: 403, headers });
  // The local preview must not silently replace the governed production worker.
  // Enable production only with durable draft-owned jobs and worker provenance.
  if (getExtractionBackendMode() !== "mock") return Response.json({ error: "Immediate extraction is not enabled on this server. Your file can still be uploaded." }, { status: 503, headers });
  const referralId = new URL(request.url).searchParams.get("referralId");
  if (referralId === null) return null;
  if (!/^[1-9]\d*$/.test(referralId) || !Number.isSafeInteger(Number(referralId))) return Response.json({ error: "Invalid referral." }, { status: 400, headers });
  const access = await requireMutableReferralAccess(auth.user, Number(referralId), "files");
  return access.ok ? null : access.response;
}

async function readPreviewBytes(request: Request) {
  const tooLarge = () => new DocumentProcessingError("preview_too_large", 413, "Documents must be 100 MB or smaller.");
  if (Number(request.headers.get("content-length")) > maxUploadFileBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new DocumentProcessingError("preview_empty", 400, "Choose a file to read.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxUploadFileBytes) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (length < 5) throw new DocumentProcessingError("preview_empty", 400, "The selected file is empty or incomplete.");
  return Buffer.concat(chunks, length);
}
