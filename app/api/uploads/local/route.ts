import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { getExtractionBackendMode } from "@/lib/extraction/backend-config";
import { maxUploadFileBytes } from "@/lib/extraction/contracts";
import { extractionErrorResponse, ingestLocalMockPacketFile } from "@/lib/extraction/extraction-service";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

const multipartOverheadBytes = 1024 * 1024;

export async function POST(request: Request) {
  return withApiLogging(request, "/api/uploads/local", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    if (getExtractionBackendMode() !== "mock") {
      return Response.json({ error: "Local packet ingestion is disabled." }, { status: 404 });
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxUploadFileBytes + multipartOverheadBytes) {
      return Response.json({ error: "The initial packet must be 100 MB or smaller." }, { status: 413 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return Response.json({ error: "The packet upload body is invalid." }, { status: 400 });
    }

    const packetId = boundedFormValue(formData.get("packet_id"), 160);
    const fileId = boundedFormValue(formData.get("file_id"), 160);
    const packet = formData.get("file");
    if (!packetId || !fileId || !(packet instanceof File)) {
      return Response.json({ error: "packet_id, file_id, and file are required." }, { status: 400 });
    }
    if (packet.size < 5 || packet.size > maxUploadFileBytes) {
      return Response.json({ error: "The initial packet must be between 5 bytes and 100 MB." }, { status: 413 });
    }

    try {
      const result = await ingestLocalMockPacketFile({
        packetId,
        fileId,
        filename: packet.name,
        bytes: new Uint8Array(await packet.arrayBuffer()),
      });
      return Response.json(result, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    } catch (error) {
      return extractionErrorResponse(error);
    }
  });
}

function boundedFormValue(value: FormDataEntryValue | null, maximum: number) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : "";
}
